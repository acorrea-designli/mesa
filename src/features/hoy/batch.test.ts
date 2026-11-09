// Hoy "Ticket tN" chip: it follows the item's card to its open ticket (after a fold, the primary), and the batch bar copy.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/sqlite";
import { createRepos, type Repos } from "@/lib/repo";
import { loadHoy } from "./data";
import { selectedLabel } from "./model";

const NOW = new Date("2026-11-09T15:00:00Z");
const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
});

const ref = (id: string) => loadHoy(NOW).details[id]?.ticketRef;
const item = (n: number) => r.items.create({ source: "basecamp", externalId: `bc:${n}`, kind: "request", title: `Pedido ${n}`, project: "Freightmate", receivedAt: "2026-11-09T14:00:00Z" }, NOW);

describe("Hoy ticket chip", () => {
  it("is empty for an item without a card or with a card nobody handed to Claude", () => {
    const a = item(1);
    expect(ref(a.id)).toBeNull();
    r.tasks.create({ title: "Pedido 1", source: "basecamp", itemIds: [a.id] }, NOW);
    expect(ref(a.id)).toBeNull();
  });

  it("reads the open ticket of the item's card, and the primary once it is folded", () => {
    const [a, b] = [item(1), item(2)];
    const out = r.dispatch.dispatchItems([a.id, b.id], {}, NOW);
    const [ta, tb] = out.results.map((x) => x.ticket.ref);
    expect([ref(a.id), ref(b.id)]).toEqual([ta, tb]);
    r.tickets.fold(ta!, { from: [tb!], why: "mismo tema" }, NOW);
    expect([ref(a.id), ref(b.id)]).toEqual([ta, ta]);
    r.tickets.transition(ta!, { type: "close", by: "claude" }, undefined, NOW);
    expect([ref(a.id), ref(b.id)]).toEqual([null, null]);
  });

  it("falls back to the ticket named in the item's meta", () => {
    const a = r.items.create({ source: "claude", externalId: "q1", kind: "question", title: "¿A o B?", meta: { ticketRef: "t9" }, receivedAt: "2026-11-09T14:00:00Z" }, NOW);
    expect(ref(a.id)).toBe("t9");
  });
});

describe("batch bar copy", () => {
  it("counts in the masculine, singular and plural", () => {
    expect(selectedLabel(1)).toBe("1 seleccionado");
    expect(selectedLabel(3)).toBe("3 seleccionados");
  });
});
