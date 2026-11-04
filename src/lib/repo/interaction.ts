// The last time Andrés acted in the UI. The sweeper reads it from GET /api/sources and
// snaps its cadence back to 60 s while he is active.
import type { Db } from "../db/sqlite";
import { nowIso } from "../db/util";

const KEY = "last_interaction_at";

export function touchInteraction(db: Db, now = new Date()): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    KEY,
    nowIso(now),
  );
}

export function lastInteractionAt(db: Db): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  return row?.value ?? null;
}
