import { describe, expect, it } from "vitest";
import { addUsage, classifyRole, compactTokens, exactTokens, freshOf, modelFamily, parseUsageLine, pruneDays, summarize, weekDays, type Buckets, type UsageRecord } from "./tokens";

const line = (over: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-11-09T14:44:46.813Z",
    message: {
      id: "msg_1",
      model: "claude-opus-5-5",
      usage: { input_tokens: 2, cache_creation_input_tokens: 986, cache_read_input_tokens: 9517, output_tokens: 245, ...usage },
    },
    ...over,
  });

const rec = (at: string, model: string, input: number, output = 0, cacheRead = 0): UsageRecord => ({ at, id: "m", model, use: { input, cacheWrite: 0, cacheRead, output } });

describe("classifyRole", () => {
  it("is lead for the session's own transcript", () => {
    expect(classifyRole({ main: true })).toBe("lead");
  });
  it("uses the agentType of a Mesa subagent", () => {
    for (const r of ["sweeper", "tl", "dev", "reviewer", "writer"]) expect(classifyRole({ main: false, agentType: r })).toBe(r);
  });
  it("falls back to the description's name for a general-purpose agent", () => {
    expect(classifyRole({ main: false, agentType: "general-purpose", description: "Mesa sweeper-6 new probe" })).toBe("sweeper");
    expect(classifyRole({ main: false, agentType: "general-purpose", description: "dev-t22 small fixes" })).toBe("dev");
  });
  it("is other for researchers and anything unknown", () => {
    expect(classifyRole({ main: false, agentType: "researcher", description: "researcher-t31 Windows banner" })).toBe("other");
    expect(classifyRole({ main: false })).toBe("other");
    expect(classifyRole({ main: false, agentType: "general-purpose", description: "developer notes" })).toBe("other");
  });
});

describe("parseUsageLine", () => {
  it("reads the four token counts, the model and the time", () => {
    expect(parseUsageLine(line())).toEqual({
      at: "2026-11-09T14:44:46.813Z",
      id: "msg_1",
      model: "claude-opus-5-5",
      use: { input: 2, cacheWrite: 986, cacheRead: 9517, output: 245 },
    });
  });
  it("ignores lines that are not an assistant message with usage", () => {
    expect(parseUsageLine(line({ type: "user" }))).toBeNull();
    expect(parseUsageLine('{"type":"system"}')).toBeNull();
    expect(parseUsageLine("not json but has \"usage\"")).toBeNull();
    expect(parseUsageLine(line({ timestamp: "nope" }))).toBeNull();
    expect(parseUsageLine(line({}, { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }))).toBeNull();
  });
  it("skips synthetic messages", () => {
    expect(parseUsageLine(line({ message: { id: "x", model: "<synthetic>", usage: { input_tokens: 5 } } }))).toBeNull();
  });
  it("treats missing or odd counts as zero", () => {
    const r = parseUsageLine(line({}, { input_tokens: "7", cache_creation_input_tokens: -3, cache_read_input_tokens: undefined }));
    expect(r?.use).toEqual({ input: 0, cacheWrite: 0, cacheRead: 0, output: 245 });
  });
});

describe("buckets and summarize", () => {
  // Monday 9 Nov 2026, 15:00 Bogota.
  const NOW = new Date("2026-11-09T20:00:00Z");

  it("splits today from the rest of the week by Bogota day, by role and by model", () => {
    const b: Buckets = {};
    addUsage(b, "lead", rec("2026-11-09T14:00:00Z", "claude-opus-5-5", 10, 100, 1000));
    addUsage(b, "dev", rec("2026-11-09T15:00:00Z", "claude-haiku-5-5", 5, 50));
    addUsage(b, "dev", rec("2026-11-09T16:00:00Z", "claude-haiku-5-5", 5, 50));
    // 03:00Z on the 9th is still the 8th (Sunday) in Bogota: last week.
    addUsage(b, "lead", rec("2026-11-09T03:00:00Z", "claude-opus-5-5", 999));
    const s = summarize(b, NOW);
    expect(s.day).toBe("2026-11-09");
    expect(s.weekStart).toBe("2026-11-09");
    expect(s.today.total).toBe(10 + 100 + 1000 + 10 + 100);
    expect(s.today.byRole.map((r) => [r.key, r.total])).toEqual([
      ["lead", 1110],
      ["dev", 110],
    ]);
    expect(s.today.byModel.map((r) => [r.label, r.total])).toEqual([
      ["Opus", 1110],
      ["Haiku", 110],
    ]);
    expect(s.today.byModel.map((r) => r.key)).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
    expect(s.week.total).toBe(s.today.total);
  });

  it("a week spans Monday to today and today is inside it", () => {
    const b: Buckets = {};
    addUsage(b, "lead", rec("2026-11-04T15:00:00Z", "claude-opus-5-5", 100)); // Wed of last week
    addUsage(b, "tl", rec("2026-11-10T15:00:00Z", "claude-opus-5-5", 40)); // Tue
    addUsage(b, "tl", rec("2026-11-12T15:00:00Z", "claude-opus-5-5", 7)); // Thu
    addUsage(b, "writer", rec("2026-11-13T15:00:00Z", "claude-opus-5-5", 3)); // Fri, not yet
    const s = summarize(b, new Date("2026-11-12T20:00:00Z"));
    expect(s.weekStart).toBe("2026-11-09");
    expect(s.today.total).toBe(7);
    expect(s.week.total).toBe(47);
    expect(s.week.byRole.map((r) => r.key)).toEqual(["tl"]);
  });

  it("ranks roles by tokens nuevos, biggest first, and keeps the role order on a tie", () => {
    const b: Buckets = {};
    for (const r of ["other", "writer", "reviewer", "dev", "tl", "sweeper", "lead"] as const) addUsage(b, r, rec("2026-11-09T15:00:00Z", "claude-opus-5-5", 1));
    expect(summarize(b, NOW).today.byRole.map((r) => r.key)).toEqual(["lead", "sweeper", "tl", "dev", "reviewer", "writer", "other"]);
    addUsage(b, "writer", rec("2026-11-09T15:00:00Z", "claude-opus-5-5", 5));
    addUsage(b, "dev", rec("2026-11-09T15:00:00Z", "claude-opus-5-5", 2));
    expect(summarize(b, NOW).today.byRole.map((r) => r.key).slice(0, 3)).toEqual(["writer", "dev", "lead"]);
  });

  it("ranks by tokens nuevos, not by cache reads", () => {
    const b: Buckets = {};
    addUsage(b, "lead", rec("2026-11-09T15:00:00Z", "claude-opus-5-5", 10, 0, 900_000)); // huge cache reads, few new
    addUsage(b, "dev", rec("2026-11-09T15:00:00Z", "claude-opus-5-5", 500, 100, 10));
    const s = summarize(b, NOW).today;
    expect(s.byRole.map((r) => r.key)).toEqual(["dev", "lead"]);
    expect(s.fresh).toBe(610);
    expect(s.byRole[0]?.fresh).toBe(600);
    expect(s.total).toBe(610 + 900_010);
  });

  it("names models by family and keeps the version only when a family repeats", () => {
    expect(modelFamily("claude-opus-5-5")).toBe("Opus");
    expect(modelFamily("claude-3-5-sonnet-20241022")).toBe("Sonnet");
    expect(modelFamily("claude-haiku-5-5")).toBe("Haiku");
    expect(modelFamily("gpt-x")).toBe("gpt-x");
    const b: Buckets = {};
    addUsage(b, "lead", rec("2026-11-09T15:00:00Z", "claude-opus-5-5", 10));
    addUsage(b, "lead", rec("2026-11-09T15:00:00Z", "claude-opus-4-1-20250805", 5));
    addUsage(b, "lead", rec("2026-11-09T15:00:00Z", "claude-haiku-5-5", 1));
    expect(summarize(b, NOW).today.byModel.map((r) => r.label)).toEqual(["Opus 5.5", "Opus 4.1", "Haiku"]);
  });

  it("freshOf is input + cache write + output", () => {
    expect(freshOf({ input: 1, cacheWrite: 2, cacheRead: 400, output: 8 })).toBe(11);
  });

  it("is empty with no data", () => {
    const s = summarize({}, NOW);
    expect(s.today.total).toBe(0);
    expect(s.today.byRole).toEqual([]);
    expect(s.week.byModel).toEqual([]);
  });

  it("pruneDays drops days before the cut", () => {
    const b: Buckets = {};
    addUsage(b, "lead", rec("2026-10-01T15:00:00Z", "claude-opus-5-5", 1));
    addUsage(b, "lead", rec("2026-11-09T15:00:00Z", "claude-opus-5-5", 1));
    pruneDays(b, "2026-11-01");
    expect(Object.keys(b)).toEqual(["2026-11-09"]);
  });
});

describe("weekDays", () => {
  // Thursday 12 Nov 2026, 15:00 Bogota.
  const NOW = new Date("2026-11-12T20:00:00Z");

  it("is Monday to Sunday of this week with tokens nuevos per Bogota day", () => {
    const b: Buckets = {};
    addUsage(b, "lead", { at: "2026-11-09T15:00:00Z", id: "a", model: "claude-opus-5-5", use: { input: 10, cacheWrite: 5, cacheRead: 999, output: 20 } });
    addUsage(b, "dev", rec("2026-11-09T16:00:00Z", "claude-opus-5-5", 1)); // same day, another role
    addUsage(b, "lead", rec("2026-11-10T04:00:00Z", "claude-opus-5-5", 7)); // 23:00 Bogota on Monday
    addUsage(b, "lead", rec("2026-11-12T15:00:00Z", "claude-opus-5-5", 40));
    addUsage(b, "lead", rec("2026-11-08T15:00:00Z", "claude-opus-5-5", 500)); // last Sunday: not this week
    const days = weekDays(b, NOW);
    expect(days.map((d) => d.label)).toEqual(["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]);
    expect(days.map((d) => d.day)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(days.map((d) => d.fresh)).toEqual([10 + 5 + 20 + 1 + 7, 0, 0, 40, 0, 0, 0]);
    expect(days.map((d) => d.today)).toEqual([false, false, false, true, false, false, false]);
    expect(days.map((d) => d.future)).toEqual([false, false, false, false, true, true, true]);
    expect(summarize(b, NOW).days).toEqual(days);
  });

  it("is seven empty days with no data", () => {
    expect(weekDays({}, NOW).every((d) => d.fresh === 0)).toBe(true);
  });

  it("on a Sunday the week ends today", () => {
    const days = weekDays({}, new Date("2026-11-15T20:00:00Z"));
    expect(days[0]?.day).toBe("2026-11-09");
    expect(days[6]).toMatchObject({ day: "2026-11-15", today: true, future: false });
  });
});

describe("compactTokens", () => {
  it("abbreviates with a decimal comma", () => {
    expect(compactTokens(950)).toBe("950");
    expect(compactTokens(1234)).toBe("1,2 k");
    expect(compactTokens(42_000)).toBe("42 k");
    expect(compactTokens(4_250_000)).toBe("4,3 M");
    expect(compactTokens(999_000_000)).toBe("999 M");
  });

  it("never prints G: billions read as thousands of millions", () => {
    expect(compactTokens(1_268_300_000)).toBe("1.268 M");
    expect(compactTokens(1_310_000_000)).toBe("1.310 M");
    expect(compactTokens(12_000_000_000)).toBe("12.000 M");
    expect(compactTokens(1_000_000)).toBe("1 M");
    for (const n of [999_999_999, 1_000_000_000, 5_432_100_000, 123_456_789_012]) expect(compactTokens(n)).not.toMatch(/G/);
  });

  it("exactTokens groups thousands with a dot", () => {
    expect(exactTokens(950)).toBe("950");
    expect(exactTokens(8_312_450)).toBe("8.312.450");
    expect(exactTokens(1_310_000_000)).toBe("1.310.000.000");
  });
});
