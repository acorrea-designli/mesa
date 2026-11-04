// Lead focus: the ticket the lead session says it is acting on ("mesa lead focus <ref>"). The lead has no
// ticket of its own, so a permission prompt it raises (scripts/hooks/mesa-approval.mjs, MESA_APPROVAL_LEAD=1)
// would land in Hoy, Permisos. While a focus is set the hook files those prompts to that ticket instead.
// Stored in settings; a closed or deleted ticket reads as no focus, so a stale one can never hide a prompt.
import type { Db } from "../db/sqlite";
import { TransitionError } from "../db/util";
import { ticketsRepo } from "./tickets";

const KEY = "lead_focus";

export function leadFocusRepo(db: Db) {
  const tickets = ticketsRepo(db);
  const stored = () => (db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined)?.value ?? null;

  const repo = {
    /** The focused ticket's ref, or null (none set, ticket closed or gone). */
    get(): string | null {
      const ref = stored();
      if (!ref) return null;
      try {
        return tickets.get(ref).status === "closed" ? null : ref;
      } catch {
        return null;
      }
    },

    /** NotFoundError for an unknown ticket; TransitionError for a closed one. Returns the ref. */
    set(ref: string): string {
      const t = tickets.get(ref);
      if (t.status === "closed") throw new TransitionError(`${t.ref} is closed; reopen it or focus another ticket`);
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, t.ref);
      return t.ref;
    },

    clear(): void {
      db.prepare("DELETE FROM settings WHERE key = ?").run(KEY);
    },
  };
  return repo;
}
