// Checklists in the repo (t124): a Claude message with steps, either-way marks by Andrés and Claude, the
// ticket.checklist wake (his marks only), idempotence, the needs line and the resume payload.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { NotFoundError, TransitionError, ValidationError } from "../db/util";
import { ticketNeeds } from "../domain/ticket-needs";
import { eventsAfter } from "../wake/wake";
import { createRepos, type Repos } from "./index";

let r: Repos;
const T0 = new Date("2026-11-12T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const STEPS = [
  { text: "Pega la URL iCal en .env.local", detail: "```\nMESA_ICS_URL=...\n```" },
  { text: "Reinicia Mesa" },
  { text: "Autoriza el conector con /mcp", detail: null },
];

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
});

const request = () => r.tickets.create({ direction: "andres_asks", title: "Conecta el calendario", body: "Conecta el calendario", ownerSession: "lead" }, T0);
const post = (ref: string, steps = STEPS, ms = 1000) => r.tickets.addMessage(ref, { author: "claude", body: "Tres pasos tuyos", steps, session: "lead", ask: true }, at(ms));
const checklistWakes = () => eventsAfter(r.db, "lead", 0).filter((e) => e.kind === "ticket.checklist").map((e) => e.payload);
const needsOf = (ref: string) => {
  const d = r.tickets.detail(ref);
  return ticketNeeds({ status: d.status, messages: d.messages, questions: d.questions, steps: d.checklists.flatMap((c) => c.steps), actions: d.actions, approvals: [], reviews: [], salidas: [] }, T0);
};

describe("posting a checklist", () => {
  it("is one Claude message with its steps as rows, all open, and puts the ticket in Te espera", () => {
    const t = request();
    const d = post(t.id);
    expect(d.status).toBe("waiting_andres");
    expect(d.checklists).toHaveLength(1);
    const c = d.checklists[0]!;
    expect(c.messageId).toBe(d.messages.at(-1)!.id);
    expect([c.done, c.total, c.allDone]).toEqual([0, 3, false]);
    expect(c.steps.map((s) => [s.n, s.text, s.detail, s.state, s.doneBy, s.doneAt, s.note])).toEqual([
      [1, "Pega la URL iCal en .env.local", "```\nMESA_ICS_URL=...\n```", "open", null, null, null],
      [2, "Reinicia Mesa", null, "open", null, null, null],
      [3, "Autoriza el conector con /mcp", null, "open", null, null, null],
    ]);
    expect(c.steps.every((s) => s.id.startsWith("ck_"))).toBe(true);
  });

  it("allows several checklists per ticket, each with its own count", () => {
    const t = request();
    post(t.id, STEPS, 1000);
    const d = post(t.id, [{ text: "Otro" }], 2000);
    expect(d.checklists.map((c) => [c.total, c.steps[0]!.n])).toEqual([[3, 1], [1, 1]]);
  });

  it("refuses a bad checklist, Andrés posting one, a card plus steps, and a closed ticket, changing nothing", () => {
    const t = request();
    const before = r.tickets.detail(t.id);
    expect(() => post(t.id, [])).toThrow(ValidationError);
    expect(() => post(t.id, [{ text: "  " }])).toThrow(/no text/);
    expect(() => r.tickets.addMessage(t.id, { author: "andres", body: "x", steps: STEPS })).toThrow(/only Claude/);
    const AB = [{ key: "A", label: "Sí" }, { key: "B", label: "No" }];
    expect(() => r.tickets.addMessage(t.id, { author: "claude", body: "x", steps: STEPS, questions: [{ text: "¿?", options: AB }] })).toThrow(/not both/);
    r.tickets.transition(t.id, { type: "close", by: "andres" }, undefined, at(500));
    expect(() => post(t.id)).toThrow(TransitionError);
    const after = r.tickets.detail(t.id);
    expect(after.messages).toHaveLength(before.messages.length);
    expect(after.checklists).toEqual([]);
  });
});

describe("Andrés sets a step", () => {
  it("ticks it, takes his turn, stamps his interaction and wakes the owner with the counts", () => {
    const t = request();
    const d = post(t.id);
    const s1 = d.checklists[0]!.steps[0]!;
    const out = r.tickets.setStep(t.id, s1.id, { done: true, by: "andres" }, at(2000));
    const s = out.checklists[0]!.steps[0]!;
    expect([s.state, s.doneBy, s.doneAt, s.note]).toEqual(["done", "andres", at(2000).toISOString(), null]);
    expect(out.status).toBe("waiting_claude"); // his turn taken
    expect(r.lastInteractionAt()).toBe(at(2000).toISOString());
    expect(checklistWakes()).toEqual([
      { ref: t.ref, ticketRef: t.ref, messageId: s1.messageId, stepId: s1.id, n: 1, done: true, doneCount: 1, total: 3, allDone: false },
    ]);
    expect(r.tickets.get(t.id).wokeAt).toBe(at(2000).toISOString());
  });

  it("keeps the ticket in Te espera through the needs until every step is done, then hands it to Claude", () => {
    const t = request();
    const [a, b, c] = post(t.id).checklists[0]!.steps;
    expect(needsOf(t.id)).toEqual([{ kind: "steps", label: "Hacer pasos", detail: "0 de 3 hechos" }]);
    r.tickets.setStep(t.id, a!.id, { done: true, by: "andres" }, at(2000));
    expect(needsOf(t.id)).toEqual([{ kind: "steps", label: "Hacer pasos", detail: "1 de 3 hechos" }]);
    r.tickets.setStep(t.id, b!.id, { done: true, by: "andres" }, at(3000));
    expect(needsOf(t.id)[0]?.detail).toBe("2 de 3 hechos");
    const last = r.tickets.setStep(t.id, c!.id, { done: true, by: "andres" }, at(4000));
    expect(needsOf(t.id)).toEqual([]);
    expect(last.status).toBe("waiting_claude");
    expect(last.checklists[0]).toMatchObject({ done: 3, total: 3, allDone: true });
    expect(checklistWakes().map((w) => [w.n, w.doneCount, w.allDone])).toEqual([[1, 1, false], [2, 2, false], [3, 3, true]]);
  });

  it("unticks it any number of times; each real change wakes, and the step goes back to open", () => {
    const t = request();
    const s1 = post(t.id).checklists[0]!.steps[0]!;
    r.tickets.setStep(t.id, s1.id, { done: true, by: "andres" }, at(2000));
    const out = r.tickets.setStep(t.id, s1.id, { done: false, by: "andres" }, at(3000));
    const s = out.checklists[0]!.steps[0]!;
    expect([s.state, s.doneBy, s.doneAt, s.note]).toEqual(["open", null, null, null]);
    r.tickets.setStep(t.id, s1.id, { done: true, by: "andres" }, at(4000));
    expect(checklistWakes().map((w) => [w.done, w.doneCount])).toEqual([[true, 1], [false, 0], [true, 1]]);
  });

  it("is idempotent: the same state again changes nothing and emits no second wake", () => {
    const t = request();
    const s1 = post(t.id).checklists[0]!.steps[0]!;
    const first = r.tickets.setStep(t.id, s1.id, { done: true, by: "andres" }, at(2000));
    const wakes = checklistWakes().length;
    const again = r.tickets.setStep(t.id, s1.id, { done: true, by: "andres" }, at(9000));
    expect(again.checklists).toEqual(first.checklists);
    expect(again.updatedAt).toBe(first.updatedAt);
    expect(checklistWakes()).toHaveLength(wakes);
    const open = r.tickets.setStep(t.id, s1.id, { done: false, by: "andres" }, at(10_000));
    r.tickets.setStep(t.id, s1.id, { done: false, by: "andres" }, at(11_000));
    expect(open.checklists[0]!.steps[0]!.state).toBe("open");
    expect(checklistWakes()).toHaveLength(wakes + 1);
  });

  it("drops a note: only Claude's marks carry one", () => {
    const t = request();
    const s1 = post(t.id).checklists[0]!.steps[0]!;
    const out = r.tickets.setStep(t.id, s1.id, { done: true, by: "andres", note: "hecho" }, at(2000));
    expect(out.checklists[0]!.steps[0]!.note).toBeNull();
  });
});

describe("Claude marks a step it verified", () => {
  it("records doneBy claude with its note and wakes nobody, never touching the status or his interaction", () => {
    const t = request();
    const s1 = post(t.id).checklists[0]!.steps[0]!;
    const out = r.tickets.setStep(t.id, s1.id, { done: true, by: "claude", note: "Mesa dice configured:true\nal arrancar" }, at(2000));
    const s = out.checklists[0]!.steps[0]!;
    expect([s.state, s.doneBy, s.note]).toEqual(["done", "claude", "Mesa dice configured:true al arrancar"]);
    expect(out.status).toBe("waiting_andres");
    expect(r.lastInteractionAt()).toBeNull();
    expect(checklistWakes()).toEqual([]);
    expect(needsOf(t.id)[0]?.detail).toBe("1 de 3 hechos"); // it counts as done
  });

  it("Andrés can untick it (a wake), and a step he ticked is not overwritten by Claude", () => {
    const t = request();
    const [a, b] = post(t.id).checklists[0]!.steps;
    r.tickets.setStep(t.id, a!.id, { done: true, by: "claude", note: "verificado" }, at(2000));
    const out = r.tickets.setStep(t.id, a!.id, { done: false, by: "andres" }, at(3000));
    expect(out.checklists[0]!.steps[0]).toMatchObject({ state: "open", doneBy: null, note: null });
    expect(checklistWakes().map((w) => w.done)).toEqual([false]);

    r.tickets.setStep(t.id, b!.id, { done: true, by: "andres" }, at(4000));
    const again = r.tickets.setStep(t.id, b!.id, { done: true, by: "claude", note: "yo también" }, at(5000));
    expect(again.checklists[0]!.steps[1]).toMatchObject({ doneBy: "andres", note: null });
  });
});

describe("naming and refusing", () => {
  it("takes a step id, <message>.<n> or a bare n, and refuses unknown or ambiguous ones", () => {
    const t = request();
    const m1 = post(t.id, STEPS, 1000).checklists[0]!;
    const m2 = post(t.id, [{ text: "Otro" }], 2000).checklists[1]!;
    r.tickets.setStep(t.id, `${m1.messageId}.2`, { done: true, by: "claude" }, at(3000));
    r.tickets.setStep(t.id, "3", { done: true, by: "claude" }, at(3000)); // only m1 has a step 3
    r.tickets.setStep(t.id, m2.steps[0]!.id, { done: true, by: "claude" }, at(3000));
    const d = r.tickets.detail(t.id);
    expect(d.checklists.map((c) => c.steps.map((s) => s.state))).toEqual([["open", "done", "done"], ["done"]]);
    expect(() => r.tickets.setStep(t.id, "1", { done: true, by: "claude" })).toThrow(/2 checklists/);
    expect(() => r.tickets.setStep(t.id, "ck_nope", { done: true, by: "claude" })).toThrow(NotFoundError);
    expect(() => r.tickets.setStep(t.id, "9", { done: true, by: "claude" })).toThrow(NotFoundError);
  });

  it("does not reach a step of another ticket", () => {
    const t = request();
    const other = request();
    const s1 = post(t.id).checklists[0]!.steps[0]!;
    expect(() => r.tickets.setStep(other.id, s1.id, { done: true, by: "andres" })).toThrow(NotFoundError);
    expect(r.tickets.detail(t.id).checklists[0]!.steps[0]!.state).toBe("open");
  });

  it("refuses a step of a closed ticket, and closing leaves the step states as they were", () => {
    const t = request();
    const [a, b] = post(t.id).checklists[0]!.steps;
    r.tickets.setStep(t.id, a!.id, { done: true, by: "andres" }, at(2000));
    r.tickets.transition(t.id, { type: "close", by: "andres" }, undefined, at(3000));
    expect(() => r.tickets.setStep(t.id, b!.id, { done: true, by: "andres" })).toThrow(TransitionError);
    expect(() => r.tickets.setStep(t.id, a!.id, { done: false, by: "andres" })).toThrow(TransitionError);
    expect(r.tickets.detail(t.id).checklists[0]!.steps.map((s) => s.state)).toEqual(["done", "open", "open"]);
    expect(needsOf(t.id)).toEqual([]); // a closed ticket needs nothing
  });
});

describe("the resume payload", () => {
  it("ticket context returns every checklist with state, doneBy, note and done / total", () => {
    const t = request();
    const [a, b] = post(t.id).checklists[0]!.steps;
    r.tickets.setStep(t.id, a!.id, { done: true, by: "claude", note: "verificado" }, at(2000));
    r.tickets.setStep(t.id, b!.id, { done: true, by: "andres" }, at(3000));
    const ctx = r.agents.context(t.ref);
    expect(ctx.checklists).toHaveLength(1);
    expect(ctx.checklists[0]).toMatchObject({ done: 2, total: 3, allDone: false });
    expect(ctx.checklists[0]!.steps.map((s) => [s.n, s.state, s.doneBy, s.note])).toEqual([
      [1, "done", "claude", "verificado"],
      [2, "done", "andres", null],
      [3, "open", null, null],
    ]);
    expect(r.tickets.checklists(t.ref)).toEqual(ctx.checklists);
  });
});
