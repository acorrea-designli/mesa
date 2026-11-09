import { describe, expect, it } from "vitest";
import { addUsage, classifyRole, compactTokens, parseUsageLine, pruneDays, summarize, type Buckets, type UsageRecord } from "./tokens";

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
      ["opus-5-5", 1110],
      ["haiku-5-5", 110],
    ]);
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

  it("orders roles in the fixed role order", () => {
    const b: Buckets = {};
    for (const r of ["other", "writer", "reviewer", "dev", "tl", "sweeper", "lead"] as const) addUsage(b, r, rec("2026-11-09T15:00:00Z", "claude-opus-5-5", 1));
    expect(summarize(b, NOW).today.byRole.map((r) => r.key)).toEqual(["lead", "sweeper", "tl", "dev", "reviewer", "writer", "other"]);
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

describe("compactTokens", () => {
  it("abbreviates with a decimal comma", () => {
    expect(compactTokens(950)).toBe("950");
    expect(compactTokens(1234)).toBe("1,2 k");
    expect(compactTokens(42_000)).toBe("42 k");
    expect(compactTokens(4_250_000)).toBe("4,3 M");
    expect(compactTokens(999_000_000)).toBe("999 M");
    expect(compactTokens(1_268_300_000)).toBe("1,3 G");
    expect(compactTokens(12_000_000_000)).toBe("12 G");
  });
});
