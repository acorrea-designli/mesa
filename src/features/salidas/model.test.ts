import { describe, expect, it } from "vitest";
import { comparedWith, scheduleChoices, secondsElapsed, secondsLeft, stepperItems, undoOpen, wordDiff } from "./model";

const labels = (xs: ReturnType<typeof stepperItems>) => xs.map((x) => (x.type === "v" ? `v${x.n}` : `…${x.from}-${x.to}`));

describe("version stepper collapse", () => {
  it("shows every version up to six", () => {
    expect(labels(stepperItems(3, { current: 3, compared: 2 }))).toEqual(["v1", "v2", "v3"]);
    expect(labels(stepperItems(6, { current: 6 }))).toHaveLength(6);
  });

  it("collapses to v1 · … · starred · … · last three", () => {
    expect(labels(stepperItems(9, { current: 9, compared: 8, starred: [4] }))).toEqual(["v1", "…2-3", "v4", "…5-6", "v7", "v8", "v9"]);
  });

  it("keeps the current version visible after going back", () => {
    expect(labels(stepperItems(12, { current: 5, compared: 12 }))).toEqual(["v1", "…2-4", "v5", "…6-9", "v10", "v11", "v12"]);
  });

  it("shows a lone hidden version instead of a gap", () => {
    expect(labels(stepperItems(7, { current: 7 }))).toEqual(["v1", "…2-4", "v5", "v6", "v7"]);
    expect(labels(stepperItems(7, { current: 7, starred: [3] }))).toEqual(["v1", "v2", "v3", "v4", "v5", "v6", "v7"]);
  });

  it("compares with the previous version, or the latest when you went back", () => {
    expect(comparedWith(1, 1)).toBeNull();
    expect(comparedWith(3, 3)).toBe(2);
    expect(comparedWith(9, 4)).toBe(9);
  });
});

describe("undo countdown", () => {
  const now = Date.parse("2026-11-03T10:44:00.000Z");
  const until = new Date(now + 14_200).toISOString();

  it("rounds seconds left up and never goes negative", () => {
    expect(secondsLeft(until, now)).toBe(15);
    expect(secondsLeft(until, now + 14_200)).toBe(0);
    expect(secondsLeft(until, now + 60_000)).toBe(0);
    expect(secondsLeft(null, now)).toBe(0);
  });

  it("reports elapsed seconds for the travelling tick", () => {
    expect(secondsElapsed(until, now)).toBeCloseTo(5.8, 5);
    expect(secondsElapsed(until, now + 30_000)).toBe(20);
  });

  it("is open only while sending, unreleased and before undo_until", () => {
    expect(undoOpen({ status: "sending", releasedAt: null, undoUntil: until }, now)).toBe(true);
    expect(undoOpen({ status: "sending", releasedAt: until, undoUntil: until }, now)).toBe(false);
    expect(undoOpen({ status: "sending", releasedAt: null, undoUntil: until }, now + 20_000)).toBe(false);
    expect(undoOpen({ status: "pending", releasedAt: null, undoUntil: null }, now)).toBe(false);
  });
});

describe("word diff", () => {
  it("rejoins both sides exactly", () => {
    const a = "Confirmed, SCOUT_API_URL is set on staging. Prod tentatively after 2pm.";
    const b = "All set: SCOUT_API_URL is set on staging. Prod after 2pm.";
    const d = wordDiff(a, b);
    expect(d.filter((o) => o.op !== "ins").map((o) => o.text).join("")).toBe(a);
    expect(d.filter((o) => o.op !== "del").map((o) => o.text).join("")).toBe(b);
    expect(d.some((o) => o.op === "del" && o.text.includes("tentatively"))).toBe(true);
  });
});

describe("schedule choices", () => {
  it("offers today 16:00 only while it is ahead", () => {
    const morning = new Date(2026, 10, 3, 10, 0); // Tue
    expect(scheduleChoices(morning).map((c) => c.label)).toEqual(["Hoy 16:00", "mié 9:00", "mar 9:00"]);
    const evening = new Date(2026, 10, 3, 17, 0);
    expect(scheduleChoices(evening).map((c) => c.label)).toEqual(["mié 9:00", "mar 9:00"]);
  });
});
