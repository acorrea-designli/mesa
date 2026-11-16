import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markState, SLOW_SYNC_MS, syncMark } from "../integrations/sync-mark";
import { openConnections, openDb } from "./sqlite";

// t206: node:sqlite is synchronous, so a statement waiting on another connection's write lock holds the event loop for up
// to busy_timeout with the CPU idle. These tests reproduce that block and check that it is logged and that the app keeps
// one connection per process.
describe("SQLite blocking the loop", () => {
  let dir: string;
  let warn: { mock: { calls: unknown[][] }; mockRestore(): void };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-block-"));
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
    delete (globalThis as { __mesaDb?: unknown }).__mesaDb;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("a write behind another connection's lock blocks the thread until busy_timeout, and says so", () => {
    const file = path.join(dir, "a.db");
    const holder = openDb(file);
    const writer = openDb(file);
    expect(openConnections(file)).toBe(2);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("2 SQLite connections"))).toBe(true);

    holder.exec("BEGIN IMMEDIATE"); // a lock left open, as a transaction without COMMIT would
    writer.exec("PRAGMA busy_timeout = 400");
    const t0 = Date.now();
    expect(() => writer.exec("CREATE TABLE blocked (id INTEGER)")).toThrow(/locked|busy/i);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(SLOW_SYNC_MS); // nothing else ran on this thread meanwhile
    const slow = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("slow sync sqlite"));
    expect(slow).toMatch(/slow sync sqlite \d+ms: CREATE TABLE blocked/);

    holder.exec("ROLLBACK");
    holder.close();
    writer.close();
  });

  it("prepared statements are timed too", () => {
    const db = openDb(path.join(dir, "b.db"));
    const other = openDb(path.join(dir, "b.db"));
    db.exec("CREATE TABLE t (id INTEGER)");
    other.exec("BEGIN IMMEDIATE");
    db.exec("PRAGMA busy_timeout = 400");
    const ins = db.prepare("INSERT INTO t (id) VALUES (?)");
    expect(() => ins.run(1)).toThrow(/locked|busy/i);
    expect(warn.mock.calls.some((c) => /slow sync sqlite \d+ms: INSERT INTO t/.test(String(c[0])))).toBe(true);
    other.exec("ROLLBACK");
    db.close();
    other.close();
  });

  it("stays quiet for fast statements and for an in-memory database", () => {
    const db = openDb(":memory:");
    db.exec("CREATE TABLE q (id INTEGER)");
    db.prepare("INSERT INTO q (id) VALUES (?)").run(1);
    expect(db.prepare("SELECT id FROM q").all()).toEqual([{ id: 1 }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a call that throws before running (exec(undefined)) leaves no mark behind and later marks still work", () => {
    const db = openDb(":memory:");
    const m = markState();
    expect(m.depth).toBe(0);
    expect(() => db.exec(undefined as unknown as string)).toThrow(/string|argument/i);
    expect(() => (syncMark as (k: "sqlite", d: unknown, f: () => void) => void)("sqlite", undefined, () => undefined)).not.toThrow();
    expect(m.depth).toBe(0);
    expect(m.nums[0]).toBe(0);

    let seen = "";
    syncMark("sqlite", "\n  SELECT   1 \n\t FROM  t  \n", () => {
      expect(m.nums[0]).toBeGreaterThan(0); // the mark is live: depth did not stick, the outer call published
      seen = Buffer.from(m.detail.subarray(0, m.detail.indexOf(0))).toString("latin1");
    });
    expect(seen).toBe("SELECT 1 FROM t");
    expect(m.depth).toBe(0);
  });

  it("closing a connection frees its slot, so reopening the file does not warn", () => {
    const file = path.join(dir, "d.db");
    const a = openDb(file);
    expect(openConnections(file)).toBe(1);
    a.close();
    expect(openConnections(file)).toBe(0);
    const b = openDb(file);
    expect(openConnections(file)).toBe(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("SQLite connections"))).toBe(false);
    b.close();
    expect(() => b.close()).toThrow(); // already closed: node throws, and the count stays at zero
    expect(openConnections(file)).toBe(0);
  });

  it("route and instrumentation bundles share one connection through globalThis", async () => {
    const file = path.join(dir, "c.db");
    process.env.MESA_DB = file;
    try {
      const first = await import("./sqlite");
      const a = first.getDb();
      vi.resetModules();
      const second = await import("./sqlite"); // a second copy of the module, as a separate bundle would load
      expect(second.getDb()).toBe(a);
      expect(second.openConnections(file)).toBe(1);
      a.close();
    } finally {
      delete process.env.MESA_DB;
    }
  });
});
