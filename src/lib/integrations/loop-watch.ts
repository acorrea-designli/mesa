// Stall watchdog (t206). The board once stopped answering for 1-2 minutes while one `gh api` child ran and the process
// looked idle. This logs, one line per stall, what was running when it happened, so the next one names itself:
//  - "event loop blocked": the 500 ms timer fired late, so JavaScript (or a synchronous native call) held the loop;
//  - "libuv pool slow": the loop ran but an fs.stat took long, so the 4 libuv threads (fs, dns) were all busy.
// It lists the gh children alive then (pid, age, first arguments). Timers are unref'd; nothing else is touched.
import fs from "node:fs/promises";
import { activeGhChildren } from "./gh";

export const WATCH_EVERY_MS = 500;
export const STALL_LOG_MS = 2_000;

const g = globalThis as unknown as { __mesaLoopWatch?: NodeJS.Timeout };

const describeChildren = (now: number) =>
  activeGhChildren()
    .map((c) => `pid ${c.pid ?? "?"} ${Math.round((now - c.startedAt) / 1000)}s "${c.args}"`)
    .join("; ") || "none";

/** One-line description of a stall, or null when below the threshold. Pure, for the tests. */
export function stallLine(kind: "loop" | "pool", ms: number, now = Date.now()): string | null {
  if (ms < STALL_LOG_MS) return null;
  const what = kind === "loop" ? "event loop blocked" : "libuv pool slow (fs.stat)";
  return `[mesa] ${what} for ${(ms / 1000).toFixed(1)}s; gh children: ${describeChildren(now)}`;
}

export function startLoopWatch(log: (line: string) => void = (l) => console.warn(l)): void {
  if (g.__mesaLoopWatch) return;
  let last = Date.now();
  let probing = false;
  g.__mesaLoopWatch = setInterval(() => {
    const now = Date.now();
    const line = stallLine("loop", now - last - WATCH_EVERY_MS, now);
    last = now;
    if (line) log(line);
    if (probing) return;
    probing = true;
    const t0 = Date.now();
    void fs
      .stat(".")
      .catch(() => undefined)
      .then(() => {
        probing = false;
        const l = stallLine("pool", Date.now() - t0);
        if (l) log(l);
      });
  }, WATCH_EVERY_MS);
  g.__mesaLoopWatch.unref();
}
