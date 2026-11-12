// 1020_ticket_checklists (t124): the steps table, its checks and its cascade.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate, openDb } from "./sqlite";

const MIGRATION = "1020_ticket_checklists.sql";

function seed(db: DatabaseSync) {
  db.prepare("INSERT INTO tickets (id, ref, direction, title, status, created_at, updated_at) VALUES ('tk_1', 't1', 'claude_asks', 'x', 'waiting_andres', 'x', 'x')").run();
  db.prepare("INSERT INTO ticket_messages (id, ticket_id, author, body, created_at) VALUES ('tm_1', 'tk_1', 'claude', 'pasos', 'x')").run();
}
const step = (db: DatabaseSync, id: string, n: number, o: { state?: string; by?: string | null; at?: string | null } = {}) =>
  db
    .prepare("INSERT INTO ticket_steps (id, ticket_id, message_id, n, text, state, done_by, done_at, created_at) VALUES (?, 'tk_1', 'tm_1', ?, 'paso', ?, ?, ?, 'x')")
    .run(id, n, o.state ?? "open", o.by ?? null, o.at ?? null);

describe("1020_ticket_checklists migration", () => {
  it("applies on top of a database that has every earlier migration", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-ck-"));
    for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql") && n < MIGRATION)) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    migrate(db, dir);
    expect(() => db.prepare("SELECT * FROM ticket_steps").all()).toThrow(/no such table/);
    expect(migrate(db)[0]).toBe(MIGRATION); // later migrations may follow
    expect(db.prepare("SELECT * FROM ticket_steps").all()).toEqual([]);
  });

  it("keeps a step in one state with its owner and time, one row per (message, n)", () => {
    const db = openDb(":memory:");
    seed(db);
    step(db, "ck_1", 1);
    step(db, "ck_2", 2, { state: "done", by: "claude", at: "t" });
    step(db, "ck_3", 3, { state: "done", by: "andres", at: "t" });
    expect(() => step(db, "ck_4", 1)).toThrow(/UNIQUE/);
    expect(() => step(db, "ck_5", 4, { state: "done" })).toThrow(/CHECK/); // done without who and when
    expect(() => step(db, "ck_6", 4, { state: "open", by: "andres", at: "t" })).toThrow(/CHECK/); // open with a tick
    expect(() => step(db, "ck_7", 4, { state: "done", by: "bob", at: "t" })).toThrow(/CHECK/);
    expect(() => step(db, "ck_8", 4, { state: "maybe" })).toThrow(/CHECK/);
  });

  it("goes away with its message and with its ticket", () => {
    const db = openDb(":memory:");
    seed(db);
    step(db, "ck_1", 1);
    db.prepare("DELETE FROM ticket_messages WHERE id = 'tm_1'").run();
    expect((db.prepare("SELECT COUNT(*) AS n FROM ticket_steps").get() as { n: number }).n).toBe(0);
    db.prepare("INSERT INTO ticket_messages (id, ticket_id, author, body, created_at) VALUES ('tm_2', 'tk_1', 'claude', 'otra', 'x')").run();
    db.prepare("INSERT INTO ticket_steps (id, ticket_id, message_id, n, text, created_at) VALUES ('ck_9', 'tk_1', 'tm_2', 1, 'paso', 'x')").run();
    db.prepare("DELETE FROM tickets WHERE id = 'tk_1'").run();
    expect((db.prepare("SELECT COUNT(*) AS n FROM ticket_steps").get() as { n: number }).n).toBe(0);
  });
});
