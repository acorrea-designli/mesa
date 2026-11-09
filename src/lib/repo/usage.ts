// Claude usage storage (t45), in the settings table: the latest statusLine snapshot (`usage.snapshot`) and the
// transcript scan state (`usage.tokens`: byte offsets per file and the per-day token buckets), and the plan % over
// time (`usage.history`, t60: one point per 5 min, 8 days) that the /uso charts draw. Nothing here
// reads a credential; the snapshot is the `rate_limits` Claude Code passes to the statusLine command.
import type { Db } from "../db/sqlite";
import { appendPoint, type UsagePoint, type UsageSnapshot } from "../domain/usage";
import type { TokenState } from "../integrations/transcripts";

const SNAPSHOT = "usage.snapshot";
const TOKENS = "usage.tokens";
const HISTORY = "usage.history";

const isPoint = (p: unknown): p is UsagePoint => {
  const o = p as UsagePoint | null;
  const n = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
  return !!o && typeof o.t === "number" && Number.isFinite(o.t) && n(o.fiveHourUsed) && n(o.sevenDayUsed);
};

const read = (db: Db, key: string): unknown => {
  const v = (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};
const write = (db: Db, key: string, value: unknown) =>
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));

export function usageRepo(db: Db) {
  return {
    /** The latest snapshot, or null when none was ever captured. */
    snapshot: (): UsageSnapshot | null => {
      const s = read(db, SNAPSHOT) as UsageSnapshot | null;
      return s && typeof s.capturedAt === "string" ? s : null;
    },
    /**
     * Saves a snapshot. Several sessions report the same account-wide figures, so the newest capture wins: an
     * older one (a session that was slow to post) never replaces a newer one. Returns whether it was saved.
     */
    saveSnapshot(s: UsageSnapshot): boolean {
      const cur = this.snapshot();
      if (cur && Date.parse(cur.capturedAt) > Date.parse(s.capturedAt)) return false;
      write(db, SNAPSHOT, s);
      return true;
    },
    /** The plan % history, oldest first (empty when none was ever recorded). */
    history: (): UsagePoint[] => {
      const h = read(db, HISTORY);
      return Array.isArray(h) ? h.filter(isPoint) : [];
    },
    /** Appends a point (at most one per 5 min, pruned to 8 days; see appendPoint). Returns whether it was stored. */
    appendHistory(p: UsagePoint): boolean {
      const cur = this.history();
      const next = appendPoint(cur, p);
      if (next === cur) return false;
      write(db, HISTORY, next);
      return true;
    },
    tokenState: (): TokenState | null => {
      const s = read(db, TOKENS) as TokenState | null;
      return s && typeof s.files === "object" && typeof s.days === "object" ? s : null;
    },
    saveTokenState: (s: TokenState) => write(db, TOKENS, s),
  };
}
