import { describe, expect, it } from "vitest";
import { checklistOf, checklistProblem, findStep, groupChecklists, MAX_STEPS, stepCount, stepsOwed } from "./ticket-checklists";
import type { TicketStep } from "./types";

const step = (id: string, messageId: string, n: number, state: "open" | "done" = "open", doneBy: "andres" | "claude" | null = null): TicketStep => ({
  id,
  ticketId: "tk_1",
  messageId,
  n,
  text: `paso ${n}`,
  detail: null,
  state,
  doneBy: state === "done" ? (doneBy ?? "andres") : null,
  doneAt: state === "done" ? "2026-11-12T10:00:00.000Z" : null,
  note: null,
  createdAt: "2026-11-12T09:00:00.000Z",
});

describe("checklistProblem", () => {
  it("accepts 1-30 steps with text and an optional detail", () => {
    expect(checklistProblem([{ text: "Pega la URL" }])).toBeNull();
    expect(checklistProblem([{ text: "Autoriza", detail: "```\n/mcp\n```" }, { text: "Otro", detail: null }])).toBeNull();
    expect(checklistProblem(Array.from({ length: MAX_STEPS }, (_, i) => ({ text: `p${i}` })))).toBeNull();
  });

  it("refuses an empty list, more than 30, blank text, long text and a long detail, naming the step", () => {
    expect(checklistProblem([])).toMatch(/1-30 steps/);
    expect(checklistProblem(Array.from({ length: MAX_STEPS + 1 }, () => ({ text: "x" })))).toMatch(/1-30 steps/);
    expect(checklistProblem([{ text: "ok" }, { text: "   " }])).toBe("step 2 has no text");
    expect(checklistProblem([{ text: "x".repeat(301) }])).toMatch(/step 1: text is over 300/);
    expect(checklistProblem([{ text: "x", detail: "d".repeat(4001) }])).toMatch(/step 1: detail is over 4000/);
  });
});

describe("counts and grouping", () => {
  const steps = [step("a1", "m1", 1, "done"), step("a2", "m1", 2), step("a3", "m1", 3, "done", "claude"), step("b2", "m2", 2, "done"), step("b1", "m2", 1, "done")];

  it("counts done and total", () => {
    expect(stepCount(steps)).toEqual({ done: 4, total: 5 });
    expect(stepCount([])).toEqual({ done: 0, total: 0 });
  });

  it("groups by message in step order with done / total and allDone", () => {
    const lists = groupChecklists(steps);
    expect(lists.map((c) => [c.messageId, c.done, c.total, c.allDone])).toEqual([
      ["m1", 2, 3, false],
      ["m2", 2, 2, true],
    ]);
    expect(lists[1]!.steps.map((s) => s.n)).toEqual([1, 2]);
    expect(checklistOf(lists, "m2")?.allDone).toBe(true);
    expect(checklistOf(lists, "nope")).toBeNull();
  });

  it("owes only the checklists that still have an open step", () => {
    expect(stepsOwed(steps)).toEqual({ done: 2, total: 3, open: 1 });
    expect(stepsOwed([step("b1", "m2", 1, "done")])).toEqual({ done: 0, total: 0, open: 0 });
    expect(stepsOwed([step("a1", "m1", 1), step("a2", "m1", 2, "done"), step("c1", "m3", 1)])).toEqual({ done: 1, total: 3, open: 2 });
  });
});

describe("findStep", () => {
  const one = [step("ck_1", "tm_a", 1), step("ck_2", "tm_a", 2)];
  const two = [...one, step("ck_3", "tm_b", 1)];

  it("takes a step id, <message>.<n> or <message>/<n>", () => {
    expect(findStep(two, "ck_3")).toMatchObject({ step: { id: "ck_3" } });
    expect(findStep(two, "tm_a.2")).toMatchObject({ step: { id: "ck_2" } });
    expect(findStep(two, "tm_b/1")).toMatchObject({ step: { id: "ck_3" } });
  });

  it("takes a bare n only while one checklist has it", () => {
    expect(findStep(one, "2")).toMatchObject({ step: { id: "ck_2" } });
    expect(findStep(two, "2")).toMatchObject({ step: { id: "ck_2" } });
    expect(findStep(two, "1")).toMatchObject({ error: "ambiguous", message: expect.stringMatching(/2 checklists/) });
  });

  it("says not_found for anything else", () => {
    expect(findStep(two, "ck_9")).toMatchObject({ error: "not_found" });
    expect(findStep(two, "tm_a.9")).toMatchObject({ error: "not_found" });
    expect(findStep(two, "7")).toMatchObject({ error: "not_found" });
    expect(findStep([], "1")).toMatchObject({ error: "not_found" });
  });
});
