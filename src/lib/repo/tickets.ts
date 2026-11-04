import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import {
  fromRow,
  fromRows,
  insertSql,
  newId,
  NotFoundError,
  nowIso,
  TransitionError,
} from "../db/util";
import { initialTicketStatus, transitionTicket, type TicketEvent } from "../domain/ticket-machine";
import type {
  ActionMode,
  ActionState,
  Attachment,
  Author,
  EngramLink,
  PlannedAction,
  RefType,
  Source,
  Ticket,
  TicketDetail,
  TicketDirection,
  TicketMessage,
  TicketOption,
  TicketRef,
  TicketStatus,
} from "../domain/types";
import { emitWake } from "../wake/wake";
import { ensureSession } from "./sessions";
import { touchInteraction } from "./interaction";

const T_SPEC = { bool: ["is_sample"] };
const M_SPEC = { json: ["options"] };
const A_SPEC = { json: ["target"] };

export interface RefInput {
  refType: RefType;
  target: string;
  label?: string;
}

export interface MessageInput {
  author: Author;
  body?: string;
  options?: TicketOption[];
  recommended?: string;
  recommendation?: string;
  chosen?: string;
  refs?: RefInput[];
  /** The session posting (Claude messages). Becomes the owner if the ticket has none. */
  session?: string;
}

export interface TicketInput {
  direction: TicketDirection;
  title: string;
  project?: string;
  ownerSession?: string;
  itemId?: string;
  isSample?: boolean;
  /** First message. Its author follows the direction. */
  body?: string;
  options?: TicketOption[];
  recommended?: string;
  recommendation?: string;
  refs?: RefInput[];
}

export interface ActionInput {
  kind: string;
  source: Source;
  label: string;
  mode: ActionMode;
  target?: Record<string, unknown>;
}

export function ticketsRepo(db: Db) {
  const get = (id: string): Ticket => {
    const row = db.prepare("SELECT * FROM tickets WHERE id = ? OR ref = ?").get(id, id);
    if (!row) throw new NotFoundError("ticket", id);
    return fromRow<Ticket>(row, T_SPEC);
  };

  const nextRef = (): string => {
    const row = db
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('ticket_seq', '1')
         ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
         RETURNING value`,
      )
      .get() as { value: string };
    return `t${row.value}`;
  };

  const insertRefs = (ticketId: string, messageId: string | null, refs: RefInput[], ts: string) => {
    for (const r of refs) {
      const { sql, values } = insertSql("ticket_refs", {
        id: newId("rf"),
        ticketId,
        messageId,
        refType: r.refType,
        target: r.target,
        label: r.label ?? "",
        createdAt: ts,
      });
      db.prepare(sql).run(...values);
    }
  };

  const insertMessage = (ticketId: string, m: MessageInput, ts: string): string => {
    const id = newId("tm");
    const { sql, values } = insertSql(
      "ticket_messages",
      {
        id,
        ticketId,
        author: m.author,
        body: m.body ?? "",
        options: m.options ?? null,
        recommended: m.recommended ?? null,
        recommendation: m.recommendation ?? null,
        chosen: m.chosen ?? null,
        createdAt: ts,
      },
      M_SPEC,
    );
    db.prepare(sql).run(...values);
    insertRefs(ticketId, id, m.refs ?? [], ts);
    return id;
  };

  /** Apply a machine event, persist the status, and wake the owner if the machine says so. */
  const apply = (t: Ticket, ev: TicketEvent, now: Date, payload: Record<string, unknown> = {}): TicketStatus => {
    const r = transitionTicket(t.status, ev);
    if (!r.ok) throw new TransitionError(r.error);
    const ts = nowIso(now);
    db.prepare(
      `UPDATE tickets SET status = ?, updated_at = ?,
         closed_at = CASE WHEN ? = 'closed' THEN ? ELSE NULL END,
         woke_at = CASE WHEN ? THEN ? ELSE woke_at END
       WHERE id = ?`,
    ).run(r.status, ts, r.status, ts, r.wake ? 1 : 0, ts, t.id);
    if (r.wake) {
      emitWake(db, { sessionId: t.ownerSession, kind: r.wake, entityType: "ticket", entityId: t.id, payload: { ref: t.ref, ...payload } }, now);
    }
    return r.status;
  };

  const actions = (ticketId: string) =>
    fromRows<PlannedAction>(
      db.prepare("SELECT * FROM planned_actions WHERE ticket_id = ? ORDER BY seq").all(ticketId),
      A_SPEC,
    );

  return {
    get,

    detail(id: string): TicketDetail {
      const t = get(id);
      return {
        ...t,
        messages: fromRows<TicketMessage>(
          db.prepare("SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, rowid").all(t.id),
          M_SPEC,
        ),
        attachments: fromRows<Attachment>(
          db.prepare("SELECT * FROM attachments WHERE ticket_id = ? ORDER BY created_at").all(t.id),
        ),
        refs: fromRows<TicketRef>(db.prepare("SELECT * FROM ticket_refs WHERE ticket_id = ? ORDER BY created_at").all(t.id)),
        actions: actions(t.id),
        engram: fromRows<EngramLink>(
          db.prepare("SELECT * FROM engram_links WHERE entity_type = 'ticket' AND entity_id = ? ORDER BY created_at").all(t.id),
        ),
      };
    },

    list(f: { status?: TicketStatus; open?: boolean } = {}): Ticket[] {
      const where: string[] = [];
      const args: string[] = [];
      if (f.status) {
        where.push("status = ?");
        args.push(f.status);
      }
      if (f.open) where.push("status <> 'closed'");
      return fromRows<Ticket>(
        db
          .prepare(`SELECT * FROM tickets ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC`)
          .all(...args),
        T_SPEC,
      );
    },

    create(input: TicketInput, now = new Date()): TicketDetail {
      const id = newId("tk");
      const ts = nowIso(now);
      const status = initialTicketStatus(input.direction);
      return tx(db, () => {
        ensureSession(db, input.ownerSession, now);
        const ref = nextRef();
        const { sql, values } = insertSql(
          "tickets",
          {
            id,
            ref,
            direction: input.direction,
            title: input.title,
            status,
            project: input.project ?? "",
            ownerSession: input.ownerSession ?? null,
            itemId: input.itemId ?? null,
            isSample: input.isSample ?? false,
            createdAt: ts,
            updatedAt: ts,
          },
          T_SPEC,
        );
        db.prepare(sql).run(...values);
        insertMessage(
          id,
          {
            author: input.direction === "claude_asks" ? "claude" : "andres",
            body: input.body,
            options: input.options,
            recommended: input.recommended,
            recommendation: input.recommendation,
            refs: input.refs,
          },
          ts,
        );
        if (input.direction === "andres_asks") {
          // A new request goes to its owner if one was named, otherwise to any session.
          emitWake(db, { sessionId: input.ownerSession ?? null, kind: "ticket.created", entityType: "ticket", entityId: id, payload: { ref } }, now);
        }
        return this.detail(id);
      });
    },

    addMessage(id: string, m: MessageInput, now = new Date()): TicketDetail {
      return tx(db, () => {
        let t = get(id);
        if (m.author === "claude" && m.session && !t.ownerSession) {
          ensureSession(db, m.session, now);
          db.prepare("UPDATE tickets SET owner_session = ? WHERE id = ?").run(m.session, t.id);
          t = get(t.id);
        }
        const msgId = insertMessage(t.id, m, nowIso(now));
        if (m.author === "andres") touchInteraction(db, now);
        apply(t, { type: m.author === "andres" ? "andres_reply" : "claude_reply" }, now, {
          messageId: msgId,
          chosen: m.chosen ?? null,
        });
        return this.detail(t.id);
      });
    },

    /** Claude posts (or replaces) its plan. needs_ok actions put the ticket on Andrés. */
    plan(id: string, list: ActionInput[], session?: string, now = new Date()): TicketDetail {
      return tx(db, () => {
        let t = get(id);
        if (session && !t.ownerSession) {
          ensureSession(db, session, now);
          db.prepare("UPDATE tickets SET owner_session = ? WHERE id = ?").run(session, t.id);
          t = get(t.id);
        }
        const ts = nowIso(now);
        db.prepare("DELETE FROM planned_actions WHERE ticket_id = ? AND state = 'planned'").run(t.id);
        const base = (db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM planned_actions WHERE ticket_id = ?").get(t.id) as { s: number }).s;
        list.forEach((a, i) => {
          const { sql, values } = insertSql(
            "planned_actions",
            {
              id: newId("pa"),
              ticketId: t.id,
              seq: base + i + 1,
              kind: a.kind,
              source: a.source,
              label: a.label,
              mode: a.mode,
              state: a.mode === "direct" ? "approved" : "planned",
              target: a.target ?? {},
              createdAt: ts,
              updatedAt: ts,
            },
            A_SPEC,
          );
          db.prepare(sql).run(...values);
        });
        apply(t, { type: "claude_plan", needsOk: list.some((a) => a.mode === "needs_ok") }, now);
        return this.detail(t.id);
      });
    },

    /** Andrés OKs the plan. Actions listed in `reject` are dropped; the rest are approved. */
    approvePlan(id: string, reject: string[] = [], now = new Date()): TicketDetail {
      return tx(db, () => {
        const t = get(id);
        const ts = nowIso(now);
        for (const a of actions(t.id)) {
          if (a.state !== "planned") continue;
          const state: ActionState = reject.includes(a.id) ? "rejected" : "approved";
          db.prepare("UPDATE planned_actions SET state = ?, updated_at = ? WHERE id = ?").run(state, ts, a.id);
        }
        apply(t, { type: "approve_plan" }, now, { rejected: reject });
        touchInteraction(db, now);
        return this.detail(t.id);
      });
    },

    setActionState(actionId: string, state: ActionState, now = new Date()): PlannedAction {
      const r = db
        .prepare("UPDATE planned_actions SET state = ?, updated_at = ? WHERE id = ?")
        .run(state, nowIso(now), actionId);
      if (!r.changes) throw new NotFoundError("action", actionId);
      return fromRow<PlannedAction>(db.prepare("SELECT * FROM planned_actions WHERE id = ?").get(actionId), A_SPEC);
    },

    /** claim / close / reopen. */
    transition(
      id: string,
      ev: Extract<TicketEvent, { type: "claim" | "close" | "reopen" }>,
      session?: string,
      now = new Date(),
    ): TicketDetail {
      return tx(db, () => {
        let t = get(id);
        if (ev.type === "claim" && session) {
          ensureSession(db, session, now);
          db.prepare("UPDATE tickets SET owner_session = ? WHERE id = ?").run(session, t.id);
          t = get(t.id);
        }
        apply(t, ev, now);
        if ((ev.type === "close" && ev.by === "andres") || ev.type === "reopen") touchInteraction(db, now);
        return this.detail(t.id);
      });
    },

    addAttachment(
      id: string,
      a: Omit<Attachment, "id" | "ticketId" | "createdAt">,
      now = new Date(),
    ): Attachment {
      const t = get(id);
      const attId = newId("at");
      const { sql, values } = insertSql("attachments", { id: attId, ticketId: t.id, ...a, createdAt: nowIso(now) });
      db.prepare(sql).run(...values);
      return fromRow<Attachment>(db.prepare("SELECT * FROM attachments WHERE id = ?").get(attId));
    },
  };
}
