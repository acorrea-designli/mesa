// Permission approvals: a blocked tool call waits here until Andrés decides.
// Allow comes only from an explicit "allow" decision before expires_at. Every other
// outcome (deny, read_config, expiry) is a deny for the agent.
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { fromRow, fromRows, newId, NotFoundError, nowIso, TransitionError } from "../db/util";
import type { Approval, ApprovalDecision } from "../domain/types";
import { signal, waitSignal } from "../wake/wake";
import { ticketsRepo } from "./tickets";
import { touchInteraction } from "./interaction";

const SPEC = { json: ["hints"], bool: ["is_sample"] };
export const DEFAULT_APPROVAL_TTL_MS = 9 * 60_000;
export const MAX_APPROVAL_TTL_MS = 60 * 60_000;

export interface ApprovalInput {
  ticketRef?: string | null;
  agent: string;
  tool: string;
  summary: string;
  detail?: string;
  cwd?: string;
  hints?: string[];
  expiresAt?: string;
}

const SELECT = "SELECT a.*, t.ref AS ticket_ref FROM approvals a LEFT JOIN tickets t ON t.id = a.ticket_id";

export function approvalsRepo(db: Db) {
  const tickets = ticketsRepo(db);

  const raw = (id: string): Approval => {
    const row = db.prepare(`${SELECT} WHERE a.id = ?`).get(id);
    if (!row) throw new NotFoundError("approval", id);
    return fromRow<Approval>(row, SPEC);
  };

  const repo = {
    create(i: ApprovalInput, now = new Date()): Approval {
      const id = newId("ap");
      const ticketId = i.ticketRef ? tickets.get(i.ticketRef).id : null;
      const requested = i.expiresAt ? Date.parse(i.expiresAt) : now.getTime() + DEFAULT_APPROVAL_TTL_MS;
      const expires = Math.min(requested, now.getTime() + MAX_APPROVAL_TTL_MS);
      if (Number.isNaN(expires) || expires <= now.getTime()) throw new TransitionError("expiresAt must be in the future");
      db.prepare(
        `INSERT INTO approvals (id, ticket_id, agent, tool, summary, detail, cwd, hints, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(id, ticketId, i.agent, i.tool, i.summary, i.detail ?? "", i.cwd ?? "", JSON.stringify(i.hints ?? []), new Date(expires).toISOString(), nowIso(now));
      return raw(id);
    },

    /** Read with lazy expiry. */
    get(id: string, now = new Date()): Approval {
      repo.expire(now);
      return raw(id);
    },

    list(f: { status?: Approval["status"]; ticket?: string; hoy?: boolean } = {}, now = new Date()): Approval[] {
      repo.expire(now);
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
      if (f.hoy) where.push("a.ticket_id IS NULL");
      return fromRows<Approval>(
        db.prepare(`${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.created_at`).all(...args),
        SPEC,
      );
    },

    /** Refused after expires_at or once decided: a late "allow" can never reach an agent that was told no. */
    decide(id: string, d: { decision: ApprovalDecision; actor: string; note?: string }, now = new Date(), opts: { seed?: boolean } = {}): Approval {
      repo.expire(now);
      const a = raw(id);
      if (a.status === "expired") throw new TransitionError("this approval expired; the agent was already denied");
      if (a.status === "decided") throw new TransitionError(`already decided: ${a.decision}`);
      tx(db, () => {
        db.prepare(
          "UPDATE approvals SET status = 'decided', decision = ?, note = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
        ).run(d.decision, d.note ?? "", d.actor, nowIso(now), id);
        if (d.actor === "andres") touchInteraction(db, now);
        // His press takes his turn on the ticket (the seed builds sample states and is not a press).
        if (d.actor === "andres" && !opts.seed) tickets.andresActed(a.ticketId, now);
      });
      signal(`approval:${id}`);
      return raw(id);
    },

    /** Wait up to timeoutMs for a decision (or expiry); returns the current row either way. */
    async wait(id: string, timeoutMs: number, abort?: AbortSignal): Promise<Approval> {
      const a = repo.get(id);
      if (a.status !== "pending") return a;
      const untilExpiry = Math.max(0, Date.parse(a.expiresAt) - Date.now()) + 50;
      await waitSignal(`approval:${id}`, Math.min(timeoutMs, untilExpiry), abort);
      return repo.get(id);
    },

    expire(now = new Date()): string[] {
      const rows = db
        .prepare("UPDATE approvals SET status = 'expired' WHERE status = 'pending' AND expires_at <= ? RETURNING id")
        .all(nowIso(now)) as { id: string }[];
      for (const r of rows) signal(`approval:${r.id}`);
      return rows.map((r) => r.id);
    },
  };
  return repo;
}
