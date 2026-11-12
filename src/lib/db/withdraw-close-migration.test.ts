import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate, openDb } from "./sqlite";

const MIGRATION = "1010_withdraw_close.sql";

/** A database migrated up to (not including) the withdraw/close migration, with a salida and a review that have children. */
function legacyDb(file = ":memory:") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-"));
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql") && n < MIGRATION)) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db, dir);
  const ts = "2026-11-09T10:00:00.000Z";
  db.prepare("INSERT INTO salidas (id, status, source, destination, current_version, created_at, updated_at) VALUES ('sa_1', 'draft_created', 'slack', '{}', 1, ?, ?)").run(ts, ts);
  db.prepare("INSERT INTO salida_versions (id, salida_id, n, body, author, created_at) VALUES ('sv_1', 'sa_1', 1, 'hola', 'claude', ?)").run(ts);
  db.prepare("INSERT INTO salida_turns (id, salida_id, author, body, on_version, created_at) VALUES ('st_1', 'sa_1', 'andres', 'más corto', 1, ?)").run(ts);
  db.prepare("INSERT INTO salidas (id, status, source, destination, current_version, created_at, updated_at) VALUES ('sa_2', 'pending', 'calendar', '{}', 1, ?, ?)").run(ts, ts);
  db.prepare("INSERT INTO reviews (id, repo, pr, state, salida_id, created_at, updated_at) VALUES ('rv_1', 'a/b', 1, 'approving', 'sa_1', ?, ?)").run(ts, ts);
  db.prepare("INSERT INTO review_findings (id, review_id, n, label, summary, salida_id, created_at, updated_at) VALUES ('fd_1', 'rv_1', 1, 'nit', 's', 'sa_1', ?, ?)").run(ts, ts);
  return db;
}

const insertSalida = (db: DatabaseSync, id: string, status: string, source = "slack") =>
  db.prepare("INSERT INTO salidas (id, status, source, destination, created_at, updated_at) VALUES (?, ?, ?, '{}', 'x', 'x')").run(id, status, source);
const insertReview = (db: DatabaseSync, id: string, pr: number, state: string) =>
  db.prepare("INSERT INTO reviews (id, repo, pr, state, created_at, updated_at) VALUES (?, 'a/b', ?, ?, 'x', 'x')").run(id, pr, state);

describe("1010_withdraw_close migration", () => {
  it("allows withdrawn salidas and closed reviews without touching existing rows or their children", () => {
    const db = legacyDb();
    expect(() => insertSalida(db, "sa_0", "withdrawn")).toThrow(/CHECK/);
    expect(() => insertReview(db, "rv_0", 2, "closed")).toThrow(/CHECK/);
    expect(migrate(db)[0]).toBe(MIGRATION); // later migrations may follow

    insertSalida(db, "sa_3", "withdrawn");
    insertSalida(db, "sa_4", "draft_created"); // the earlier statuses and the calendar source stay valid
    insertSalida(db, "sa_5", "pending", "calendar");
    expect(() => insertSalida(db, "sa_6", "published")).toThrow(/CHECK/);
    insertReview(db, "rv_2", 2, "closed");
    insertReview(db, "rv_3", 3, "approved");
    expect(() => insertReview(db, "rv_4", 4, "nope")).toThrow(/CHECK/);

    db.prepare("UPDATE salidas SET status = 'withdrawn', withdraw_reason = 'stale', withdrawn_at = 'x' WHERE id = 'sa_2'").run();
    db.prepare("UPDATE reviews SET state = 'closed', close_reason = 'stale', closed_at = 'x' WHERE id = 'rv_1'").run();

    const old = db.prepare("SELECT status, withdraw_reason AS r FROM salidas WHERE id = 'sa_1'").get();
    expect({ ...old }).toEqual({ status: "draft_created", r: null });
    expect((db.prepare("SELECT COUNT(*) AS n FROM salida_versions WHERE salida_id = 'sa_1'").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM salida_turns WHERE salida_id = 'sa_1'").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM review_findings WHERE review_id = 'rv_1'").get() as { n: number }).n).toBe(1);
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
    insertSalida(again, "sa_9", "withdrawn");
    insertReview(again, "rv_9", 9, "closed");
    expect((again.prepare("SELECT status FROM salidas WHERE id = 'sa_9'").get() as { status: string }).status).toBe("withdrawn");
    expect((again.prepare("SELECT state FROM reviews WHERE id = 'rv_9'").get() as { state: string }).state).toBe("closed");
    again.close();
  });

  it("a brand new database has the same schema, and migrating twice changes nothing", () => {
    const db = openDb(":memory:");
    insertSalida(db, "sa_1", "withdrawn");
    insertReview(db, "rv_1", 1, "closed");
    expect(() => insertSalida(db, "sa_2", "nope")).toThrow(/CHECK/);
    expect(() => insertReview(db, "rv_2", 2, "nope")).toThrow(/CHECK/);
    const sql = () => (db.prepare("SELECT sql FROM sqlite_schema WHERE name IN ('salidas', 'reviews') ORDER BY name").all() as { sql: string }[]).map((r) => r.sql);
    const before = sql();
    expect(migrate(db)).toEqual([]);
    expect(sql()).toEqual(before);
    expect(before.join("\n").match(/'withdrawn'/g)).toHaveLength(1);
    expect(before.join("\n").match(/'closed'/g)).toHaveLength(1);
  });
});
