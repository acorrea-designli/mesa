import { describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos } from "../repo";
import { eventsAfter } from "../wake/wake";
import { seedSamples } from "./sample";

const T0 = new Date("2026-11-03T15:00:00Z");

describe("samples can never be sent", () => {
  it("refuses sent, failed and hold on a sample salida, emits no wake, and the sweeper leaves it alone", () => {
    const db = openDb(":memory:");
    const r = createRepos(db);
    seedSamples(r, T0);
    const sending = r.salidas.list({ status: ["sending"] }).filter((s) => s.isSample);
    expect(sending.length).toBeGreaterThan(0);
    const s = sending[0]!;
    for (const ev of [{ type: "sent" as const }, { type: "failed" as const, error: "x" }, { type: "hold" as const, reason: "x" }]) {
      expect(() => r.salidas.transition(s.id, ev, T0)).toThrow(/sample data/);
    }
    // Hours later the sweeper still has not released any sample, and nobody was woken.
    r.sweep(new Date(T0.getTime() + 3 * 3600_000));
    expect(r.salidas.get(s.id).status).toBe(s.status);
    expect(r.salidas.get(s.id).releasedAt).toBe(s.releasedAt);
    expect(eventsAfter(db, "lead", 0)).toEqual([]);
    expect(eventsAfter(db, "mesa-sample", 0)).toEqual([]);
  });

  it("maps isSample as a boolean on approvals and chips", () => {
    const r = createRepos(openDb(":memory:"));
    seedSamples(r, T0);
    const a = r.approvals.list({}, T0);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((x) => x.isSample === true)).toBe(true);
    expect(r.chips.top().every((c) => c.isSample === true)).toBe(true);
  });
});
