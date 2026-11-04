import { describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos } from "../repo";
import { emitWake, eventsAfter, pruneWakeEvents, waitForEvents } from "./wake";

const wake = (db: ReturnType<typeof openDb>, sessionId: string | null, entityId = "tk_1", now?: Date) =>
  emitWake(db, { sessionId, kind: "ticket.answered", entityType: "ticket", entityId }, now);

describe("wake long-poll", () => {
  it("resolves [] on timeout", async () => {
    const db = openDb(":memory:");
    const t = Date.now();
    expect(await waitForEvents(db, { sessionId: "lead", after: 0, timeoutMs: 50 })).toEqual([]);
    expect(Date.now() - t).toBeGreaterThanOrEqual(45);
  });

  it("resolves [] on abort, before the timeout", async () => {
    const db = openDb(":memory:");
    const ac = new AbortController();
    const p = waitForEvents(db, { sessionId: "lead", after: 0, timeoutMs: 10_000, signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    const t = Date.now();
    expect(await p).toEqual([]);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it("wakes immediately for targeted and broadcast events, not for other sessions", async () => {
    const db = openDb(":memory:");
    const p = waitForEvents(db, { sessionId: "lead", after: 0, timeoutMs: 2000 });
    wake(db, "someone-else");
    wake(db, "lead", "tk_2");
    const evs = await p;
    expect(evs.map((e) => e.entityId)).toEqual(["tk_2"]);
    wake(db, null, "tk_3");
    expect(eventsAfter(db, "lead", evs[0]!.id).map((e) => e.entityId)).toEqual(["tk_3"]);
  });

  it("returns events already waiting without blocking (at-least-once until acked)", async () => {
    const db = openDb(":memory:");
    const r = createRepos(db);
    r.sessions.touch({ id: "lead" });
    const e = wake(db, "lead");
    const cursor = r.sessions.touch({ id: "lead" }).cursor;
    expect(cursor).toBeLessThan(e.id);
    // Not acked: a second poll from the same cursor gets the same event again.
    expect((await waitForEvents(db, { sessionId: "lead", after: cursor, timeoutMs: 10 })).map((x) => x.id)).toEqual([e.id]);
    expect((await waitForEvents(db, { sessionId: "lead", after: cursor, timeoutMs: 10 })).map((x) => x.id)).toEqual([e.id]);
    // Acked: gone, and the cursor never moves backwards.
    expect(r.sessions.ack("lead", e.id).cursor).toBe(e.id);
    expect(r.sessions.ack("lead", 0).cursor).toBe(e.id);
    expect(await waitForEvents(db, { sessionId: "lead", after: e.id, timeoutMs: 10 })).toEqual([]);
  });
});

describe("pruneWakeEvents", () => {
  it("deletes events older than 7 days only", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-11-10T12:00:00Z");
    wake(db, "lead", "old", new Date("2026-11-03T11:59:00Z"));
    wake(db, "lead", "recent", new Date("2026-11-03T12:01:00Z"));
    expect(pruneWakeEvents(db, now)).toBe(1);
    expect(eventsAfter(db, "lead", 0).map((e) => e.entityId)).toEqual(["recent"]);
  });
});
