import { describe, expect, it } from "vitest";
import { ageLabel, remainingPercent, resetLabel, usageView, type UsageSnapshot } from "./usage";

const NOW = new Date("2026-11-09T20:00:00Z"); // 15:00 Bogota, Monday
const sec = (iso: string) => Date.parse(iso) / 1000;

const snap = (over: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  capturedAt: "2026-11-09T19:56:00Z",
  sessionId: "s1",
  model: { id: "claude-opus-5-5", displayName: "Opus 5.5" },
  fiveHour: { usedPercentage: 32, resetsAt: sec("2026-11-09T23:30:00Z") },
  sevenDay: { usedPercentage: 11.4, resetsAt: sec("2026-11-14T23:30:00Z") },
  ...over,
});

describe("remainingPercent", () => {
  it("is 100 minus used, whole and clamped", () => {
    expect(remainingPercent(32)).toBe(68);
    expect(remainingPercent(11.4)).toBe(89);
    expect(remainingPercent(0)).toBe(100);
    expect(remainingPercent(100)).toBe(0);
    expect(remainingPercent(130)).toBe(0);
    expect(remainingPercent(-5)).toBe(100);
  });
});

describe("ageLabel", () => {
  it("counts minutes, then hours, then days", () => {
    expect(ageLabel("2026-11-09T19:56:00Z", NOW)).toBe("hace 4 min");
    expect(ageLabel("2026-11-09T19:59:50Z", NOW)).toBe("hace 1 min");
    expect(ageLabel("2026-11-09T20:00:30Z", NOW)).toBe("hace 1 min");
    expect(ageLabel("2026-11-09T17:30:00Z", NOW)).toBe("hace 2 h");
    expect(ageLabel("2026-11-06T20:00:00Z", NOW)).toBe("hace 3 d");
  });
});

describe("resetLabel", () => {
  it("is the Bogota clock time when it resets today", () => {
    expect(resetLabel(sec("2026-11-09T23:30:00Z"), NOW)).toBe("18:30");
  });
  it("adds the day when it resets on another Bogota day", () => {
    expect(resetLabel(sec("2026-11-14T23:30:00Z"), NOW)).toMatch(/^sáb 14 · 18:30$/);
  });
});

describe("usageView", () => {
  it("shows % remaining, reset times and age for a fresh snapshot", () => {
    const v = usageView(snap(), NOW);
    expect(v.state).toBe("fresh");
    expect(v.age).toBe("hace 4 min");
    expect(v.model).toBe("Opus 5.5");
    expect(v.windows.map((w) => [w.label, w.remaining, w.resets])).toEqual([
      ["5 h", 68, "18:30"],
      ["semana", 89, expect.stringContaining("18:30")],
    ]);
  });

  it("is stale after 15 minutes, not before", () => {
    expect(usageView(snap({ capturedAt: "2026-11-09T19:45:00Z" }), NOW).state).toBe("fresh");
    expect(usageView(snap({ capturedAt: "2026-11-09T19:44:59Z" }), NOW).state).toBe("stale");
  });

  it("has no data without a snapshot, and no error", () => {
    const v = usageView(null, NOW);
    expect(v.state).toBe("none");
    expect(v.windows.every((w) => w.remaining === null)).toBe(true);
  });

  it("drops a window that is absent or already reset", () => {
    const v = usageView(snap({ sevenDay: null, fiveHour: { usedPercentage: 90, resetsAt: sec("2026-11-09T19:00:00Z") } }), NOW);
    expect(v.windows.map((w) => w.remaining)).toEqual([null, null]);
    expect(v.windows[0]?.resets).toBe("");
  });

  it("falls back to the model id when it has no display name", () => {
    expect(usageView(snap({ model: { id: "claude-x", displayName: "" } }), NOW).model).toBe("claude-x");
  });
});
