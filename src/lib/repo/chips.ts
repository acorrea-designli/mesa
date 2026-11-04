import type { Db } from "../db/sqlite";
import { fromRows, nowIso } from "../db/util";
import type { LearnedChip } from "../domain/types";

export const MAX_CHIPS = 4;
const MAX_PHRASINGS = 5;

export function chipsRepo(db: Db) {
  return {
    /** Top chips by how often Andrés asked, then recency. Cold start: []. */
    top(limit = MAX_CHIPS): LearnedChip[] {
      return fromRows<LearnedChip>(
        db.prepare("SELECT * FROM learned_chips ORDER BY uses DESC, last_used_at DESC LIMIT ?").all(limit),
        { json: ["phrasings"] },
      );
    },

    /**
     * Count one use of a label. `phrase` is Andrés's original wording (kept for the
     * "agrupa: …" hover); null when he clicked the chip itself.
     */
    learn(label: string, phrase: string | null, now = new Date()): void {
      const clean = label.trim();
      if (!clean) return;
      const row = db.prepare("SELECT phrasings FROM learned_chips WHERE label = ?").get(clean) as
        | { phrasings: string }
        | undefined;
      const list: string[] = row ? JSON.parse(row.phrasings) : [];
      if (phrase && phrase.trim() && phrase.trim().toLowerCase() !== clean.toLowerCase()) {
        const p = phrase.trim();
        const next = [p, ...list.filter((x) => x !== p)].slice(0, MAX_PHRASINGS);
        list.splice(0, list.length, ...next);
      }
      db.prepare(
        `INSERT INTO learned_chips (label, phrasings, uses, last_used_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(label) DO UPDATE SET phrasings = excluded.phrasings, uses = uses + 1, last_used_at = excluded.last_used_at`,
      ).run(clean, JSON.stringify(list), nowIso(now));
    },
  };
}
