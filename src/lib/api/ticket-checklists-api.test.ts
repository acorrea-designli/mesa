// API tests for checklists (t124): POST /api/tickets/:id/checklist (Claude) and PUT /api/tickets/:id/steps/:step
// (Andrés from the UI, Claude from the CLI marker), zod-validated, 4xx without side effects.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as CHECKLIST } from "@/app/api/tickets/[id]/checklist/route";
import { PUT as STEP } from "@/app/api/tickets/[id]/steps/[step]/route";
import { GET as CONTEXT } from "@/app/api/tickets/[id]/context/route";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import type { TicketContext, TicketDetail } from "../domain/types";
import { eventsAfter } from "../wake/wake";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
let ref: string;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" });
  ref = r.tickets.create({ direction: "andres_asks", title: "Conecta el calendario", body: "Conecta el calendario", ownerSession: "lead" }).ref;
});

const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const req = (body: unknown, cli = false, method = "POST") =>
  new Request("http://local/x", { method, headers: { "content-type": "application/json", ...(cli ? { "x-mesa-client": "cli" } : {}) }, body: JSON.stringify(body) });
const STEPS = [{ text: "Pega la URL", detail: "en `.env.local`" }, { text: "Reinicia Mesa" }];
const post = (body: unknown, id = ref) => CHECKLIST(req(body), ctx({ id }));
const mark = (step: string, body: unknown, o: { cli?: boolean; id?: string } = {}) => STEP(req(body, o.cli, "PUT"), ctx({ id: o.id ?? ref, step }));
const snapshot = () => {
  const d = r.tickets.detail(ref);
  return { messages: d.messages.length, checklists: d.checklists, status: d.status };
};
const wakes = () => eventsAfter(r.db, "lead", 0).filter((e) => e.kind === "ticket.checklist");

describe("POST /api/tickets/:id/checklist", () => {
  it("posts one Claude message with its steps and puts the ticket in Te espera", async () => {
    const res = await post({ body: "Dos pasos tuyos", steps: STEPS, session: "lead" });
    expect(res.status).toBe(200);
    const d = (await res.json()) as TicketDetail;
    expect(d.status).toBe("waiting_andres");
    expect(d.messages.at(-1)).toMatchObject({ author: "claude", body: "Dos pasos tuyos" });
    expect(d.checklists).toHaveLength(1);
    expect(d.checklists[0]).toMatchObject({ done: 0, total: 2, allDone: false });
    expect(d.checklists[0]!.steps.map((s) => [s.n, s.text, s.detail, s.state])).toEqual([
      [1, "Pega la URL", "en `.env.local`", "open"],
      [2, "Reinicia Mesa", null, "open"],
    ]);
  });

  it("refuses bad input with 400 and changes nothing", async () => {
    const before = snapshot();
    for (const b of [
      {},
      { steps: [] },
      { steps: Array.from({ length: 31 }, (_, i) => ({ text: `p${i}` })) },
      { steps: [{ text: "" }] },
      { steps: [{ text: "   " }] },
      { steps: [{ text: "x".repeat(301) }] },
      { steps: [{ text: "ok", detail: "d".repeat(4001) }] },
      { steps: [{ detail: "sin texto" }] },
      { steps: "pega la URL" },
    ]) {
      const res = await post(b);
      expect(res.status, JSON.stringify(b).slice(0, 80)).toBe(400);
    }
    expect(snapshot()).toEqual(before);
  });

  it("404 for an unknown ticket, 409 for a closed one", async () => {
    expect((await post({ steps: STEPS }, "t999")).status).toBe(404);
    r.tickets.transition(ref, { type: "close", by: "andres" });
    const before = snapshot();
    expect((await post({ steps: STEPS })).status).toBe(409);
    expect(snapshot()).toEqual(before);
  });
});

describe("PUT /api/tickets/:id/steps/:step", () => {
  const stepsOf = async () => ((await (await post({ steps: STEPS, session: "lead" })).json()) as TicketDetail).checklists[0]!.steps;

  it("a UI call is Andrés: doneBy andres, his turn taken, the owner wakes with the counts", async () => {
    const [s1] = await stepsOf();
    const res = await mark(s1!.id, { done: true });
    expect(res.status).toBe(200);
    const d = (await res.json()) as TicketDetail;
    expect(d.checklists[0]!.steps[0]).toMatchObject({ state: "done", doneBy: "andres", note: null });
    expect(d.status).toBe("waiting_claude");
    expect(r.lastInteractionAt()).not.toBeNull();
    expect(wakes().map((w) => w.payload)).toEqual([
      { ref, ticketRef: ref, messageId: s1!.messageId, stepId: s1!.id, n: 1, done: true, doneCount: 1, total: 2, allDone: false },
    ]);
  });

  it("a CLI call (x-mesa-client: cli) is Claude: doneBy claude with its note, no wake, no interaction", async () => {
    const [s1] = await stepsOf();
    const res = await mark(s1!.id, { done: true, note: "Mesa dice configured:true" }, { cli: true });
    expect(res.status).toBe(200);
    const d = (await res.json()) as TicketDetail;
    expect(d.checklists[0]!.steps[0]).toMatchObject({ state: "done", doneBy: "claude", note: "Mesa dice configured:true" });
    expect(d.status).toBe("waiting_andres");
    expect(r.lastInteractionAt()).toBeNull();
    expect(wakes()).toEqual([]);
  });

  it("sets the same state twice without a second wake, and Andrés can untick", async () => {
    const [s1] = await stepsOf();
    await mark(s1!.id, { done: true });
    await mark(s1!.id, { done: true });
    expect(wakes()).toHaveLength(1);
    const d = (await (await mark(s1!.id, { done: false })).json()) as TicketDetail;
    expect(d.checklists[0]!.steps[0]).toMatchObject({ state: "open", doneBy: null });
    expect(wakes()).toHaveLength(2);
  });

  it("names a step by id, <message>.<n> or a bare n", async () => {
    const [s1, s2] = await stepsOf();
    expect((await mark(`${s1!.messageId}.1`, { done: true })).status).toBe(200);
    expect((await mark("2", { done: true })).status).toBe(200);
    const d = r.tickets.detail(ref);
    expect(d.checklists[0]!.steps.map((s) => s.state)).toEqual(["done", "done"]);
    expect(s2!.n).toBe(2);
  });

  it("400 for bad input or an ambiguous n, 404 for an unknown step, 409 for a closed ticket", async () => {
    const [s1] = await stepsOf();
    await post({ steps: [{ text: "Otro" }] });
    const before = snapshot();
    for (const b of [{}, { done: "yes" }, { done: true, note: "x".repeat(301) }]) expect((await mark(s1!.id, b)).status, JSON.stringify(b)).toBe(400);
    const ambiguous = await mark("1", { done: true });
    expect(ambiguous.status).toBe(400);
    expect(((await ambiguous.json()) as { error: { message: string } }).error.message).toMatch(/2 checklists/);
    expect((await mark("ck_nope", { done: true })).status).toBe(404);
    expect((await mark(s1!.id, { done: true }, { id: "t999" })).status).toBe(404);
    expect(snapshot()).toEqual(before);
    r.tickets.transition(ref, { type: "close", by: "andres" });
    expect((await mark(s1!.id, { done: true })).status).toBe(409);
  });

  it("ticket context returns the steps with state, doneBy, note and done / total", async () => {
    const [s1, s2] = await stepsOf();
    await mark(s1!.id, { done: true, note: "verificado" }, { cli: true });
    await mark(s2!.id, { done: true });
    const res = await CONTEXT(new Request(`http://local/api/tickets/${ref}/context`), ctx({ id: ref }));
    const c = (await res.json()) as TicketContext;
    expect(c.checklists[0]).toMatchObject({ done: 2, total: 2, allDone: true });
    expect(c.checklists[0]!.steps.map((s) => [s.n, s.state, s.doneBy, s.note])).toEqual([
      [1, "done", "claude", "verificado"],
      [2, "done", "andres", null],
    ]);
  });
});
