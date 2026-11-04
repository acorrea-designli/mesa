import { repos } from "../repo";

const g = globalThis as unknown as { __mesaSweeper?: NodeJS.Timeout };

export const SWEEP_INTERVAL_MS = 1000;

/** Apply due salida transitions on an interval. Idempotent across hot reloads. */
export function startSweeper(): void {
  if (g.__mesaSweeper) return;
  g.__mesaSweeper = setInterval(() => {
    try {
      repos().sweep();
    } catch (err) {
      console.error("[mesa] sweep failed", err);
    }
  }, SWEEP_INTERVAL_MS);
  g.__mesaSweeper.unref();
}
