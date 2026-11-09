// One ticket.batch wake for 2+ new tickets: Hoy "Abrir tarea y pasar a Claude" (dispatch_items) and Tablero
// "Dárselas a Claude" (dispatch). One new ticket keeps ticket.created; nothing new wakes nobody.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as BATCH } from "@/app/api/tasks/batch/route";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { eventsAfter } from "../wake/wake";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
});

const ctx = () => ({ params: Promise.resolve({}) });
const post = (b: unknown) =>
  BATCH(new Request("http://local/api/tasks/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }), ctx());
const wakes = (kind: string) => eventsAfter(r.db, "lead", 0).filter((e) => e.kind === kind);
const item = (n: number, o: Record<string, unknown> = {}) =>
  r.items.upsert({ source: "basecamp", externalId: `bc:${n}`, kind: "request", title: `Pedido ${n}`, excerpt: `texto ${n}`, project: "freightmate", url: `https://3.basecamp.com/x/${n}`, ...o }).item;

interface Out {
  batchId: string | null;
  results: { task: { id: string; ticketId: string }; ticket: { id: string; ref: string }; created: boolean }[];
  skipped: { id: string; reason: string }[];
}

describe("Hoy dispatch_items", () => {
  it("3 items without a card: 3 cards, 3 tickets, ONE ticket.batch and zero ticket.created", async () => {
    const items = [1, 2, 3].map((n) => item(n));
    const res = await post({ action: "dispatch_items", itemIds: items.map((i) => i.id) });
    expect(res.status).toBe(200);
    const out = (await res.json()) as Out;
    expect(out.batchId).toMatch(/^bt_/);
    expect(out.results.map((x) => x.created)).toEqual([true, true, true]);
    expect(r.tasks.list()).toHaveLength(3);
    expect(r.tickets.list()).toHaveLength(3);
    // The card is made the way Hoy "Crear tarea" does: title, source, project, excerpt, linked item.
    const card = r.tasks.get(out.results[0]!.task.id);
    expect(card).toMatchObject({ title: "Pedido 1", source: "basecamp", project: "freightmate", excerpt: "texto 1", ticketId: out.results[0]!.ticket.id, waitOn: "claude" });
    expect(card.items?.map((i) => i.id)).toEqual([items[0]!.id]);

    expect(wakes("ticket.created")).toHaveLength(0);
    const batch = wakes("ticket.batch");
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({ sessionId: "lead", entityType: "ticket", entityId: out.results[0]!.ticket.id });
    expect(batch[0]!.payload).toEqual({
      batchId: out.batchId,
      origin: "hoy",
      tickets: out.results.map((x, i) => ({ ticketRef: x.ticket.ref, taskId: x.task.id, title: `Pedido ${i + 1}`, urls: [`https://3.basecamp.com/x/${i + 1}`] })),
    });
  });

  it("one item makes one ticket and the usual ticket.created, no batch", async () => {
    const out = (await (await post({ action: "dispatch_items", itemIds: [item(1).id] })).json()) as Out;
    expect(out.batchId).toBeNull();
    expect(wakes("ticket.batch")).toHaveLength(0);
    expect(wakes("ticket.created").map((e) => e.payload.ticketRef)).toEqual([out.results[0]!.ticket.ref]);
  });

  it("reuses the card an item already has and says an open ticket was there; existing tickets stay out of the payload", async () => {
    const a = item(1);
    const card = r.tasks.create({ title: "Mi tarjeta", source: "basecamp", itemIds: [a.id] });
    const first = r.dispatch.dispatch(card.id);
    const b = item(2);
    const c = item(3);
    const out = (await (await post({ action: "dispatch_items", itemIds: [a.id, b.id, c.id, b.id] })).json()) as Out;
    expect(out.results.map((x) => [x.created, x.task.id === card.id])).toEqual([
      [false, true],
      [true, false],
      [true, false],
    ]);
    expect(out.results[0]!.ticket.ref).toBe(first.ticket.ref);
    expect(r.tasks.list()).toHaveLength(3); // no second card for the item that had one
    const payload = wakes("ticket.batch")[0]!.payload as { tickets: { ticketRef: string }[] };
    expect(payload.tickets.map((t) => t.ticketRef)).toEqual([out.results[1]!.ticket.ref, out.results[2]!.ticket.ref]);
    expect(wakes("ticket.created").map((e) => e.payload.ticketRef)).toEqual([first.ticket.ref]);
  });

  it("skips sample items without making a card, and 0 new tickets wakes nobody", async () => {
    const s = item(1, { isSample: true });
    const out = (await (await post({ action: "dispatch_items", itemIds: [s.id] })).json()) as Out;
    expect(out).toEqual({ batchId: null, results: [], skipped: [{ id: s.id, reason: "sample" }] });
    expect(r.tasks.list()).toHaveLength(0);
    expect(eventsAfter(r.db, "lead", 0)).toHaveLength(0);
    const again = (await (await post({ action: "dispatch_items", itemIds: [item(2).id, item(3).id] })).json()) as Out;
    const redo = (await (await post({ action: "dispatch_items", itemIds: again.results.map((x) => r.items.list().find((i) => i.taskId === x.task.id)!.id) })).json()) as Out;
    expect(redo.results.map((x) => x.created)).toEqual([false, false]);
    expect(redo.batchId).toBeNull();
    expect(wakes("ticket.batch")).toHaveLength(1);
  });

  it("an unknown item id is a 404 and the whole batch rolls back", async () => {
    const a = item(1);
    const res = await post({ action: "dispatch_items", itemIds: [a.id, "it_missing"] });
    expect(res.status).toBe(404);
    expect(r.tasks.list()).toHaveLength(0);
    expect(r.tickets.list()).toHaveLength(0);
    expect(eventsAfter(r.db, "lead", 0)).toHaveLength(0);
    expect(r.items.get(a.id).taskId).toBeNull();
  });

  it("validates the body", async () => {
    expect((await post({ action: "dispatch_items", itemIds: [] })).status).toBe(400);
    expect((await post({ action: "dispatch_items", itemIds: Array.from({ length: 201 }, (_, i) => `i${i}`) })).status).toBe(400);
  });
});

describe("Tablero dispatch", () => {
  const card = (t: string, o: Record<string, unknown> = {}) => r.tasks.create({ title: t, source: "slack", ...o });

  it(">= 2 cards: one ticket.batch with origin tablero, no ticket.created; the response carries the batchId", async () => {
    const [a, b] = [card("A"), card("B")];
    const out = (await (await post({ action: "dispatch", ids: [a.id, b.id] })).json()) as Out;
    expect(out.batchId).toMatch(/^bt_/);
    expect(wakes("ticket.created")).toHaveLength(0);
    expect(wakes("ticket.batch")).toHaveLength(1);
    expect(wakes("ticket.batch")[0]!.payload).toMatchObject({ batchId: out.batchId, origin: "tablero", tickets: [{ taskId: a.id }, { taskId: b.id }] });
  });

  it("1 card still emits ticket.created", async () => {
    const a = card("A");
    const out = (await (await post({ action: "dispatch", ids: [a.id] })).json()) as Out;
    expect(out.batchId).toBeNull();
    expect(wakes("ticket.batch")).toHaveLength(0);
    expect(wakes("ticket.created")).toHaveLength(1);
  });

  it("already-dispatched and sample cards are excluded; a batch with 0 new tickets emits nothing", async () => {
    const [a, b, c] = [card("A"), card("B"), card("C")];
    const s = card("S", { isSample: true });
    r.dispatch.dispatch(a.id);
    const base = eventsAfter(r.db, "lead", 0).length;
    // one new (b) + existing (a) + sample: a single new ticket is a plain ticket.created
    const one = (await (await post({ action: "dispatch", ids: [a.id, b.id, s.id] })).json()) as Out;
    expect(one.batchId).toBeNull();
    expect(one.skipped).toEqual([{ id: s.id, reason: "sample" }]);
    expect(wakes("ticket.created").map((e) => e.payload.taskId)).toEqual([a.id, b.id]);
    // two new (c + a fresh one) plus the two existing: the batch lists only the new ones
    const d = card("D");
    const two = (await (await post({ action: "dispatch", ids: [a.id, b.id, c.id, d.id] })).json()) as Out;
    expect(two.batchId).toMatch(/^bt_/);
    expect((wakes("ticket.batch")[0]!.payload as { tickets: { taskId: string }[] }).tickets.map((t) => t.taskId)).toEqual([c.id, d.id]);
    // nothing new: no wake at all
    const before = eventsAfter(r.db, "lead", 0).length;
    const none = (await (await post({ action: "dispatch", ids: [a.id, b.id, c.id, d.id, s.id] })).json()) as Out;
    expect(none.batchId).toBeNull();
    expect(eventsAfter(r.db, "lead", 0)).toHaveLength(before);
    expect(base).toBe(1);
  });
});
