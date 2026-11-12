// The Fuentes rail is server-rendered from source_state, and some of what it says changes with the clock
// alone: a row turns "sin revisar" when its last check gets old, a pause ends, the sweeper's 90 s grace
// runs out. No write happens then, so nothing would tell an open screen. This ticker recomputes the rail
// rows every ~30 s and publishes one { source, health } change when they differ from the last pass; the
// screens already refresh on it (useLive). It publishes on the live bus only: no wake event, so it is
// safe on the sandbox board too. Started from src/instrumentation.ts; never in tests.
import { publishChange } from "../live/bus";
import { repos, type Repos } from "../repo";
import { getSourceHealth } from "./health";

export const HEALTH_TICK_MS = 30_000;

export class HealthWatcher {
  private last: string | null = null;

  constructor(private r: Repos) {}

  /** Recompute the rail rows; publish when they changed since the previous pass (the first pass only records). */
  check(now = new Date()): boolean {
    const key = JSON.stringify(getSourceHealth(this.r, now));
    const changed = this.last !== null && key !== this.last;
    this.last = key;
    if (changed) publishChange({ entityType: "source", entityId: "", kind: "health" });
    return changed;
  }
}

const g = globalThis as unknown as { __mesaHealthTicker?: NodeJS.Timeout };

/** Start the ticker (idempotent across hot reloads). A test run never starts it. */
export function startHealthTicker(): void {
  if (g.__mesaHealthTicker || process.env.VITEST) return;
  const watcher = new HealthWatcher(repos());
  watcher.check();
  g.__mesaHealthTicker = setInterval(() => {
    try {
      watcher.check();
    } catch (err) {
      console.error("[mesa] health tick failed", err);
    }
  }, HEALTH_TICK_MS);
  g.__mesaHealthTicker.unref();
}
