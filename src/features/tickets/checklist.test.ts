import { describe, expect, it } from "vitest";
import { confirmed, isChecked, percent, rolledBack, shownCount } from "./checklist";

const steps = [
  { id: "a", state: "done" as const },
  { id: "b", state: "open" as const },
  { id: "c", state: "open" as const },
];

describe("the optimistic toggle", () => {
  it("shows his pending tap over the server's state", () => {
    expect(isChecked(steps[1]!, {})).toBe(false);
    expect(isChecked(steps[1]!, { b: true })).toBe(true);
    expect(isChecked(steps[0]!, { a: false })).toBe(false); // an untick shows at once too
    expect(isChecked(steps[0]!, { b: true })).toBe(true);
  });

  it("counts pending taps in 'n de k hechos'", () => {
    expect(shownCount(steps, {})).toEqual({ done: 1, total: 3 });
    expect(shownCount(steps, { b: true, c: true })).toEqual({ done: 3, total: 3 });
    expect(shownCount(steps, { a: false })).toEqual({ done: 0, total: 3 });
  });

  it("drops a pending tap once the server agrees, keeps the ones it has not caught up with, drops unknown steps", () => {
    expect(confirmed(steps, { b: true })).toEqual({ b: true }); // the server still says open
    expect(confirmed([{ id: "b", state: "done" }], { b: true })).toEqual({});
    expect(confirmed(steps, { a: false, ghost: true })).toEqual({ a: false });
  });

  it("rolls a failed tap back without touching the others", () => {
    expect(rolledBack({ a: false, b: true }, "b")).toEqual({ a: false });
    expect(rolledBack({}, "x")).toEqual({});
  });

  it("gives the bar a percentage, 0 for an empty list", () => {
    expect(percent(2, 5)).toBe(40);
    expect(percent(5, 5)).toBe(100);
    expect(percent(0, 0)).toBe(0);
  });
});
