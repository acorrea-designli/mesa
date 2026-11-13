// Permission approvals: a blocked tool call waits here until Andrés decides.
// Allow comes only from an explicit "allow" decision before expires_at. Every other
// outcome (deny, read_config, expiry) is a deny for the agent.
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { fromRow, fromRows, newId, NotFoundError, nowIso, TransitionError, ValidationError } from "../db/util";
import { GRANT_TTL_MS, grantHash, grantable } from "../domain/approval-grant";
import { MAX_SHOWN_CHARS, onceEligible, onceUnavailableWhy, shownCall } from "../domain/approval-once";
import { deniedRule, EDIT_TOOLS } from "../domain/denied-rule";
import type { Approval, ApprovalDecision, ApprovalKind } from "../domain/types";
import { worktreesRoot } from "../integrations/settings-rules";
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
  /** "denied" (t128): the PermissionDenied hook's card. It needs toolInput; the rule is derived here from it, never sent. */
  kind?: ApprovalKind;
  reason?: string;
  toolInput?: unknown;
  /** The denied session (kind denied), kept so the grant a later allow creates is bound to it. */
  sessionId?: string;
}

const SELECT = "SELECT a.*, t.ref AS ticket_ref FROM approvals a LEFT JOIN tickets t ON t.id = a.ticket_id";

const parse = (s: string): unknown => {
  try {
    return s ? (JSON.parse(s) as unknown) : null;
  } catch {
    return null;
  }
};

/**
 * Why "Permitir esta vez" cannot allow this card, or null when it can. The call Andres reads must be the call the grant
 * is hashed from: the stored summary and detail must be exactly what the server builds from the stored tool_input, and
 * short enough to be read whole.
 */
function onceRefusal(a: Pick<Approval, "kind" | "tool" | "rule" | "deniedInput" | "summary" | "detail">): string | null {
  if (a.kind !== "denied") return "solo una llamada bloqueada por el modo automático se puede permitir una vez";
  if (!onceEligible(a.tool)) return onceUnavailableWhy(a.tool);
  if (a.rule) return "esta tarjeta ya propone una regla; se permite con la regla, no una vez";
  const stored = parse(a.deniedInput);
  const g = grantable(a.tool, stored);
  if (!g.ok) return g.why;
  const shown = shownCall(a.tool, stored);
  if (shown.detail.length > MAX_SHOWN_CHARS) return "la llamada es demasiado larga para mostrarla completa en la tarjeta";
  if (a.summary !== shown.summary || a.detail !== shown.detail) return "la tarjeta no muestra exactamente la llamada que se permitiría";
  return null;
}
const withOnce = (a: Approval): Approval => {
  const why = onceRefusal(a);
  // `onceWhy` is the one line a denied card shows when it cannot be allowed once; a permission card has none.
  return { ...a, once: why === null, onceWhy: a.kind === "denied" && why !== null ? why : "" };
};

export function approvalsRepo(db: Db) {
  const tickets = ticketsRepo(db);

  const raw = (id: string): Approval => {
    const row = db.prepare(`${SELECT} WHERE a.id = ?`).get(id);
    if (!row) throw new NotFoundError("approval", id);
    return withOnce(fromRow<Approval>(row, SPEC));
  };

  const repo = {
    create(i: ApprovalInput, now = new Date()): Approval {
      const kind = i.kind ?? "permission";
      if (kind === "denied" && (!i.toolInput || typeof i.toolInput !== "object" || Array.isArray(i.toolInput))) throw new ValidationError("a denied card needs the denied call's toolInput");
      const derived = kind === "denied" ? deniedRule(i.tool, i.toolInput, worktreesRoot()) : null;
      // A card "Permitir esta vez" can allow shows the call built here from the stored input: whatever summary, detail
      // or cwd the client sent is ignored, so what Andres reads is what the grant is hashed from.
      const shown = kind === "denied" && onceEligible(i.tool) ? shownCall(i.tool, i.toolInput) : null;
      const id = newId("ap");
      const ticketId = i.ticketRef ? tickets.get(i.ticketRef).id : null;
      const requested = i.expiresAt ? Date.parse(i.expiresAt) : now.getTime() + DEFAULT_APPROVAL_TTL_MS;
      const expires = Math.min(requested, now.getTime() + MAX_APPROVAL_TTL_MS);
      if (Number.isNaN(expires) || expires <= now.getTime()) throw new TransitionError("expiresAt must be in the future");
      db.prepare(
        `INSERT INTO approvals (id, ticket_id, agent, tool, summary, detail, cwd, hints, status, expires_at, created_at, kind, reason, denied_input, rule, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        ticketId,
        i.agent,
        i.tool,
        shown ? shown.summary : i.summary,
        shown ? shown.detail : (i.detail ?? ""),
        shown ? "" : (i.cwd ?? ""),
        JSON.stringify(i.hints ?? []),
        new Date(expires).toISOString(),
        nowIso(now),
        kind,
        i.reason ?? "",
        kind === "denied" ? JSON.stringify(i.toolInput) : "",
        derived?.ok ? derived.rule : "",
        kind === "denied" ? (i.sessionId ?? "") : "",
      );
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
      ).map(withOnce);
    },

    /** Refused after expires_at or once decided: a late "allow" can never reach an agent that was told no. */
    decide(
      id: string,
      d: { decision: ApprovalDecision; actor: string; note?: string },
      now = new Date(),
      opts: { seed?: boolean; /** Writes the rule of a denied card (t128); only the server's route passes it. */ writeRule?: (rule: string) => void } = {},
    ): Approval {
      repo.expire(now);
      const a = raw(id);
      if (a.status === "expired") throw new TransitionError("this approval expired; the agent was already denied");
      if (a.status === "decided") throw new TransitionError(`already decided: ${a.decision}`);
      let rule = "";
      let grant: { hash: string } | null = null;
      if (a.kind === "denied") {
        if (d.decision === "read_config") throw new TransitionError("a denied card can only be allowed (once, or by its rule) or denied");
        if (d.decision === "allow") {
          const stored = a.deniedInput ? (JSON.parse(a.deniedInput) as unknown) : null;
          if (EDIT_TOOLS.has(a.tool)) {
            // A file edit is allowed by a rule in settings.local.json, derived again here from the stored call:
            // nothing a client sends can change it.
            const r = deniedRule(a.tool, stored, worktreesRoot());
            if (!r.ok) throw new TransitionError(`no se puede proponer una regla para esta llamada: ${r.why}`);
            // What Andrés saw on the card is what gets written: a card with no rule, or one whose stored rule is not what
            // the call derives now (a changed worktrees folder, a row edited outside the API), is never allowed.
            if (!a.rule) throw new TransitionError("esta tarjeta no tenía una regla propuesta; solo se puede denegar");
            if (r.rule !== a.rule) throw new TransitionError("la regla de la tarjeta ya no coincide con la que se deriva de la llamada; no se escribió nada");
            if (!opts.writeRule) throw new TransitionError("no settings writer for a denied card");
            rule = r.rule;
          } else {
            // Any other call (a command, an MCP tool): "Permitir esta vez" stores a one-shot grant for exactly this call,
            // hashed here from the stored input. Only his UI decision creates one.
            if (d.actor !== "andres") throw new TransitionError("solo Andrés, desde la tarjeta, puede permitir esta llamada");
            if (!onceEligible(a.tool)) throw new TransitionError(`no se puede permitir esta llamada: ${onceUnavailableWhy(a.tool)}`);
            const refusal = onceRefusal(a);
            if (refusal) throw new TransitionError(`no se puede permitir esta llamada: ${refusal}`);
            grant = { hash: grantHash(a.tool, stored) };
          }
        }
      }
      tx(db, () => {
        if (rule) opts.writeRule!(rule);
        db.prepare(
          "UPDATE approvals SET status = 'decided', decision = ?, note = ?, decided_by = ?, decided_at = ?, rule = CASE WHEN ? <> '' THEN ? ELSE rule END WHERE id = ? AND status = 'pending'",
        ).run(d.decision, d.note ?? "", d.actor, nowIso(now), rule, rule, id);
        if (grant) {
          db.prepare(
            "INSERT INTO approval_grants (id, approval_id, tool, input_hash, caller, session_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          ).run(newId("gr"), id, a.tool, grant.hash, a.agent, a.sessionId, nowIso(now), new Date(now.getTime() + GRANT_TTL_MS).toISOString());
        }
        if (d.actor === "andres") touchInteraction(db, now);
        // His press takes his turn on the ticket (the seed builds sample states and is not a press).
        if (d.actor === "andres" && !opts.seed) tickets.andresActed(a.ticketId, now);
      });
      signal(`approval:${id}`);
      return raw(id);
    },

    /**
     * The PreToolUse hook's question: is there an unused, unexpired grant for exactly this call by this caller in this
     * session? The hash is derived here from the call it sends, never taken from the client. One UPDATE ... RETURNING
     * marks the grant used, so two concurrent retries cannot both match it.
     */
    consumeGrant(c: { tool: string; toolInput: unknown; caller: string; sessionId?: string }, now = new Date()): { granted: boolean; approvalId?: string } {
      if (!grantable(c.tool, c.toolInput).ok) return { granted: false };
      const row = db
        .prepare(
          `UPDATE approval_grants SET used_at = ?
           WHERE id = (SELECT id FROM approval_grants WHERE tool = ? AND input_hash = ? AND caller = ? AND session_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at LIMIT 1)
             AND used_at IS NULL
           RETURNING approval_id`,
        )
        .get(nowIso(now), c.tool, grantHash(c.tool, c.toolInput), c.caller, c.sessionId ?? "", nowIso(now)) as { approval_id: string } | undefined;
      return row ? { granted: true, approvalId: row.approval_id } : { granted: false };
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
