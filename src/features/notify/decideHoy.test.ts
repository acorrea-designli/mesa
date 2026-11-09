import { describe, expect, it } from "vitest";
import { SEEN_TTL_MS, decide, itemWaiting, ticketWaiting, type Waiting } from "./decide";

const NOW = Date.UTC(2026, 10, 9, 15, 0, 0);

const ticket = (id: string) => ticketWaiting({ id, ref: `t${id}`, title: "¿Cuál opción?", isSample: false });
const hoyItem = (id: string, source: "github" | "slack" | "basecamp" = "github", over: Partial<{ title: string; isSample: boolean }> = {}) =>
  itemWaiting({ id, source, title: over.title ?? "PR de Matt: tarifa", isSample: over.isSample ?? false });
/** A seen set that already knows Hoy (a first read happened), holding `waiting` as seen. */
const hoyKnown = (waiting: Waiting[] = []) => decide({ seen: {}, waiting, now: NOW, baseline: true, hoy: true }).seen;

describe("Hoy items (t63)", () => {
  it("a new open item shows 'Nuevo en Hoy · <Source>' with its title and opens Hoy", () => {
    const d = decide({ seen: hoyKnown(), waiting: [hoyItem("i1", "github")], now: NOW + 1000, hoy: true });
    expect(d.show).toEqual([{ key: "item:i1", title: "Nuevo en Hoy · GitHub", body: "PR de Matt: tarifa", url: "/", hoy: true, source: "github" }]);
  });

  it("several in one scan are one banner with the count per source", () => {
    const waiting = [hoyItem("i1", "slack"), hoyItem("i2", "github"), hoyItem("i3", "slack")];
    const d = decide({ seen: hoyKnown(), waiting, now: NOW + 1000, hoy: true });
    expect(d.show).toEqual([{ key: "mesa-hoy", title: "3 nuevos en Hoy", body: "GitHub 1 · Slack 2", url: "/", hoy: true }]);
    expect(Object.keys(d.seen)).toEqual(expect.arrayContaining(["item:i1", "item:i2", "item:i3"]));
  });

  it("keeps the other entries of the scan apart from the Hoy one", () => {
    const d = decide({ seen: hoyKnown(), waiting: [ticket("1"), hoyItem("i1"), hoyItem("i2", "basecamp")], now: NOW + 1000, hoy: true });
    expect(d.show.map((s) => [s.key, s.hoy])).toEqual([
      ["ticket:1", undefined],
      ["mesa-hoy", true],
    ]);
  });

  it("the sandbox prefix applies to the batch too", () => {
    const d = decide({ seen: hoyKnown(), waiting: [hoyItem("i1"), hoyItem("i2")], now: NOW + 1000, hoy: true, sandbox: true });
    expect(d.show[0]?.title).toBe("[sandbox] 2 nuevos en Hoy");
  });

  it("a sweeper refresh of an item that stays open never notifies again", () => {
    const a = decide({ seen: hoyKnown(), waiting: [hoyItem("i1")], now: NOW + 1000, hoy: true });
    expect(a.show).toHaveLength(1);
    const b = decide({ seen: a.seen, waiting: [hoyItem("i1", "github", { title: "PR de Matt: tarifa (editado)" })], now: NOW + 5000, hoy: true });
    expect(b.show).toEqual([]);
  });

  it("an item that leaves (done or no longer waiting on him) and comes back notifies again", () => {
    const a = decide({ seen: hoyKnown(), waiting: [hoyItem("i1")], now: NOW + 1000, hoy: true });
    const left = decide({ seen: a.seen, waiting: [], now: NOW + 2000, hoy: true });
    expect(left.seen["item:i1"]).toBeUndefined();
    const back = decide({ seen: left.seen, waiting: [hoyItem("i1")], now: NOW + 3000, hoy: true });
    expect(back.show.map((s) => s.key)).toEqual(["item:i1"]);
  });

  it("samples never notify and are never remembered", () => {
    const d = decide({ seen: hoyKnown(), waiting: [hoyItem("i1", "github", { isSample: true })], now: NOW + 1000, hoy: true });
    expect(d.show).toEqual([]);
    expect(d.seen["item:i1"]).toBeUndefined();
  });

  it("the first read of Hoy items is a silent baseline: what is open today never notifies, the next arrival does", () => {
    const first = decide({ seen: {}, waiting: [hoyItem("i1"), hoyItem("i2")], now: NOW, hoy: true });
    expect(first.show).toEqual([]);
    expect(first.seen["hoy:ready"]).toBe(NOW);
    const next = decide({ seen: first.seen, waiting: [hoyItem("i1"), hoyItem("i2"), hoyItem("i3")], now: NOW + 1000, hoy: true });
    expect(next.show.map((s) => s.key)).toEqual(["item:i3"]);
  });

  it("an empty first read still marks Hoy as read, so the first item that arrives notifies", () => {
    const first = decide({ seen: {}, waiting: [], now: NOW, hoy: true });
    const next = decide({ seen: first.seen, waiting: [hoyItem("i1")], now: NOW + 1000, hoy: true });
    expect(next.show.map((s) => s.key)).toEqual(["item:i1"]);
  });

  it("the marker is kept fresh and never ages out while Hoy is read", () => {
    const old = decide({ seen: {}, waiting: [], now: NOW, hoy: true }).seen;
    const later = decide({ seen: old, waiting: [], now: NOW + SEEN_TTL_MS + 1000, hoy: true });
    expect(later.seen["hoy:ready"]).toBe(NOW + SEEN_TTL_MS + 1000);
  });

  it("baseline and quiet still hold: remembered, nothing shown", () => {
    const base = decide({ seen: hoyKnown(), waiting: [hoyItem("i1")], now: NOW + 1000, hoy: true, baseline: true });
    expect(base.show).toEqual([]);
    const quiet = decide({ seen: hoyKnown(), waiting: [hoyItem("i2")], now: NOW + 1000, hoy: true, quiet: true });
    expect(quiet.show).toEqual([]);
    expect(quiet.seen["item:i2"]).toBe(NOW + 1000);
  });

  it("without the hoy flag the marker is not written (existing callers are unchanged)", () => {
    expect(decide({ seen: {}, waiting: [ticket("1")], now: NOW, baseline: true }).seen).not.toHaveProperty("hoy:ready");
  });
});
