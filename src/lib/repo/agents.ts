// Ephemeral agents: ticket briefs, handoffs (append-only), the team attached to a
// ticket, and the one-call resume payload. Nothing an agent needs may live only in
// its context window.
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { fromRow, fromRows, newId, nowIso, NotFoundError, TransitionError } from "../db/util";
import {
  ticketTopicKey,
  type Approval,
  type Brief,
  type EngramLink,
  type Finding,
  type Review,
  type Handoff,
  type HandoffStatus,
  type PlannedAction,
  type Salida,
  type TeamAgent,
  type TicketContext,
  type TicketMessage,
} from "../domain/types";
import { questionText } from "../domain/ticket-questions";
import { ticketsRepo } from "./tickets";

const BRIEF_SPEC = { json: ["decisions", "open_questions"] };
const HANDOFF_SPEC = { json: ["artifacts"] };
const TEAM_SPEC = { bool: ["owner"] };

export interface BriefInput {
  body?: string;
  goal?: string;
  decisions?: string[];
  planStep?: string;
  openQuestions?: string[];
  nextAction?: string;
  updatedBy?: string;
}

export interface HandoffInput {
  agent: string;
  role?: string;
  status: HandoffStatus;
  body?: string;
  done?: string;
  remaining?: string;
  artifacts?: Handoff["artifacts"];
}

export const DEFAULT_CONTEXT_MESSAGES = 20;

export function agentsRepo(db: Db) {
  const tickets = ticketsRepo(db);

  const brief = (ticketId: string): Brief | null => {
    const row = db.prepare("SELECT * FROM ticket_briefs WHERE ticket_id = ?").get(ticketId);
    return row ? fromRow<Brief>(row, BRIEF_SPEC) : null;
  };

  const handoffSelect = `SELECT h.*, t.ref AS ticket_ref FROM ticket_handoffs h JOIN tickets t ON t.id = h.ticket_id`;
  const teamSelect = `SELECT a.*, t.ref AS ticket_ref FROM ticket_team a JOIN tickets t ON t.id = a.ticket_id`;

  const getAgent = (name: string): TeamAgent => {
    const row = db.prepare(`${teamSelect} WHERE a.name = ?`).get(name);
    if (!row) throw new NotFoundError("agent", name);
    return fromRow<TeamAgent>(row, TEAM_SPEC);
  };

  const repo = {
    brief(ticketIdOrRef: string): Brief | null {
      return brief(tickets.get(ticketIdOrRef).id);
    },

    /** Replace the fields given; the rest stay. Each write bumps the revision. */
    putBrief(ticketIdOrRef: string, b: BriefInput, now = new Date()): Brief {
      const t = tickets.get(ticketIdOrRef);
      const cur = brief(t.id);
      const next = {
        body: b.body ?? cur?.body ?? "",
        goal: b.goal ?? cur?.goal ?? "",
        decisions: b.decisions ?? cur?.decisions ?? [],
        planStep: b.planStep ?? cur?.planStep ?? "",
        openQuestions: b.openQuestions ?? cur?.openQuestions ?? [],
        nextAction: b.nextAction ?? cur?.nextAction ?? "",
        updatedBy: b.updatedBy ?? cur?.updatedBy ?? "",
      };
      db.prepare(
        `INSERT INTO ticket_briefs (ticket_id, body, goal, decisions, plan_step, open_questions, next_action, revision, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(ticket_id) DO UPDATE SET body = excluded.body, goal = excluded.goal, decisions = excluded.decisions,
           plan_step = excluded.plan_step, open_questions = excluded.open_questions, next_action = excluded.next_action,
           revision = revision + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      ).run(
        t.id,
        next.body,
        next.goal,
        JSON.stringify(next.decisions),
        next.planStep,
        JSON.stringify(next.openQuestions),
        next.nextAction,
        next.updatedBy,
        nowIso(now),
      );
      return brief(t.id)!;
    },

    addHandoff(ticketIdOrRef: string, h: HandoffInput, now = new Date()): Handoff {
      const t = tickets.get(ticketIdOrRef);
      const id = newId("ho");
      db.prepare(
        `INSERT INTO ticket_handoffs (id, ticket_id, agent, role, status, body, done, remaining, artifacts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        t.id,
        h.agent,
        h.role ?? db.prepare("SELECT role FROM ticket_team WHERE name = ?").get(h.agent)?.role?.toString() ?? "",
        h.status,
        h.body ?? "",
        h.done ?? "",
        h.remaining ?? "",
        JSON.stringify(h.artifacts ?? {}),
        nowIso(now),
      );
      return fromRow<Handoff>(db.prepare(`${handoffSelect} WHERE h.id = ?`).get(id), HANDOFF_SPEC);
    },

    /** Newest first. */
    handoffs(f: { agent?: string; ticket?: string; limit?: number } = {}): Handoff[] {
      const where: string[] = [];
      const args: (string | number)[] = [];
      if (f.agent) {
        where.push("h.agent = ?");
        args.push(f.agent);
      }
      if (f.ticket) {
        where.push("h.ticket_id = ?");
        args.push(tickets.get(f.ticket).id);
      }
      args.push(f.limit ?? 100);
      return fromRows<Handoff>(
        db
          .prepare(`${handoffSelect} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY h.created_at DESC, h.rowid DESC LIMIT ?`)
          .all(...args),
        HANDOFF_SPEC,
      );
    },

    /** Attach an agent to a ticket. Names are never reused, even after retirement. */
    addAgent(i: { ticket: string; name: string; role: string; owner?: boolean }, now = new Date()): TeamAgent {
      const t = tickets.get(i.ticket);
      if (db.prepare("SELECT 1 FROM ticket_team WHERE name = ?").get(i.name)) {
        throw new TransitionError(`agent name ${i.name} was already used; names are never reused`);
      }
      return tx(db, () => {
        if (i.owner) db.prepare("UPDATE ticket_team SET owner = 0 WHERE ticket_id = ?").run(t.id);
        db.prepare(
          "INSERT INTO ticket_team (name, ticket_id, role, owner, status, spawned_at) VALUES (?, ?, ?, ?, 'live', ?)",
        ).run(i.name, t.id, i.role, i.owner ? 1 : 0, nowIso(now));
        return getAgent(i.name);
      });
    },

    retireAgent(name: string, now = new Date()): TeamAgent {
      const a = getAgent(name);
      if (a.status === "retired") return a;
      db.prepare("UPDATE ticket_team SET status = 'retired', retired_at = ? WHERE name = ?").run(nowIso(now), name);
      return getAgent(name);
    },

    agent: getAgent,

    team(f: { status?: "live" | "retired"; ticket?: string } = {}): TeamAgent[] {
      const where: string[] = [];
      const args: string[] = [];
      if (f.status) {
        where.push("a.status = ?");
        args.push(f.status);
      }
      if (f.ticket) {
        where.push("a.ticket_id = ?");
        args.push(tickets.get(f.ticket).id);
      }
      return fromRows<TeamAgent>(
        db.prepare(`${teamSelect} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.spawned_at`).all(...args),
        TEAM_SPEC,
      );
    },

    /** The resume payload: everything a fresh agent needs, nothing it does not. */
    context(ticketIdOrRef: string, messages = DEFAULT_CONTEXT_MESSAGES): TicketContext {
      const t = tickets.get(ticketIdOrRef);
      const b = brief(t.id);
      const msgs = fromRows<TicketMessage>(
        db
          .prepare(
            `SELECT id, ticket_id, author, body, options, recommended, recommendation, chosen, created_at FROM (
               SELECT *, rowid AS rid FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
             ) ORDER BY created_at, rid`,
          )
          .all(t.id, messages),
        { json: ["options"] },
      );
      const all = repo.handoffs({ ticket: t.id, limit: 500 });
      // Latest handoff per agent (all is newest first).
      const seen = new Set<string>();
      const handoffs = all.filter((h) => {
        if (seen.has(h.agent)) return false;
        seen.add(h.agent);
        return true;
      });
      // Every open card question counts as an open question too: "<tq id> · <step>. <text>" (the id is what withdraw takes).
      const questions = tickets.questions(t.id);
      const open = questions.filter((q) => q.state === "open");
      const bodyOf = (messageId: string) => (db.prepare("SELECT body FROM ticket_messages WHERE id = ?").get(messageId) as { body: string } | undefined)?.body ?? "";
      const pendingChoice = open.map((q) => `${q.id} · ${q.n}. ${questionText(q, bodyOf(q.messageId))}`);
      return {
        ticket: t,
        brief: b,
        plan: fromRows<PlannedAction>(db.prepare("SELECT * FROM planned_actions WHERE ticket_id = ? ORDER BY seq").all(t.id), { json: ["target"] }),
        messages: msgs,
        openQuestions: [...(b?.openQuestions ?? []), ...pendingChoice],
        questions,
        team: repo.team({ ticket: t.id }),
        handoffs,
        latestHandoff: all[0] ?? null,
        approvals: fromRows<Approval>(
          db
            .prepare("SELECT a.*, t.ref AS ticket_ref FROM approvals a LEFT JOIN tickets t ON t.id = a.ticket_id WHERE a.ticket_id = ? AND a.status = 'pending' ORDER BY a.created_at")
            .all(t.id),
          { json: ["hints"] },
        ),
        salidas: fromRows<Pick<Salida, "id" | "status" | "source" | "title" | "currentVersion">>(
          db
            .prepare(
              "SELECT id, status, source, title, current_version FROM salidas WHERE ticket_id = ? AND status NOT IN ('sent','denied','expired','deleted') ORDER BY created_at",
            )
            .all(t.id),
        ),
        findings: fromRows<Finding>(
          db
            .prepare(
              "SELECT f.*, r.repo, r.pr FROM review_findings f JOIN reviews r ON r.id = f.review_id WHERE r.ticket_id = ? ORDER BY r.repo, r.pr, f.n",
            )
            .all(t.id),
        ),
        reviews: fromRows<Omit<Review, "findings">>(db.prepare("SELECT * FROM reviews WHERE ticket_id = ? ORDER BY created_at").all(t.id)),
        engram: {
          topicKey: ticketTopicKey(t.ref),
          project: t.project,
          links: fromRows<EngramLink>(
            db.prepare("SELECT * FROM engram_links WHERE entity_type = 'ticket' AND entity_id = ? ORDER BY created_at").all(t.id),
          ),
        },
      };
    },
  };
  return repo;
}
