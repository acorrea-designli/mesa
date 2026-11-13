// 1110_action_skipped (t169): the state CHECK of planned_actions allows `skipped`, the steps that already exist survive
// and the other states keep their CHECK.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate } from "./sqlite";

const MIGRATION = "1110_action_skipped.sql";
const TS = "2026-11-13T10:00:00.000Z";

/** A database migrated up to (not including) this migration, holding a ticket with steps in several states. */
function legacyDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-skip-"));
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql") && n < MIGRATION)) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db, dir);
  db.prepare("INSERT INTO tickets (id, ref, direction, title, status, created_at, updated_at) VALUES ('tk_1', 't1', 'andres_asks', 'x', 'working', ?, ?)").run(TS, TS);
  const step = db.prepare("INSERT INTO planned_actions (id, ticket_id, seq, kind, source, label, mode, state, created_at, updated_at) VALUES (?, 'tk_1', ?, 'other', 'claude', ?, 'direct', ?, ?, ?)");
  step.run("pa_1", 1, "uno", "done", TS, TS);
  step.run("pa_2", 2, "dos", "planned", TS, TS);
  return db;
}

const insert = (db: DatabaseSync, id: string, state: string) =>
  db.prepare("INSERT INTO planned_actions (id, ticket_id, seq, kind, source, label, mode, state, created_at, updated_at) VALUES (?, 'tk_1', 9, 'other', 'claude', 'x', 'direct', ?, ?, ?)").run(id, state, TS, TS);

describe("1110_action_skipped migration", () => {
  it("allows skipped, keeps the existing steps and the other CHECKs", () => {
    const db = legacyDb();
    expect(() => insert(db, "pa_x", "skipped")).toThrow(/CHECK/);
    expect(migrate(db)[0]).toBe(MIGRATION);
    expect(db.prepare("SELECT id, state FROM planned_actions ORDER BY seq").all().map((r) => ({ ...r }))).toEqual([
      { id: "pa_1", state: "done" },
      { id: "pa_2", state: "planned" },
    ]);
    insert(db, "pa_3", "skipped");
    expect(() => insert(db, "pa_4", "bogus")).toThrow(/CHECK/);
    expect(db.prepare("PRAGMA integrity_check").all().map((r) => ({ ...r }))).toEqual([{ integrity_check: "ok" }]);
  });

  it("rewrites the schema text once", () => {
    const db = legacyDb();
    migrate(db);
    const schema = () => (db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'planned_actions'").get() as { sql: string }).sql;
    const sql = schema();
    expect(sql).toContain("'done','failed','skipped'");
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), "utf8"));
    expect(schema()).toBe(sql);
  });
});
