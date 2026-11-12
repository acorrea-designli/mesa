// The last time Andrés acted in the Mesa UI (a real click on the board). The sweeper reads it from GET /api/sources
// as information only: its cadence follows new items, not interaction (t122: the lead's and the agents' own writes
// kept the sweeper at 60 s all session). A request from the Mesa CLI (header `x-mesa-client: cli`, set by
// bin/mesa, which only the lead and the agents use) never stamps it, whatever the write: task move, dispatch, claim.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "../db/sqlite";
import { nowIso } from "../db/util";

const KEY = "last_interaction_at";

// On globalThis because each route bundle can hold its own copy of this module while sharing the repos singleton.
const g = globalThis as unknown as { __mesaCliCall?: AsyncLocalStorage<true> };
const cliCall = (g.__mesaCliCall ??= new AsyncLocalStorage<true>());

/** Run `fn` as a call from the Mesa CLI: nothing it does counts as an interaction of Andrés. */
export const asCliCall = <T>(fn: () => T): T => cliCall.run(true, fn);

export function touchInteraction(db: Db, now = new Date()): void {
  if (cliCall.getStore()) return;
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    KEY,
    nowIso(now),
  );
}

export function lastInteractionAt(db: Db): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  return row?.value ?? null;
}
