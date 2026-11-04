import { repos } from "../repo";
import { pruneWakeEvents } from "./wake";

const g = globalThis as unknown as { __mesaSweeper?: NodeJS.Timeout };

export const SWEEP_INTERVAL_MS = 1000;
const PRUNE_EVERY_MS = 60 * 60_000;

/** Apply due salida transitions on an interval, and prune old wake events hourly. Idempotent across hot reloads. */
export function startSweeper(): void {
  if (g.__mesaSweeper) return;
  let nextPrune = 0;
  g.__mesaSweeper = setInterval(() => {
    try {
      const r = repos();
      r.sweep();
      if (Date.now() >= nextPrune) {
        nextPrune = Date.now() + PRUNE_EVERY_MS;
        pruneWakeEvents(r.db);
      }
    } catch (err) {
      console.error("[mesa] sweep failed", err);
    }
  }, SWEEP_INTERVAL_MS);
  g.__mesaSweeper.unref();
}
