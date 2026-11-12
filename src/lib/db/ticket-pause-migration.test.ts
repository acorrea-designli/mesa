import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate, openDb } from "./sqlite";

const MIGRATION = "1040_ticket_pause.sql";

/** A database migrated up to (not including) the pause migration, with a ticket that has children. */
function legacyDb(file = ":memory:") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-"));
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql") && n < MIGRATION)) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db, dir);
  const ts = "2026-11-12T10:00:00.000Z";
  db.prepare("INSERT INTO tickets (id, ref, direction, title, status, created_at, updated_at) VALUES ('tk_1', 't1', 'andres_asks', 'x', 'working', ?, ?)").run(ts, ts);
  db.prepare("INSERT INTO ticket_messages (id, ticket_id, author, body, created_at) VALUES ('tm_1', 'tk_1', 'andres', 'hola', ?)").run(ts);
  return db;
}

const insert = (db: DatabaseSync, id: string, status: string) =>
  db.prepare("INSERT INTO tickets (id, ref, direction, title, status, created_at, updated_at) VALUES (?, ?, 'andres_asks', 'x', ?, 'x', 'x')").run(id, `r_${id}`, status);

describe("1040_ticket_pause migration", () => {
  it("allows paused and ongoing tickets without touching existing tickets or their children", () => {
    const db = legacyDb();
    expect(() => insert(db, "tk_0", "paused")).toThrow(/CHECK/);
    expect(migrate(db)[0]).toBe(MIGRATION); // later migrations may follow

    insert(db, "tk_2", "paused");
    insert(db, "tk_3", "ongoing");
    insert(db, "tk_4", "waiting_andres"); // the earlier statuses stay valid
    expect(() => insert(db, "tk_5", "nope")).toThrow(/CHECK/);

    db.prepare("UPDATE tickets SET status = 'paused', pause_reason = 'espera t2', paused_until_ticket_id = 'tk_2', paused_at = 'x' WHERE id = 'tk_1'").run();
    const old = db.prepare("SELECT status, pause_reason AS r, paused_until_ticket_id AS u FROM tickets WHERE id = 'tk_1'").get();
    expect({ ...old }).toEqual({ status: "paused", r: "espera t2", u: "tk_2" });
    expect((db.prepare("SELECT COUNT(*) AS n FROM ticket_messages WHERE ticket_id = 'tk_1'").get() as { n: number }).n).toBe(1);

    // The dependency pointer is a soft link: deleting the ticket it names only clears it.
    db.prepare("DELETE FROM tickets WHERE id = 'tk_2'").run();
    expect((db.prepare("SELECT paused_until_ticket_id AS u FROM tickets WHERE id = 'tk_1'").get() as { u: string | null }).u).toBeNull();
    expect(db.prepare("PRAGMA integrity_check").all().map((r) => ({ ...r }))).toEqual([{ integrity_check: "ok" }]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("is live in a fresh connection to the same file (the sandbox reset opens a copied live DB like this)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-file-"));
    const file = path.join(dir, "mesa.db");
    legacyDb(file).close();
    const copy = path.join(dir, "sandbox.db");
    fs.copyFileSync(file, copy);
    openDb(copy).close();
    const again = openDb(copy);
    insert(again, "tk_9", "ongoing");
    expect((again.prepare("SELECT status FROM tickets WHERE id = 'tk_9'").get() as { status: string }).status).toBe("ongoing");
    again.close();
  });

  it("a brand new database has the same schema, and migrating twice changes nothing", () => {
    const db = openDb(":memory:");
    insert(db, "tk_1", "paused");
    expect(() => insert(db, "tk_2", "nope")).toThrow(/CHECK/);
    const sql = () => (db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'tickets'").all() as { sql: string }[]).map((r) => r.sql);
    const before = sql();
    expect(migrate(db)).toEqual([]);
    expect(sql()).toEqual(before);
    expect(before.join("\n").match(/'paused'/g)).toHaveLength(1);
  });
});
