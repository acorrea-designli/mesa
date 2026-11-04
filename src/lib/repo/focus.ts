// Lead focus: the ticket the lead session says it is acting on ("mesa lead focus <ref>"). The lead has no
// ticket of its own, so a permission prompt it raises (scripts/hooks/mesa-approval.mjs, MESA_APPROVAL_LEAD=1)
// would land in Hoy, Permisos. While a focus is set the hook files those prompts to that ticket instead.
// Stored in settings as { ref, at }. It expires LEAD_FOCUS_TTL_MS after the last set (running
// "mesa lead focus <ref>" again refreshes it), and a closed or deleted ticket reads as no focus, so a stale
// one can never hide a prompt.
import type { Db } from "../db/sqlite";
import { TransitionError, nowIso } from "../db/util";
import { ticketsRepo } from "./tickets";

const KEY = "lead_focus";
export const LEAD_FOCUS_TTL_MS = 2 * 60 * 60_000;

export interface LeadFocus {
  ticketRef: string;
  title: string;
  since: string;
  expiresAt: string;
}

export function leadFocusRepo(db: Db) {
  const tickets = ticketsRepo(db);
  const stored = (): { ref: string; at: string } | null => {
    const v = (db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined)?.value;
    if (!v) return null;
    try {
      const o = JSON.parse(v) as { ref?: unknown; at?: unknown };
      return typeof o.ref === "string" && typeof o.at === "string" ? { ref: o.ref, at: o.at } : null;
    } catch {
      return null;
    }
  };

  const repo = {
    /** The focus in force: set, not expired, and its ticket still open. */
    current(now = new Date()): LeadFocus | null {
      const s = stored();
      if (!s) return null;
      const expires = Date.parse(s.at) + LEAD_FOCUS_TTL_MS;
      if (Number.isNaN(expires) || expires <= now.getTime()) return null;
      try {
        const t = tickets.get(s.ref);
        return t.status === "closed" ? null : { ticketRef: t.ref, title: t.title, since: s.at, expiresAt: new Date(expires).toISOString() };
      } catch {
        return null;
      }
    },

    /** The focused ticket's ref, or null. */
    get(now = new Date()): string | null {
      return repo.current(now)?.ticketRef ?? null;
    },

    /** Set or refresh. NotFoundError for an unknown ticket; TransitionError for a closed one. Returns the ref. */
    set(ref: string, now = new Date()): string {
      const t = tickets.get(ref);
      if (t.status === "closed") throw new TransitionError(`${t.ref} is closed; reopen it or focus another ticket`);
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
        KEY,
        JSON.stringify({ ref: t.ref, at: nowIso(now) }),
      );
      return t.ref;
    },

    clear(): void {
      db.prepare("DELETE FROM settings WHERE key = ?").run(KEY);
    },
  };
  return repo;
}
