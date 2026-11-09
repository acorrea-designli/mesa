import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { NotFoundError } from "../db/util";
import { createRepos, type Repos } from "./index";

const T0 = new Date("2026-11-09T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

let r: Repos;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
});

const thread = (externalId = "bc:1:100", extra: Record<string, unknown> = {}) => ({
  source: "basecamp" as const,
  externalId,
  kind: "message",
  title: "Matt: tarifa",
  excerpt: "primer mensaje",
  station: "inbox" as const,
  waitOn: "you",
  ...extra,
});

describe("Saltar: skip and unskip", () => {
  it("skip marks the item done, waitOn none, skippedAt now, and leaves its card and tickets alone", () => {
    const { item } = r.items.upsert(thread(), T0);
    const task = r.tasks.create({ title: "Tarifa", source: "basecamp", station: "todo", itemIds: [item.id] }, T0);
    const ticketsBefore = r.tickets.list().length;
    const cardBefore = r.tasks.get(task.id);

    const skipped = r.items.skip(item.id, at(1000));
    expect(skipped).toMatchObject({ station: "done", waitOn: "none", skippedAt: at(1000).toISOString(), taskId: task.id });
    expect(r.tasks.get(task.id)).toMatchObject({ station: cardBefore.station, syncState: cardBefore.syncState, updatedAt: cardBefore.updatedAt });
    expect(r.tickets.list()).toHaveLength(ticketsBefore);
    expect(r.items.get(item.id).skippedAt).toBe(at(1000).toISOString());
  });

  it("an item that was never skipped has skippedAt null", () => {
    expect(r.items.upsert(thread(), T0).item.skippedAt).toBeNull();
  });

  it("re-upsert of the same externalId keeps it skipped and refreshes the content", () => {
    const { item } = r.items.upsert(thread(), T0);
    r.items.skip(item.id, at(1000));

    const again = r.items.upsert(thread("bc:1:100", { title: "Matt: tarifa (editado)", excerpt: "texto nuevo", meta: { n: 2 } }), at(2000));
    expect(again.created).toBe(false);
    expect(again.item).toMatchObject({
      id: item.id,
      station: "done",
      waitOn: "none",
      skippedAt: at(1000).toISOString(),
      title: "Matt: tarifa (editado)",
      excerpt: "texto nuevo",
      meta: { n: 2 },
    });
  });

  it("a new externalId from the same thread is a normal Te espera item", () => {
    const { item } = r.items.upsert(thread(), T0);
    r.items.skip(item.id, at(1000));
    const next = r.items.upsert(thread("bc:1:101", { excerpt: "segundo mensaje" }), at(2000));
    expect(next.created).toBe(true);
    expect(next.item).toMatchObject({ station: "inbox", waitOn: "you", skippedAt: null });
  });

  it("unskip restores the given station and waitOn and clears skippedAt", () => {
    const { item } = r.items.upsert(thread(), T0);
    r.items.skip(item.id, at(1000));
    const back = r.items.unskip(item.id, { station: "inbox", waitOn: "you" }, at(2000));
    expect(back).toMatchObject({ station: "inbox", waitOn: "you", skippedAt: null });
    // No longer skipped: an upsert behaves as before.
    expect(r.items.upsert(thread("bc:1:100", { station: "waiting", waitOn: "client" }), at(3000)).item).toMatchObject({ station: "waiting", waitOn: "client" });
  });

  it("a move to a non-done station clears skippedAt; a move to done keeps it", () => {
    const { item } = r.items.upsert(thread(), T0);
    r.items.skip(item.id, at(1000));
    expect(r.items.update(item.id, { station: "done", waitOn: "none" }, at(1500)).skippedAt).not.toBeNull();
    expect(r.items.update(item.id, { station: "todo", waitOn: "you" }, at(2000))).toMatchObject({ station: "todo", skippedAt: null });
  });

  it("moving the card out of Hecho clears skippedAt on its items", () => {
    const { item } = r.items.upsert(thread(), T0);
    const task = r.tasks.create({ title: "Tarifa", source: "basecamp", station: "todo", itemIds: [item.id] }, T0);
    r.items.skip(item.id, at(1000));
    r.tasks.move(task.id, "done", undefined, at(1500));
    expect(r.items.get(item.id).skippedAt).not.toBeNull();
    r.tasks.move(task.id, "doing", undefined, at(2000));
    expect(r.items.get(item.id)).toMatchObject({ station: "doing", skippedAt: null });
  });

  it("skip and unskip of an unknown id throw NotFoundError", () => {
    expect(() => r.items.skip("it_missing")).toThrow(NotFoundError);
    expect(() => r.items.unskip("it_missing", { station: "inbox", waitOn: "you" })).toThrow(NotFoundError);
  });
});
