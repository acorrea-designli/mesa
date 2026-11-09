// The lead groups same-topic tickets of a ticket.batch (fold) and Andrés splits them out again (unfold). The cards follow
// the ticket: a primary moves every card grouped into it, a folded ticket moves none.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "./index";
import { eventsAfter } from "../wake/wake";

const T0 = new Date("2026-11-09T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
let r: Repos;

const wakes = (kind: string) => eventsAfter(r.db, "lead", 0).filter((e) => e.kind === kind);
const bodies = (ref: string) => r.tickets.detail(ref).messages.map((m) => m.body);

/** Three cards handed over together: Matt's Basecamp ask, Sebas's PR that resolves it, and something unrelated. */
function batch() {
  const bc = r.items.upsert({ source: "basecamp", externalId: "bc:1", kind: "request", title: "Export roto", url: "https://3.basecamp.com/x/1", project: "scout" }, T0).item;
  const pr = r.items.upsert({ source: "github", externalId: "pr:acme/api#7", kind: "pr_review", title: "fix export", url: "https://github.com/acme/api/pull/7", project: "acme/api" }, T0).item;
  const other = r.items.upsert({ source: "slack", externalId: "C1:1.1", kind: "message", title: "otra cosa", project: "ops" }, T0).item;
  const out = r.dispatch.dispatchItems([bc.id, pr.id, other.id], {}, T0);
  const [a, b, c] = out.results;
  return { a: a!, b: b!, c: c!, bc, pr, other, batchId: out.batchId };
}

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  r.sessions.touch({ id: "lead" }, T0);
});

describe("mesa ticket fold", () => {
  it("re-points and moves the cards, copies refs, says why on both sides and closes the folded ticket quietly", () => {
    const { a, b, c } = batch();
    r.tickets.transition(a.ticket.ref, { type: "claim" }, "lead", at(500)); // the primary's card is in doing
    r.tasks.move(b.task.id, "todo", undefined, at(600));
    const wakesBefore = eventsAfter(r.db, "lead", 0).length;

    const d = r.tickets.fold(a.ticket.ref, { from: [b.ticket.ref], why: "el PR resuelve el pedido de Matt" }, at(1000));

    // cards
    expect(r.tasks.get(b.task.id)).toMatchObject({ ticketId: a.ticket.id, station: "doing" });
    expect(r.tasks.get(a.task.id).station).toBe("doing");
    expect(r.items.list().find((i) => i.taskId === b.task.id)?.station).toBe("doing"); // linked items follow the card
    // refs: theirs come over once, plus a ticket ref to each folded ticket; no duplicates of what the primary had
    const targets = d.refs.map((x) => `${x.refType}:${x.target}`);
    expect(targets).toContain("url:https://github.com/acme/api/pull/7");
    expect(targets).toContain("url:https://3.basecamp.com/x/1");
    expect(targets).toContain(`ticket:${b.ticket.ref}`);
    expect(new Set(targets).size).toBe(targets.length);
    // words
    expect(bodies(a.ticket.ref).at(-1)).toBe(`Agrupé: ${b.ticket.ref} «fix export» porque el PR resuelve el pedido de Matt`);
    expect(bodies(b.ticket.ref).at(-1)).toBe(`Agrupado en ${a.ticket.ref}: el PR resuelve el pedido de Matt`);
    // the primary keeps its status (informational), the folded ticket closes with no wake and no card move
    expect(d.status).toBe("working");
    expect(r.tickets.get(b.ticket.ref)).toMatchObject({ status: "closed" });
    expect(eventsAfter(r.db, "lead", 0)).toHaveLength(wakesBefore);
    expect(r.tasks.get(b.task.id).station).toBe("doing");
    expect(r.tasks.get(c.task.id).ticketId).toBe(c.ticket.id); // the unrelated ticket is untouched
  });

  it("folds several tickets at once and lists each in the one message", () => {
    const { a, b, c } = batch();
    r.tickets.fold(a.ticket.ref, { from: [b.ticket.ref, c.ticket.id, b.ticket.id], why: "mismo tema" }, at(1000));
    expect(bodies(a.ticket.ref).filter((x) => x.startsWith("Agrupé"))).toEqual([`Agrupé: ${b.ticket.ref} «fix export», ${c.ticket.ref} «otra cosa» porque mismo tema`]);
    expect([b, c].map((x) => r.tickets.get(x.ticket.ref).status)).toEqual(["closed", "closed"]);
    expect([b, c].map((x) => r.tasks.get(x.task.id).ticketId)).toEqual([a.ticket.id, a.ticket.id]);
  });

  it("refuses with 409 a closed primary, a closed or sample or Claude-asked ticket, and a from that contains the primary", () => {
    const { a, b, c } = batch();
    const fold = (p: string, from: string[]) => () => r.tickets.fold(p, { from, why: "x" }, at(1000));
    expect(fold(a.ticket.ref, [a.ticket.ref, b.ticket.ref])).toThrow(/itself/);
    const sample = r.tickets.create({ direction: "andres_asks", title: "muestra", ownerSession: "lead", isSample: true }, T0);
    expect(fold(a.ticket.ref, [sample.ref])).toThrow(/sample/);
    const asks = r.tickets.create({ direction: "claude_asks", title: "¿A o B?", ownerSession: "lead" }, T0);
    expect(fold(a.ticket.ref, [asks.ref])).toThrow(/not an Andrés request/);
    expect(fold(sample.ref, [a.ticket.ref])).toThrow(/sample/);
    r.tickets.transition(c.ticket.ref, { type: "close", by: "claude" }, undefined, at(500));
    expect(fold(a.ticket.ref, [c.ticket.ref])).toThrow(/closed/);
    expect(fold(c.ticket.ref, [b.ticket.ref])).toThrow(/closed/);
    expect(fold(a.ticket.ref, [])).toThrow(/nothing to fold/);
    // nothing changed on any failure
    expect(r.tickets.get(b.ticket.ref).status).toBe("waiting_claude");
    expect(r.tasks.get(b.task.id).ticketId).toBe(b.ticket.id);
    // a folded ticket is closed, so it cannot be folded again
    r.tickets.fold(a.ticket.ref, { from: [b.ticket.ref], why: "x" }, at(2000));
    expect(fold(a.ticket.ref, [b.ticket.ref])).toThrow(/closed/);
  });

  it("an unknown ticket is not found and rolls everything back", () => {
    const { a, b } = batch();
    expect(() => r.tickets.fold(a.ticket.ref, { from: [b.ticket.ref, "t999"], why: "x" }, at(1000))).toThrow(/not found/);
    expect(r.tickets.get(b.ticket.ref).status).toBe("waiting_claude");
  });
});

describe("card follows ticket", () => {
  it("a primary moves every card grouped into it on its status changes; the folded ticket moves none", () => {
    const { a, b, c } = batch();
    r.tickets.fold(a.ticket.ref, { from: [b.ticket.ref, c.ticket.ref], why: "mismo tema" }, at(1000));
    const stations = () => [a, b, c].map((x) => r.tasks.get(x.task.id).station);
    expect(stations()).toEqual(["inbox", "inbox", "inbox"]);

    r.tickets.transition(a.ticket.ref, { type: "claim" }, "lead", at(2000));
    r.tickets.plan(a.ticket.ref, [{ kind: "x", source: "claude", label: "x", mode: "needs_ok" }], "lead", at(3000));
    expect(stations()).toEqual(["waiting", "waiting", "waiting"]);
    r.tickets.approvePlan(a.ticket.ref, [], at(4000));
    expect(stations()).toEqual(["doing", "doing", "doing"]);
    r.tickets.transition(a.ticket.ref, { type: "close", by: "claude" }, undefined, at(5000));
    expect(stations()).toEqual(["done", "done", "done"]);
    r.tickets.transition(a.ticket.ref, { type: "reopen" }, undefined, at(6000));
    expect(stations()).toEqual(["doing", "doing", "doing"]);
  });

  it("the old ticket of a card that got a new one no longer drags it along", () => {
    const x = r.tasks.create({ title: "X", source: "claude" }, T0);
    const first = r.dispatch.dispatch(x.id, {}, T0);
    r.tickets.transition(first.ticket.ref, { type: "close", by: "andres" }, undefined, at(500));
    const second = r.dispatch.dispatch(x.id, {}, at(600));
    r.tickets.transition(second.ticket.ref, { type: "close", by: "claude" }, undefined, at(700));
    expect(r.tasks.get(x.id).station).toBe("done");
    r.tickets.transition(first.ticket.ref, { type: "reopen" }, undefined, at(800)); // its card is the second ticket's now
    expect(r.tasks.get(x.id).station).toBe("done");
  });
});

describe("mesa ticket unfold", () => {
  it("restores the card link, reopens the ticket unclaimed and wakes the lead with ticket.created { splitFrom }", () => {
    const { a, b } = batch();
    r.tickets.fold(a.ticket.ref, { from: [b.ticket.ref], why: "mismo tema" }, at(1000));
    r.tickets.transition(a.ticket.ref, { type: "claim" }, "lead", at(1500));
    expect(r.tasks.get(b.task.id).station).toBe("doing");

    const d = r.tickets.unfold(a.ticket.ref, b.ticket.ref, at(2000));

    expect(d).toMatchObject({ ref: b.ticket.ref, status: "waiting_claude", closedAt: null });
    expect(r.tasks.get(b.task.id)).toMatchObject({ ticketId: b.ticket.id, station: "doing" });
    expect(bodies(a.ticket.ref).at(-1)).toBe(`Separé ${b.ticket.ref} de este ticket`);
    expect(bodies(b.ticket.ref).at(-1)).toBe(`Separado de ${a.ticket.ref}`);
    // the fold marker and the primary's pointer to it are gone, so it can fold again
    expect(r.tickets.detail(b.ticket.ref).refs.some((x) => x.target === a.ticket.ref)).toBe(false);
    expect(r.tickets.detail(a.ticket.ref).refs.some((x) => x.target === b.ticket.ref)).toBe(false);
    // exactly one ticket.created: the split ticket, with splitFrom and the review hint of its PR (the batch sent none)
    const created = wakes("ticket.created");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ sessionId: "lead", entityId: b.ticket.id, payload: { ref: b.ticket.ref, ticketRef: b.ticket.ref, taskId: b.task.id, kind: "review", splitFrom: a.ticket.ref } });
    expect(wakes("ticket.reopened")).toHaveLength(0);
    r.tickets.fold(a.ticket.ref, { from: [b.ticket.ref], why: "otra vez" }, at(3000));
    expect(r.tickets.get(b.ticket.ref).status).toBe("closed");
  });

  it("is a 409 when the ticket was not folded into that primary", () => {
    const { a, b, c } = batch();
    expect(() => r.tickets.unfold(a.ticket.ref, b.ticket.ref, at(1000))).toThrow(/was not folded into/); // open, never folded
    r.tickets.fold(a.ticket.ref, { from: [b.ticket.ref], why: "x" }, at(1500));
    expect(() => r.tickets.unfold(c.ticket.ref, b.ticket.ref, at(2000))).toThrow(/was not folded into/); // folded elsewhere
    r.tickets.transition(c.ticket.ref, { type: "close", by: "claude" }, undefined, at(2500));
    expect(() => r.tickets.unfold(a.ticket.ref, c.ticket.ref, at(3000))).toThrow(/was not folded into/); // closed, but not folded
    r.tickets.unfold(a.ticket.ref, b.ticket.ref, at(4000));
    expect(() => r.tickets.unfold(a.ticket.ref, b.ticket.ref, at(5000))).toThrow(/was not folded into/); // already split
  });
});
