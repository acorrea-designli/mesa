import { describe, expect, it } from "vitest";
import {
  appendPoint,
  ageLabel,
  chartSeries,
  durationLabel,
  elapsedLabel,
  FIVE_HOUR_MS,
  HISTORY_GAP_MS,
  HISTORY_KEEP_MS,
  paceShare,
  pointOf,
  remainingPercent,
  resetLabel,
  SEVEN_DAY_MS,
  stampLabel,
  usoDate,
  usageView,
  type UsagePoint,
  type UsageSnapshot,
} from "./usage";

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

describe("pace", () => {
  it("is the share of the window already elapsed, clamped", () => {
    // 5 h window resetting at 23:30Z; at 20:00Z, 3 h 30 min are left, so 1 h 30 min elapsed.
    expect(paceShare(sec("2026-11-09T23:30:00Z"), FIVE_HOUR_MS, NOW)).toBeCloseTo(1.5 / 5, 6);
    expect(paceShare(sec("2026-11-09T20:00:00Z"), FIVE_HOUR_MS, NOW)).toBe(1);
    expect(paceShare(sec("2026-11-10T20:00:00Z"), FIVE_HOUR_MS, NOW)).toBe(0);
    expect(paceShare(sec("2026-11-12T20:00:00Z"), SEVEN_DAY_MS, NOW)).toBeCloseTo(4 / 7, 6);
  });

  it("each window of the view carries used, reset and pace for the meter's tick", () => {
    const v = usageView(snap(), NOW);
    expect(v.at).toBe(Date.parse("2026-11-09T19:56:00Z"));
    expect(v.windows[0]).toMatchObject({ key: "five_hour", used: 32, remaining: 68, resetsAt: sec("2026-11-09T23:30:00Z") });
    expect(v.windows[0]?.pace).toBeCloseTo(0.3, 6);
    expect(v.windows[1]?.pace).toBeCloseTo(44.5 / 168, 6);
  });

  it("has no pace without a figure", () => {
    const v = usageView(null, NOW);
    expect(v.at).toBeNull();
    expect(v.windows.map((w) => [w.used, w.resetsAt, w.pace])).toEqual([
      [null, null, null],
      [null, null, null],
    ]);
  });
});

describe("elapsed time", () => {
  const MIN = 60_000;
  // A 5 h window that resets at 23:30Z started at 18:30Z: `at(m)` is `m` minutes into it.
  const resets = sec("2026-11-09T23:30:00Z");
  const at = (m: number) => new Date(Date.parse("2026-11-09T18:30:00Z") + m * MIN);

  it("reads the time elapsed against the window length", () => {
    expect(elapsedLabel(resets, FIVE_HOUR_MS, at(0))).toBe("0 min de 5 h");
    expect(elapsedLabel(resets, FIVE_HOUR_MS, at(40))).toBe("40 min de 5 h");
    expect(elapsedLabel(resets, FIVE_HOUR_MS, at(65))).toBe("1 h 05 de 5 h");
    expect(elapsedLabel(resets, FIVE_HOUR_MS, at(76))).toBe("1 h 16 de 5 h");
    expect(elapsedLabel(resets, FIVE_HOUR_MS, at(120))).toBe("2 h de 5 h");
    expect(elapsedLabel(resets, FIVE_HOUR_MS, at(300))).toBe("5 h de 5 h");
  });

  it("reads days and hours for the week", () => {
    // 7 d window resetting at 2026-11-16 19:00Z: 2 d 5 h in is 2026-11-12 00:00Z.
    expect(elapsedLabel(sec("2026-11-16T19:00:00Z"), SEVEN_DAY_MS, new Date("2026-11-12T00:00:00Z"))).toBe("2 d 5 h de 7 d");
    expect(elapsedLabel(sec("2026-11-16T19:00:00Z"), SEVEN_DAY_MS, new Date("2026-11-12T19:00:00Z"))).toBe("3 d de 7 d");
  });

  it("clamps to the window and is empty with no window", () => {
    expect(elapsedLabel(resets, FIVE_HOUR_MS, at(-30))).toBe("0 min de 5 h");
    expect(elapsedLabel(resets, FIVE_HOUR_MS, at(400))).toBe("5 h de 5 h");
    expect(elapsedLabel(null, FIVE_HOUR_MS, NOW)).toBe("");
  });

  it("shares its instant with the pace of the view", () => {
    const v = usageView(snap(), NOW);
    // 5 h window resetting 23:30Z at 20:00Z: 1 h 30 elapsed, pace 0.3.
    expect(v.windows[0]?.elapsed).toBe("1 h 30 de 5 h");
    expect(v.windows[1]?.elapsed).toBe("1 d 20 h de 7 d");
    expect(usageView(null, NOW).windows.map((w) => w.elapsed)).toEqual(["", ""]);
  });

  it("durationLabel rounds down to whole minutes", () => {
    expect(durationLabel(59_999)).toBe("0 min");
    expect(durationLabel(61 * MIN + 59_000)).toBe("1 h 01");
    expect(durationLabel(24 * 60 * MIN)).toBe("1 d");
  });
});

describe("history", () => {
  const T0 = Date.parse("2026-11-09T12:00:00Z");
  const pt = (min: number, five: number | null = 10, seven: number | null = 5): UsagePoint => ({ t: T0 + min * 60_000, fiveHourUsed: five, sevenDayUsed: seven });

  it("pointOf takes the capture time and both percentages, null for an absent window", () => {
    expect(pointOf(snap())).toEqual({ t: Date.parse("2026-11-09T19:56:00Z"), fiveHourUsed: 32, sevenDayUsed: 11.4 });
    expect(pointOf(snap({ sevenDay: null }))?.sevenDayUsed).toBeNull();
    expect(pointOf(snap({ fiveHour: null, sevenDay: null }))).toBeNull();
    expect(pointOf(snap({ capturedAt: "nope" }))).toBeNull();
  });

  it("appends in order and starts a series", () => {
    expect(appendPoint([], pt(0))).toEqual([pt(0)]);
    expect(appendPoint([pt(0)], pt(6))).toEqual([pt(0), pt(6)]);
  });

  it("keeps at most one point per 5 minutes", () => {
    const h = [pt(0)];
    expect(appendPoint(h, pt(4))).toBe(h);
    expect(appendPoint(h, pt(HISTORY_GAP_MS / 60_000))).toHaveLength(2);
  });

  it("ignores a point that is not newer than the last", () => {
    const h = [pt(30)];
    expect(appendPoint(h, pt(10))).toBe(h);
    expect(appendPoint(h, pt(30))).toBe(h);
  });

  it("prunes points older than 8 days before the new one", () => {
    const old = pt(0);
    const mid = { ...pt(0), t: T0 + HISTORY_KEEP_MS - 600_000 };
    const fresh = { ...pt(0), t: T0 + HISTORY_KEEP_MS + 60_000 };
    expect(appendPoint([old, mid], fresh)).toEqual([mid, fresh]);
    expect(appendPoint([old, mid], { ...fresh, t: T0 + HISTORY_KEEP_MS })).toEqual([old, mid, { ...fresh, t: T0 + HISTORY_KEEP_MS }]);
  });
});

describe("chartSeries", () => {
  const view = usageView(snap(), NOW); // 5 h resets 23:30Z (window 18:30Z-23:30Z), week resets Sat 14 23:30Z
  const five = view.windows[0]!;
  const week = view.windows[1]!;
  const at = (iso: string, f: number | null, s: number | null): UsagePoint => ({ t: Date.parse(iso), fiveHourUsed: f, sevenDayUsed: s });

  it("keeps the points inside the window and puts them on 0-1 of its length", () => {
    const h = [at("2026-11-09T17:00:00Z", 90, 10), at("2026-11-09T19:00:00Z", 20, 11), at("2026-11-09T19:30:00Z", 25, 11)];
    const s = chartSeries(h, five, view.at)!;
    expect(s.start).toBe(Date.parse("2026-11-09T18:30:00Z"));
    expect(s.end).toBe(Date.parse("2026-11-09T23:30:00Z"));
    // 17:00 is the previous window; 19:00 and 19:30 are in; the snapshot (19:56, 32%) is appended as the last point.
    expect(s.points.map((p) => p.used)).toEqual([20, 25, 32]);
    expect(s.points[0]?.x).toBeCloseTo(0.5 / 5, 6);
    expect(s.points.every((p) => p.x >= 0 && p.x <= 1)).toBe(true);
  });

  it("does not repeat the snapshot when history already has a point at or after it", () => {
    const h = [at("2026-11-09T19:56:00Z", 32, 11.4)];
    expect(chartSeries(h, five, view.at)!.points).toHaveLength(1);
  });

  it("reads the week series from the seven-day figures", () => {
    const h = [at("2026-11-08T12:00:00Z", 1, 3), at("2026-11-09T12:00:00Z", 1, 8), at("2026-11-09T13:00:00Z", 1, null)];
    const s = chartSeries(h, week, view.at)!;
    expect(s.end - s.start).toBe(SEVEN_DAY_MS);
    expect(s.points.map((p) => p.used)).toEqual([3, 8, 11.4]);
  });

  it("is null when the window is unknown or already reset, and empty with no history", () => {
    expect(chartSeries([at("2026-11-09T19:00:00Z", 20, 11)], usageView(null, NOW).windows[0]!, null)).toBeNull();
    expect(chartSeries([], five, null)!.points).toEqual([]);
  });
});

describe("stampLabel", () => {
  it("is the Bogota day and time", () => {
    expect(stampLabel(Date.parse("2026-11-10T19:35:00Z"))).toBe("mar 10 · 14:35");
  });
});

describe("usoDate", () => {
  it("is the day and the Monday-Sunday range in Bogota", () => {
    expect(usoDate(NOW)).toBe("lun 9 nov · semana 9-15 nov");
    expect(usoDate(new Date("2026-11-11T03:00:00Z"))).toBe("mar 10 nov · semana 9-15 nov"); // 22:00 Bogota on Tuesday
  });
  it("names both months when the week crosses one", () => {
    expect(usoDate(new Date("2026-12-02T17:00:00Z"))).toBe("mié 2 dic · semana 30 nov - 6 dic");
  });
});
