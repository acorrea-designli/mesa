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
  ValidationError,
} from "../db/util";
import { identity } from "../config/identity";
import { inferKind } from "../domain/dispatch-kind";
import { initialTicketStatus, isPauseStatus, transitionTicket, type PauseKind, type TicketEvent } from "../domain/ticket-machine";
import { checklistProblem, findStep, groupChecklists, MAX_STEP_NOTE, stepCount, type StepInput } from "../domain/ticket-checklists";
import { answersBody, cardProblem, optionLabel, parseShorthand, type QuestionInput } from "../domain/ticket-questions";
import type {
  ActionMode,
  ActionState,
  Attachment,
  Author,
  EngramLink,
  PlannedAction,
  QuestionAnswer,
  RefType,
  Source,
  Station,
  StepBy,
  Ticket,
  TicketDetail,
  TicketDirection,
  TicketMessage,
  TicketOption,
  TicketQuestion,
  TicketRef,
  TicketStatus,
  TicketStep,
} from "../domain/types";
import { emitWake } from "../wake/wake";
import { ensureSession } from "./sessions";
import { tasksRepo } from "./tasks";
import { touchInteraction } from "./interaction";

/** Label of the ticket ref a folded ticket keeps to its primary: how unfold knows it was folded there. */
export const FOLDED_REF_LABEL = "Agrupado en";

/** Body of the "Pídeme permiso" message (the thread and the agent's context show it as written). */
export const PERMISSION_REQUEST_BODY = "Pídeme permiso";

const T_SPEC = { bool: ["is_sample"] };
const M_SPEC = { json: ["options"] };
const A_SPEC = { json: ["target"] };
const Q_SPEC = { json: ["options"] };

/** Reason a question gets when its ticket closes with it still open. */
export const CLOSED_WITHDRAW_REASON = "Ticket cerrado";

export interface RefInput {
  refType: RefType;
  target: string;
  label?: string;
}

export interface MessageInput {
  author: Author;
  body?: string;
  /** A question card (Claude): 1-6 questions of 2-6 options. Wins over the single-question `options`. */
  questions?: QuestionInput[];
  /** Andrés answers open card questions: a pick, his own words, or both, for any subset. */
  answers?: QuestionAnswer[];
  /** A checklist (Claude): 1-30 manual steps for Andrés on this message (t124). Not combined with a question card. */
  steps?: StepInput[];
  /** One question as before: becomes a 1-step card (with `recommended` and `recommendation`). */
  options?: TicketOption[];
  recommended?: string;
  recommendation?: string;
  chosen?: string;
  /** Set only by requestPermission ("Pídeme permiso"). */
  kind?: "permission_request";
  aboutMessageId?: string;
  refs?: RefInput[];
  /** The session posting (Claude messages). Becomes the owner if the ticket has none. */
  session?: string;
  /** A Claude message that is a question for Andrés (options imply it). Without it a reply is informational and does not put the ticket in "Te espera". */
  ask?: boolean;
}

export interface TicketInput {
  direction: TicketDirection;
  title: string;
  project?: string;
  ownerSession?: string;
  itemId?: string;
  /** The board card this ticket works (set by the dispatch service, src/lib/repo/dispatch.ts). */
  taskId?: string;
  /** Triage hint carried on the ticket.created wake (docs/TEAM.md § 4). */
  kind?: string;
  /** Internal, never on the API: skip the ticket.created wake (a batch dispatch sends one ticket.batch instead). */
  quiet?: boolean;
  isSample?: boolean;
  /** First message. Its author follows the direction. */
  body?: string;
  questions?: QuestionInput[];
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

/** The Tablero station a ticket's card sits in for each ticket status: the card follows the ticket. */
export const TASK_STATION_OF: Record<TicketStatus, Station> = {
  working: "doing",
  waiting_claude: "doing",
  waiting_andres: "waiting",
  closed: "done",
  paused: "waiting", // "En pausa": Esperando
  ongoing: "doing", // "En proceso": En curso
};

/** A ticket row with the ref of the ticket it is paused until (t126). */
const TICKET_SELECT = "SELECT t.*, d.ref AS paused_until FROM tickets t LEFT JOIN tickets d ON d.id = t.paused_until_ticket_id";

export function ticketsRepo(db: Db) {
  const tasks = tasksRepo(db);
  const get = (id: string): Ticket => {
    const row = db.prepare(`${TICKET_SELECT} WHERE t.id = ? OR t.ref = ?`).get(id, id);
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

  /** The card a message asks, or null: `questions` as given, or the single `options` question as a 1-step card. */
  const cardInput = (m: Pick<MessageInput, "questions" | "options" | "recommended" | "recommendation">): QuestionInput[] | null => {
    if (m.questions?.length) return m.questions;
    if (m.options?.length) return [{ text: "", options: m.options, recommended: m.recommended ?? null, recommendation: m.recommendation ?? null }];
    return null;
  };

  const insertQuestions = (ticketId: string, messageId: string, card: QuestionInput[], ts: string) => {
    card.forEach((q, i) => {
      const { sql, values } = insertSql(
        "ticket_questions",
        {
          id: newId("tq"),
          ticketId,
          messageId,
          n: i + 1,
          text: q.text?.trim() ?? "",
          options: q.options.map((o) => (o.detail ? { key: o.key, label: o.label, detail: o.detail } : { key: o.key, label: o.label })),
          recommended: q.recommended ?? null,
          recommendation: q.recommendation ?? null,
          state: "open",
          createdAt: ts,
        },
        Q_SPEC,
      );
      db.prepare(sql).run(...values);
    });
  };

  const questionsOf = (ticketId: string): TicketQuestion[] =>
    fromRows<TicketQuestion>(
      db
        .prepare(
          `SELECT q.* FROM ticket_questions q JOIN ticket_messages m ON m.id = q.message_id
            WHERE q.ticket_id = ? ORDER BY m.created_at, m.rowid, q.n`,
        )
        .all(ticketId),
      Q_SPEC,
    );

  const insertSteps = (ticketId: string, messageId: string, steps: StepInput[], ts: string) => {
    steps.forEach((x, i) => {
      const { sql, values } = insertSql("ticket_steps", {
        id: newId("ck"),
        ticketId,
        messageId,
        n: i + 1,
        text: x.text.trim(),
        detail: x.detail?.trim() || null,
        state: "open",
        createdAt: ts,
      });
      db.prepare(sql).run(...values);
    });
  };

  const stepsOf = (ticketId: string): TicketStep[] =>
    fromRows<TicketStep>(
      db
        .prepare(
          `SELECT s.* FROM ticket_steps s JOIN ticket_messages m ON m.id = s.message_id
            WHERE s.ticket_id = ? ORDER BY m.created_at, m.rowid, s.n`,
        )
        .all(ticketId),
    );

  const insertMessage = (ticketId: string, m: MessageInput, ts: string): string => {
    const id = newId("tm");
    const card = cardInput(m);
    if (m.steps) {
      if (m.author !== "claude") throw new ValidationError("only Claude posts a checklist");
      if (card) throw new ValidationError("a message is a question card or a checklist, not both");
      const problem = checklistProblem(m.steps);
      if (problem) throw new ValidationError(problem);
    }
    if (card) {
      if (m.author !== "claude") throw new ValidationError("only Claude asks questions");
      const problem = cardProblem(card, { requireText: card.length > 1 });
      if (problem) throw new ValidationError(problem);
    }
    // The card lives in ticket_questions; the message keeps only its words (the legacy option columns stay NULL).
    const { sql, values } = insertSql(
      "ticket_messages",
      {
        id,
        ticketId,
        author: m.author,
        body: m.body ?? "",
        options: null,
        recommended: null,
        recommendation: null,
        chosen: m.chosen ?? null,
        kind: m.kind ?? null,
        aboutMessageId: m.aboutMessageId ?? null,
        createdAt: ts,
      },
      M_SPEC,
    );
    db.prepare(sql).run(...values);
    insertRefs(ticketId, id, m.refs ?? [], ts);
    if (card) insertQuestions(ticketId, id, card, ts);
    if (m.steps?.length) insertSteps(ticketId, id, m.steps, ts);
    return id;
  };

  /**
   * The answers an Andrés message carries, checked against the ticket's open questions: explicit `answers`, a
   * `chosen` key (only with exactly one open question), or typed shorthand in the body ("1A 2C", a bare "A" with
   * exactly one open). A question outside the ticket, a key it does not have or a repeated question is a
   * ValidationError (400); a question that is not open a TransitionError (409). The caller's transaction rolls back.
   */
  const resolveAnswers = (ticketId: string, m: MessageInput): { answers: QuestionAnswer[]; qs: TicketQuestion[] } => {
    const qs = questionsOf(ticketId);
    const open = qs.filter((q) => q.state === "open");
    let answers: QuestionAnswer[] = [];
    if (m.answers?.length) answers = m.answers;
    else if (m.chosen) {
      if (open.length !== 1) throw new ValidationError(open.length ? "chosen needs exactly one open question; send answers" : "there is no open question to choose for");
      answers = [{ questionId: open[0]!.id, chosen: m.chosen }];
    } else if (m.body) answers = parseShorthand(m.body, open);
    const seen = new Set<string>();
    for (const a of answers) {
      const q = qs.find((x) => x.id === a.questionId);
      if (!q) throw new ValidationError(`question ${a.questionId} is not in this ticket`);
      if (seen.has(q.id)) throw new ValidationError(`question ${q.id} is answered twice`);
      seen.add(q.id);
      if (q.state !== "open") throw new TransitionError(`question ${q.id} is ${q.state}`);
      if (a.chosen && !q.options.some((o) => o.key === a.chosen)) throw new ValidationError(`question ${q.id} has no option ${a.chosen}`);
      if (!a.chosen && !a.text?.trim()) throw new ValidationError(`the answer to ${q.id} needs a chosen key or a text`);
    }
    return { answers, qs };
  };

  /**
   * The cards that follow a ticket: every card whose tasks.ticket_id is the ticket, plus the ticket's own card
   * (tickets.task_id) while that card has no ticket yet or points back at it.
   */
  const cardsOf = (t: Ticket): { id: string; station: Station }[] =>
    db
      .prepare("SELECT id, station FROM tasks WHERE ticket_id = ? OR (id = ? AND (ticket_id IS NULL OR ticket_id = ?)) ORDER BY created_at, id")
      .all(t.id, t.taskId ?? "", t.id) as { id: string; station: Station }[];

  /** Apply a machine event, persist the status, and wake the owner if the machine says so (`quiet`: never wake). */
  const apply = (t: Ticket, ev: TicketEvent, now: Date, payload: Record<string, unknown> = {}, quiet = false): TicketStatus => {
    const r = transitionTicket(t.status, ev);
    if (!r.ok) throw new TransitionError(r.error);
    const ts = nowIso(now);
    db.prepare(
      `UPDATE tickets SET status = ?, updated_at = ?,
         closed_at = CASE WHEN ? = 'closed' THEN ? ELSE NULL END,
         woke_at = CASE WHEN ? THEN ? ELSE woke_at END
       WHERE id = ?`,
    ).run(r.status, ts, r.status, ts, r.wake && !quiet ? 1 : 0, ts, t.id);
    // The pause fields only live while the ticket is paused/ongoing (pause() writes them after this).
    if (!isPauseStatus(r.status)) db.prepare("UPDATE tickets SET pause_reason = NULL, paused_until_ticket_id = NULL, paused_at = NULL WHERE id = ?").run(t.id);
    // Closing withdraws what is still open; a reopen does not bring it back (Claude asks again if it still matters).
    if (r.status === "closed") {
      db.prepare("UPDATE ticket_questions SET state = 'withdrawn', withdraw_reason = ? WHERE ticket_id = ? AND state = 'open'").run(CLOSED_WITHDRAW_REASON, t.id);
    }
    // The cards follow the ticket, in the same transaction and through tasks.move (so the Project sync fires).
    // Only a status change moves them, and only the ones that are elsewhere: a manual move stands until the next change.
    // A primary ticket moves every card grouped into it; a folded ticket moves none (its card points at the primary).
    if (r.status !== t.status) {
      const target = TASK_STATION_OF[r.status];
      for (const card of cardsOf(t)) if (card.station !== target) tasks.move(card.id, target, undefined, now, { system: true });
    }
    if (r.wake && !quiet) {
      emitWake(db, { sessionId: t.ownerSession, kind: r.wake, entityType: "ticket", entityId: t.id, payload: { ref: t.ref, ...payload } }, now);
    }
    // Whatever closed it (close, fold), the tickets paused until this one come back, in the same transaction.
    if (r.status === "closed" && t.status !== "closed") resumeDependents(t, now);
    return r.status;
  };

  /**
   * Every ticket paused until `t` resumes: back to Claude (waiting_claude), a system line in its thread and a
   * ticket.resumed { ref, ticketRef, by: "dependency", dependencyRef } wake to its owner. A dependent that is no longer
   * paused (closed, resumed by hand, switched to ongoing) is not selected, so there is nothing to skip or throw on.
   */
  const resumeDependents = (t: Ticket, now: Date) => {
    const deps = db.prepare("SELECT id FROM tickets WHERE paused_until_ticket_id = ? AND status = 'paused' ORDER BY created_at, id").all(t.id) as { id: string }[];
    for (const { id } of deps) {
      const d = get(id);
      insertMessage(d.id, { author: "claude", body: `Se cerró ${t.ref}: vuelve a Claude` }, nowIso(now));
      apply(d, { type: "resume", by: "dependency" }, now, { ticketRef: d.ref, by: "dependency", dependencyRef: t.ref });
    }
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
        questions: questionsOf(t.id),
        checklists: groupChecklists(stepsOf(t.id)),
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

    /**
     * Ids of the tickets with a message Andrés has not seen: one not written by him, newer than
     * the last time he opened the ticket (never opened = every such message). His own messages
     * never count.
     */
    unreadIds(): Set<string> {
      const rows = db
        .prepare(
          `SELECT DISTINCT m.ticket_id AS id FROM ticket_messages m
             LEFT JOIN ticket_reads r ON r.ticket_id = m.ticket_id
            WHERE m.author <> 'andres' AND m.created_at > COALESCE(r.seen_at, '')`,
        )
        .all() as { id: string }[];
      return new Set(rows.map((x) => x.id));
    },

    /** Andrés opened the ticket (or a message arrived on the one he has open): clear its flag. */
    markSeen(id: string, now = new Date()): { ticketId: string; seenAt: string } {
      const t = get(id);
      return db
        .prepare(
          `INSERT INTO ticket_reads (ticket_id, seen_at) VALUES (?, ?)
           ON CONFLICT(ticket_id) DO UPDATE SET seen_at = MAX(seen_at, excluded.seen_at)
           RETURNING ticket_id AS ticketId, seen_at AS seenAt`,
        )
        .get(t.id, nowIso(now)) as { ticketId: string; seenAt: string };
    },

    /**
     * "Marcar todo como leído": every ticket that is unread right now gets seen_at = now (same
     * MAX rule as markSeen), in one transaction. A message that lands later is newer and flags again.
     */
    markAllSeen(now = new Date()): { count: number; seenAt: string } {
      const seenAt = nowIso(now);
      return tx(db, () => {
        const ids = [...this.unreadIds()];
        const upsert = db.prepare(
          `INSERT INTO ticket_reads (ticket_id, seen_at) VALUES (?, ?)
           ON CONFLICT(ticket_id) DO UPDATE SET seen_at = MAX(seen_at, excluded.seen_at)`,
        );
        for (const id of ids) upsert.run(id, seenAt);
        return { count: ids.length, seenAt };
      });
    },

    list(f: { status?: TicketStatus; open?: boolean } = {}): Ticket[] {
      const where: string[] = [];
      const args: string[] = [];
      if (f.status) {
        where.push("t.status = ?");
        args.push(f.status);
      }
      if (f.open) where.push("t.status <> 'closed'");
      return fromRows<Ticket>(
        db
          .prepare(`${TICKET_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY t.updated_at DESC`)
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
            taskId: input.taskId ?? null,
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
            questions: input.questions,
            options: input.options,
            recommended: input.recommended,
            recommendation: input.recommendation,
            refs: input.refs,
          },
          ts,
        );
        if (input.direction === "andres_asks" && !input.quiet) {
          // A new request goes to its owner if one was named, otherwise to any session.
          // Payload: { ref, ticketRef, taskId, kind? } (ref is kept for older handlers).
          const payload: Record<string, unknown> = { ref, ticketRef: ref, taskId: input.taskId ?? null };
          if (input.kind) payload.kind = input.kind;
          emitWake(db, { sessionId: input.ownerSession ?? null, kind: "ticket.created", entityType: "ticket", entityId: id, payload }, now);
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
        if (m.author === "claude" && (m.answers?.length || m.chosen)) throw new ValidationError(`only ${identity().ownerName} answers questions`);
        // His answers: explicit, a lone chosen key, or typed shorthand ("1A 2C"; a bare "A" with one open question).
        // A reply that answers nothing closes nothing: every open question stays open until answered or withdrawn.
        const { answers, qs } = m.author === "andres" ? resolveAnswers(t.id, m) : { answers: [], qs: [] };
        if (answers.length) {
          const one = answers.length === 1 ? answers[0]! : null;
          m = { ...m, body: m.body?.trim() ? m.body : answersBody(answers, questionsOf(t.id)), chosen: one?.chosen ?? undefined };
        }
        const ts = nowIso(now);
        const msgId = insertMessage(t.id, { ...m, answers: undefined }, ts);
        const answered = answers.map((a) => {
          const q = qs.find((x) => x.id === a.questionId)!;
          const text = a.text?.trim() || null;
          db.prepare(
            "UPDATE ticket_questions SET state = 'answered', chosen = ?, answer_text = ?, answer_message_id = ?, answered_at = ? WHERE id = ? AND state = 'open'",
          ).run(a.chosen ?? null, text, msgId, ts, q.id);
          return { questionId: q.id, n: q.n, chosen: a.chosen ?? null, label: optionLabel(q, a.chosen) || null, text };
        });
        if (m.author === "andres") touchInteraction(db, now);
        const ev: TicketEvent = m.author === "andres" ? { type: "andres_reply" } : { type: "claude_reply", asks: Boolean(m.ask || cardInput(m) || m.steps?.length) };
        // ticket.answered { ref, messageId, chosen, answers: [{ questionId, n, chosen, label, text }], openLeft }
        const payload: Record<string, unknown> = { messageId: msgId, chosen: m.chosen ?? null };
        if (m.author === "andres") {
          payload.answers = answered;
          payload.openLeft = (db.prepare("SELECT COUNT(*) AS n FROM ticket_questions WHERE ticket_id = ? AND state = 'open'").get(t.id) as { n: number }).n;
        }
        apply(t, ev, now, payload);
        return this.detail(t.id);
      });
    },

    /** Every checklist of a ticket (t124), oldest first, with its steps and done / total. */
    checklists(id: string) {
      return groupChecklists(stepsOf(get(id).id));
    },

    /**
     * Sets one checklist step (t124): `done` true or false, by Andrés (the board, the phone) or by Claude (the CLI, with
     * a one-line `note` of what it verified). `step` names it as findStep does (a step id, <message>.<n> or a bare n).
     * 404 when the ticket does not have it, 400 when a bare n names steps of several checklists, 409 on a closed ticket.
     * Idempotent: setting the state a step already has changes nothing (not even its owner or note) and wakes nobody.
     * A real change by Andrés is his turn taken (andresActed, his interaction) and wakes the owner with
     * ticket.checklist { ref, ticketRef, messageId, stepId, n, done, doneCount, total, allDone }; Claude's own marks
     * never wake. Open steps stay in "Te espera" through ticketNeeds.
     */
    setStep(id: string, step: string, o: { done: boolean; by: StepBy; note?: string | null }, now = new Date()): TicketDetail {
      return tx(db, () => {
        const t = get(id);
        const found = findStep(stepsOf(t.id), step);
        if ("error" in found) {
          if (found.error === "ambiguous") throw new ValidationError(found.message);
          throw new NotFoundError("step", step);
        }
        const cur = found.step;
        if (t.status === "closed") throw new TransitionError("ticket is closed; reopen it first");
        const target = o.done ? "done" : "open";
        if (cur.state === target) return this.detail(t.id);
        const note = o.by === "claude" && o.done ? o.note?.replace(/\s+/g, " ").trim().slice(0, MAX_STEP_NOTE) || null : null;
        const ts = nowIso(now);
        db.prepare("UPDATE ticket_steps SET state = ?, done_by = ?, done_at = ?, note = ? WHERE id = ?").run(
          target,
          o.done ? o.by : null,
          o.done ? ts : null,
          note,
          cur.id,
        );
        db.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").run(ts, t.id);
        if (o.by === "andres") {
          touchInteraction(db, now);
          this.andresActed(t.id, now);
          const { done: doneCount, total } = stepCount(stepsOf(t.id).filter((x) => x.messageId === cur.messageId));
          db.prepare("UPDATE tickets SET woke_at = ? WHERE id = ?").run(ts, t.id);
          emitWake(
            db,
            {
              sessionId: t.ownerSession,
              kind: "ticket.checklist",
              entityType: "ticket",
              entityId: t.id,
              payload: { ref: t.ref, ticketRef: t.ref, messageId: cur.messageId, stepId: cur.id, n: cur.n, done: o.done, doneCount, total, allDone: doneCount === total },
            },
            now,
          );
        }
        return this.detail(t.id);
      });
    },

    /** Every card question of a ticket, in card then step order. */
    questions(id: string): TicketQuestion[] {
      return questionsOf(get(id).id);
    },

    /**
     * Claude withdraws an open question (moot, or his own words already answered it): it shows "retirada" with the
     * reason and stops counting as open. Never wakes, never changes the status. 404 unknown id, 409 not open.
     */
    withdrawQuestion(questionId: string, reason: string, now = new Date()): TicketQuestion {
      return tx(db, () => {
        const why = reason.trim();
        if (!why) throw new ValidationError("a withdrawal needs a reason");
        const row = db.prepare("SELECT * FROM ticket_questions WHERE id = ?").get(questionId);
        if (!row) throw new NotFoundError("question", questionId);
        const q = fromRow<TicketQuestion>(row, Q_SPEC);
        if (q.state !== "open") throw new TransitionError(`question ${q.id} is ${q.state}`);
        db.prepare("UPDATE ticket_questions SET state = 'withdrawn', withdraw_reason = ? WHERE id = ?").run(why, q.id);
        db.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").run(nowIso(now), q.ticketId);
        return fromRow<TicketQuestion>(db.prepare("SELECT * FROM ticket_questions WHERE id = ?").get(q.id), Q_SPEC);
      });
    },

    /**
     * "Pídeme permiso": Andrés asks the agent to file an approval card for the call it is blocked on. Posts a
     * marked message that refers to the latest Claude message and wakes the owner with
     * ticket.permission_requested { ref, ticketRef, messageId }. Mesa does nothing else: no settings file,
     * no rule. Refused on a closed ticket.
     */
    requestPermission(id: string, now = new Date()): TicketDetail {
      return tx(db, () => {
        const t = get(id);
        const about = db
          .prepare("SELECT id FROM ticket_messages WHERE ticket_id = ? AND author = 'claude' ORDER BY created_at DESC, rowid DESC LIMIT 1")
          .get(t.id) as { id: string } | undefined;
        const r = transitionTicket(t.status, { type: "permission_request" });
        if (!r.ok) throw new TransitionError(r.error);
        const msgId = insertMessage(t.id, { author: "andres", body: PERMISSION_REQUEST_BODY, kind: "permission_request", aboutMessageId: about?.id }, nowIso(now));
        touchInteraction(db, now);
        apply(t, { type: "permission_request" }, now, { ticketRef: t.ref, messageId: msgId });
        return this.detail(t.id);
      });
    },

    /**
     * Andrés pressed a button on one of the ticket's cards (a review action, a salida, a permission): his turn is
     * taken, so Te espera becomes Espera a Claude. Joins the caller's transaction. Never wakes (the press's own
     * wake already did), never errors, and touches nothing unless the ticket is waiting_andres. What he still owes
     * (another salida, permission, question, planned step) keeps showing as Te espera through ticketNeeds.
     */
    andresActed(id: string | null | undefined, now = new Date()): void {
      if (!id) return;
      tx(db, () => {
        const t = get(id);
        if (t.status === "waiting_andres") apply(t, { type: "andres_acted" }, now, {}, true);
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
        const planned = actions(t.id).filter((a) => a.state === "planned");
        // The machine decides on this fact, not on the status; a failed transition rolls the whole tx back.
        for (const a of planned) {
          const state: ActionState = reject.includes(a.id) ? "rejected" : "approved";
          db.prepare("UPDATE planned_actions SET state = ?, updated_at = ? WHERE id = ?").run(state, ts, a.id);
        }
        apply(t, { type: "approve_plan", planned: planned.length > 0 }, now, { rejected: reject });
        touchInteraction(db, now);
        return this.detail(t.id);
      });
    },

    /**
     * Andrés pre-approves single needs_ok steps from the plan (tapping the "te pide OK" chip, which then reads "autoaprobado"; revokeActions is the way back). Only planned needs_ok
     * steps of this ticket qualify. While other steps stay planned the status does not move and the wake says
     * `partial: true` (the owner runs only the approved steps); when none remain it is the full approval.
     * Andrés only: the sessions' PATCH /api/actions/:id never accepts "approved".
     */
    approveActions(id: string, only: string[], now = new Date()): TicketDetail {
      return tx(db, () => {
        const t = get(id);
        if (t.status === "closed") throw new TransitionError("ticket is closed; reopen it first");
        const ids = [...new Set(only)];
        const planned = actions(t.id).filter((a) => a.state === "planned");
        const picked = ids.map((x) => planned.find((a) => a.id === x && a.mode === "needs_ok"));
        if (!ids.length || picked.some((a) => !a)) throw new TransitionError("only planned steps that ask for OK can be approved");
        const ts = nowIso(now);
        for (const a of picked) db.prepare("UPDATE planned_actions SET state = 'approved', updated_at = ? WHERE id = ?").run(ts, a!.id);
        touchInteraction(db, now);
        if (planned.length === picked.length) apply(t, { type: "approve_plan", planned: true }, now, { approved: ids, partial: false });
        else {
          db.prepare("UPDATE tickets SET updated_at = ?, woke_at = ? WHERE id = ?").run(ts, ts, t.id);
          emitWake(db, { sessionId: t.ownerSession, kind: "ticket.plan_approved", entityType: "ticket", entityId: t.id, payload: { ref: t.ref, approved: ids, partial: true } }, now);
        }
        return this.detail(t.id);
      });
    },

    /**
     * Andrés takes back a pre-approval ("autoaprobado" -> "te pide OK"). Only approved needs_ok steps of a non-closed
     * ticket go back to planned, and only while the plan still has other planned steps (once the plan is approved in
     * full the owner is working). A step the owner already marked running, done or failed is refused. Both writers
     * are guarded on the same row: this revoke only takes an `approved` step (UPDATE ... WHERE state = 'approved'),
     * and setActionState only moves a needs_ok step to running/done/failed from `approved` or `running`, so a revoke
     * and a running mark cannot both win; the owner marks `running` before it starts. The wake
     * is `ticket.plan_approved { revoked, partial: true }` (no `approved` key): those ids must not run.
     */
    revokeActions(id: string, revoke: string[], now = new Date()): TicketDetail {
      return tx(db, () => {
        const t = get(id);
        if (t.status === "closed") throw new TransitionError("ticket is closed; reopen it first");
        const ids = [...new Set(revoke)];
        const all = actions(t.id);
        const picked = ids.map((x) => all.find((a) => a.id === x && a.mode === "needs_ok"));
        if (!ids.length || picked.some((a) => !a)) throw new TransitionError("only approved steps that ask for OK can be taken back");
        if (picked.some((a) => a!.state === "running" || a!.state === "done" || a!.state === "failed")) throw new TransitionError("Claude already started that step; it cannot be taken back");
        if (picked.some((a) => a!.state !== "approved")) throw new TransitionError("only approved steps that ask for OK can be taken back");
        if (!all.some((a) => a.state === "planned")) throw new TransitionError("the plan was already approved in full; Claude may have started");
        const ts = nowIso(now);
        for (const a of picked) db.prepare("UPDATE planned_actions SET state = 'planned', updated_at = ? WHERE id = ? AND state = 'approved'").run(ts, a!.id);
        touchInteraction(db, now);
        db.prepare("UPDATE tickets SET updated_at = ?, woke_at = ? WHERE id = ?").run(ts, ts, t.id);
        emitWake(db, { sessionId: t.ownerSession, kind: "ticket.plan_approved", entityType: "ticket", entityId: t.id, payload: { ref: t.ref, revoked: ids, partial: true } }, now);
        return this.detail(t.id);
      });
    },

    /**
     * A session reports a step as running, done or failed (PATCH /api/actions/:id). A needs_ok step may only move to
     * those states from `approved` or `running`: a step Andrés took back (planned), rejected, or never approved is
     * refused with a TransitionError (409), and a failed or done step needs a new approval before it runs again.
     * Direct steps are unguarded. The guard is part of the UPDATE's WHERE, so a revoke and a running mark race on
     * the same row and exactly one wins. Repeating the current state is a no-op; an unknown id is a 404.
     */
    setActionState(actionId: string, state: ActionState, now = new Date()): PlannedAction {
      const started = state === "running" || state === "done" || state === "failed";
      const guard = started ? " AND (mode = 'direct' OR state IN ('approved','running'))" : "";
      const r = db
        .prepare(`UPDATE planned_actions SET state = ?, updated_at = ? WHERE id = ? AND state <> ?${guard}`)
        .run(state, nowIso(now), actionId, state);
      const row = db.prepare("SELECT * FROM planned_actions WHERE id = ?").get(actionId);
      if (!row) throw new NotFoundError("action", actionId);
      const a = fromRow<PlannedAction>(row, A_SPEC);
      if (!r.changes && a.state !== state) throw new TransitionError(`step is not approved; ${identity().ownerName} took it back or never approved it`);
      return a;
    },

    /**
     * "En pausa" (blocked on something else; `untilTicket` = the open ticket whose closing resumes it) or "En proceso"
     * (going on with nobody active: CI, a third party). Needs a reason. Allowed from any open status, and again to
     * change the reason, the dependency or the kind. 409 on a closed ticket; 400 on an empty reason, an until-ticket that
     * is unknown, closed or the ticket itself, or an until-ticket on an ongoing one. It never wakes. Andrés's pause
     * (`by: "andres"`, the UI) is an interaction of his; Claude's (the CLI) is not.
     */
    pause(id: string, o: { kind: PauseKind; reason: string; untilTicket?: string; by: "andres" | "claude" }, now = new Date()): TicketDetail {
      return tx(db, () => {
        const t = get(id);
        const ev: TicketEvent = { type: "pause", kind: o.kind };
        const check = transitionTicket(t.status, ev);
        if (!check.ok) throw new TransitionError(check.error);
        const reason = o.reason.trim();
        if (!reason) throw new ValidationError("a pause needs a reason");
        let until: string | null = null;
        if (o.untilTicket) {
          if (o.kind !== "paused") throw new ValidationError("only a paused ticket can wait for another ticket");
          const dep = db.prepare("SELECT id, ref, status FROM tickets WHERE id = ? OR ref = ?").get(o.untilTicket, o.untilTicket) as { id: string; ref: string; status: TicketStatus } | undefined;
          if (!dep) throw new ValidationError(`ticket ${o.untilTicket} does not exist`);
          if (dep.id === t.id) throw new ValidationError("a ticket cannot wait for itself");
          if (dep.status === "closed") throw new ValidationError(`${dep.ref} is already closed`);
          until = dep.id;
        }
        apply(t, ev, now);
        const ts = nowIso(now);
        // paused_at is when the ticket entered paused/ongoing; changing the reason or switching kind restarts it.
        db.prepare("UPDATE tickets SET pause_reason = ?, paused_until_ticket_id = ?, paused_at = ? WHERE id = ?").run(reason, until, ts, t.id);
        if (o.by === "andres") touchInteraction(db, now);
        return this.detail(t.id);
      });
    },

    /**
     * Paused/ongoing ends by hand. `by: "claude"` (the CLI): working, no wake. `by: "andres"` (the UI "Reanudar"):
     * waiting_claude and ticket.resumed { ref, ticketRef, by: "andres" } to the owner. 409 unless paused or ongoing.
     * (A dependency closing resumes through apply, see resumeDependents.)
     */
    resume(id: string, o: { by: "andres" | "claude" }, now = new Date()): TicketDetail {
      return tx(db, () => {
        const t = get(id);
        apply(t, { type: "resume", by: o.by }, now, { ticketRef: t.ref, by: o.by });
        if (o.by === "andres") touchInteraction(db, now);
        return this.detail(t.id);
      });
    },

    /** claim / close / reopen. `reason` rides on the ticket.reopened wake. */
    transition(
      id: string,
      ev: Extract<TicketEvent, { type: "claim" | "close" | "reopen" }>,
      session?: string,
      now = new Date(),
      reason?: string,
    ): TicketDetail {
      return tx(db, () => {
        let t = get(id);
        if (ev.type === "claim" && session) {
          ensureSession(db, session, now);
          db.prepare("UPDATE tickets SET owner_session = ? WHERE id = ?").run(session, t.id);
          t = get(t.id);
        }
        apply(t, ev, now, ev.type === "reopen" && reason ? { reason } : {});
        if ((ev.type === "close" && ev.by === "andres") || (ev.type === "reopen" && ev.by !== "claude")) touchInteraction(db, now);
        return this.detail(t.id);
      });
    },

    /**
     * Reopen a closed ticket on Mesa's own account (a new PR head, see reviews.noteHead). It is not an
     * Andrés interaction, so it does not touch the interaction clock. `payload` rides on the ticket.reopened wake;
     * `quiet` reopens without it (the caller sends its own, more specific wake).
     */
    reopenBySystem(id: string, payload: Record<string, unknown>, now = new Date(), o: { quiet?: boolean } = {}): TicketDetail {
      return tx(db, () => {
        const t = get(id);
        apply(t, { type: "reopen" }, now, payload, o.quiet);
        return this.detail(t.id);
      });
    },

    /**
     * Mesa's own informational line on a ticket (repo/intake.ts: a Slack message about the ticket's PR). Written as
     * Claude, it never changes the status (so an unclaimed request stays claimable and nothing lands in Te espera),
     * never wakes and works on a closed ticket too. It does flag the ticket unread, like any message not by Andrés.
     */
    note(id: string, m: { body: string; refs?: RefInput[] }, now = new Date()): string {
      return tx(db, () => {
        const t = get(id);
        const ts = nowIso(now);
        const msgId = insertMessage(t.id, { author: "claude", body: m.body, refs: m.refs }, ts);
        db.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").run(ts, t.id);
        return msgId;
      });
    },

    /**
     * The lead groups same-topic tickets of a ticket.batch: the `from` tickets fold into `primary`, one owner for all.
     * One transaction. Their cards point at the primary and join its card's station; their refs are copied to the
     * primary (deduped by target) plus a ticket ref to each; the primary gets ONE informational message
     * "Agrupé: t25 «título», … porque <why>" (no status change); each folded ticket gets "Agrupado en tN: <why>" and
     * closes without a wake and without moving any card. 409 when the primary or a folded ticket is closed, a sample
     * or not an andres_asks request, or when `from` contains the primary. Idempotent for the lead: a ticket that is
     * already closed (folded) is refused, so run it only on the tickets still open.
     */
    fold(primaryId: string, o: { from: string[]; why: string; session?: string }, now = new Date()): TicketDetail {
      return tx(db, () => {
        let p = get(primaryId);
        const froms = [...new Map(o.from.map((x) => get(x)).map((x) => [x.id, x])).values()];
        if (!froms.length) throw new TransitionError("nothing to fold: name at least one ticket");
        if (froms.some((f) => f.id === p.id)) throw new TransitionError(`${p.ref} cannot be folded into itself`);
        for (const t of [p, ...froms]) {
          if (t.status === "closed") throw new TransitionError(`${t.ref} is closed`);
          if (t.isSample) throw new TransitionError(`${t.ref} is a sample ticket`);
          if (t.direction !== "andres_asks") throw new TransitionError(`${t.ref} is not an ${identity().ownerName} request`);
        }
        const why = o.why.trim();
        const ts = nowIso(now);
        if (o.session && !p.ownerSession) {
          ensureSession(db, o.session, now);
          db.prepare("UPDATE tickets SET owner_session = ? WHERE id = ?").run(o.session, p.id);
          p = get(p.id);
        }
        // Cards: those of the folded tickets join the primary and its card's station.
        const own = p.taskId ? (db.prepare("SELECT station FROM tasks WHERE id = ?").get(p.taskId) as { station: Station } | undefined) : undefined;
        const station = own?.station ?? TASK_STATION_OF[p.status];
        const moved: string[] = [];
        for (const f of froms) {
          const ids = db.prepare("SELECT id FROM tasks WHERE ticket_id = ? OR (id = ? AND ticket_id IS NULL)").all(f.id, f.taskId ?? "") as { id: string }[];
          for (const c of ids) {
            db.prepare("UPDATE tasks SET ticket_id = ?, wait_on = 'claude', updated_at = ? WHERE id = ?").run(p.id, ts, c.id);
            moved.push(c.id);
          }
        }
        for (const id of moved) {
          const c = db.prepare("SELECT station FROM tasks WHERE id = ?").get(id) as { station: Station };
          if (c.station !== station) tasks.move(id, station, undefined, now, { system: true });
        }
        // Refs: theirs come over once, and the primary points at each folded ticket.
        const have = new Set((db.prepare("SELECT ref_type, target FROM ticket_refs WHERE ticket_id = ?").all(p.id) as { ref_type: string; target: string }[]).map((r) => `${r.ref_type}|${r.target}`));
        const add: RefInput[] = [];
        const queue = (r: RefInput) => {
          const key = `${r.refType}|${r.target}`;
          if (have.has(key)) return;
          have.add(key);
          add.push(r);
        };
        for (const f of froms) {
          const theirs = db.prepare("SELECT ref_type, target, label FROM ticket_refs WHERE ticket_id = ? ORDER BY created_at, rowid").all(f.id) as { ref_type: RefType; target: string; label: string }[];
          for (const r of theirs) {
            if (r.ref_type === "ticket" && [p.id, p.ref].includes(r.target)) continue;
            queue({ refType: r.ref_type, target: r.target, label: r.label });
          }
          queue({ refType: "ticket", target: f.ref, label: f.title });
        }
        insertRefs(p.id, null, add, ts);
        // Words: the primary hears it as information; each folded ticket explains where it went and closes quietly.
        insertMessage(p.id, { author: "claude", body: `Agrupé: ${froms.map((f) => `${f.ref} «${f.title}»`).join(", ")} porque ${why}` }, ts);
        for (const f of froms) {
          insertMessage(f.id, { author: "claude", body: `Agrupado en ${p.ref}: ${why}` }, ts);
          insertRefs(f.id, null, [{ refType: "ticket", target: p.ref, label: FOLDED_REF_LABEL }], ts);
          apply(get(f.id), { type: "close", by: "claude" }, now, {}, true);
        }
        db.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").run(ts, p.id);
        return this.detail(p.id);
      });
    },

    /**
     * Andrés splits a folded ticket out again (the lead runs it when he replies "separa t25"). The ticket reopens
     * unclaimed, its original card points back at it, both tickets say so, and the lead gets ticket.created
     * { ref, ticketRef, taskId, kind?, splitFrom } so the normal routing spawns its owner. 409 when `ticketId`
     * was not folded into `primaryId`.
     */
    unfold(primaryId: string, ticketId: string, now = new Date()): TicketDetail {
      return tx(db, () => {
        const p = get(primaryId);
        const f = get(ticketId);
        const mark = db
          .prepare("SELECT id FROM ticket_refs WHERE ticket_id = ? AND ref_type = 'ticket' AND target = ? AND label = ?")
          .get(f.id, p.ref, FOLDED_REF_LABEL) as { id: string } | undefined;
        if (f.status !== "closed" || !mark) throw new TransitionError(`${f.ref} was not folded into ${p.ref}`);
        const ts = nowIso(now);
        db.prepare("DELETE FROM ticket_refs WHERE id = ?").run(mark.id);
        db.prepare("DELETE FROM ticket_refs WHERE ticket_id = ? AND ref_type = 'ticket' AND target = ?").run(p.id, f.ref);
        // Its original card comes back only if it still sits with the primary.
        if (f.taskId) db.prepare("UPDATE tasks SET ticket_id = ?, updated_at = ? WHERE id = ? AND ticket_id = ?").run(f.id, ts, f.taskId, p.id);
        insertMessage(p.id, { author: "claude", body: `Separé ${f.ref} de este ticket` }, ts);
        insertMessage(f.id, { author: "claude", body: `Separado de ${p.ref}` }, ts);
        apply(f, { type: "reopen", by: "claude" }, now, {}, true);
        db.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").run(ts, p.id);
        const card = f.taskId ? (db.prepare("SELECT id FROM tasks WHERE id = ?").get(f.taskId) as { id: string } | undefined) : undefined;
        const kind = card ? inferKind(tasks.get(card.id).items ?? []) : undefined;
        const payload: Record<string, unknown> = { ref: f.ref, ticketRef: f.ref, taskId: card?.id ?? null, splitFrom: p.ref };
        if (kind) payload.kind = kind;
        emitWake(db, { sessionId: f.ownerSession, kind: "ticket.created", entityType: "ticket", entityId: f.id, payload }, now);
        return this.detail(f.id);
      });
    },

    addAttachment(
      id: string,
      a: Omit<Attachment, "id" | "ticketId" | "createdAt" | "reviewedAt">,
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
