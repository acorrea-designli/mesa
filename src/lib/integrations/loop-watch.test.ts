import { afterEach, describe, expect, it, vi } from "vitest";
import { startLoopWatch, STALL_LOG_MS, stallLine } from "./loop-watch";

const statGate = vi.hoisted(() => ({ release: undefined as undefined | (() => void), hang: false }));
vi.mock("node:fs/promises", () => ({
  default: {
    stat: () => (statGate.hang ? new Promise((r) => (statGate.release = () => r({}))) : Promise.resolve({})),
  },
}));

describe("stallLine", () => {
  it("stays quiet below the threshold", () => {
    expect(stallLine("loop", STALL_LOG_MS - 1)).toBeNull();
  });
  it("names the kind of stall and the gh children", () => {
    expect(stallLine("loop", 4_200)).toBe("[mesa] event loop blocked for 4.2s; gh children: none");
    expect(stallLine("pool", 3_000)).toContain("libuv pool slow");
  });
});

describe("startLoopWatch", () => {
  afterEach(() => {
    clearInterval((globalThis as { __mesaLoopWatch?: NodeJS.Timeout }).__mesaLoopWatch);
    delete (globalThis as { __mesaLoopWatch?: NodeJS.Timeout }).__mesaLoopWatch;
    statGate.hang = false;
    vi.useRealTimers();
  });

  it("logs a pending pool probe while it is still stuck, once, then its recovery", async () => {
    vi.useFakeTimers();
    statGate.hang = true;
    const lines: string[] = [];
    startLoopWatch((l) => lines.push(l));
    await vi.advanceTimersByTimeAsync(STALL_LOG_MS + 2_000);
    const stuck = lines.filter((l) => l.includes("libuv pool slow"));
    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toContain("still waiting");
    statGate.release?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(lines.some((l) => l.includes("libuv pool recovered"))).toBe(true);
  });

  it("stays quiet when the probe answers at once", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    startLoopWatch((l) => lines.push(l));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lines).toEqual([]);
  });
});
