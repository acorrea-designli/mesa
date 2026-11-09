import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate, openDb } from "./sqlite";

const MIGRATION = "0900_slack_drafts.sql";

/** A database migrated up to (not including) the Slack-drafts migration, with one salida that has children. */
function legacyDb(file = ":memory:") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-"));
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql") && n < MIGRATION)) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db, dir);
  const ts = "2026-11-09T10:00:00.000Z";
  db.prepare(
    "INSERT INTO salidas (id, status, source, destination, current_version, created_at, updated_at) VALUES ('sa_1', 'sent', 'slack', '{}', 1, ?, ?)",
  ).run(ts, ts);
  db.prepare("INSERT INTO salida_versions (id, salida_id, n, body, author, created_at) VALUES ('sv_1', 'sa_1', 1, 'hola', 'claude', ?)").run(ts);
  db.prepare(
    "INSERT INTO salida_turns (id, salida_id, author, body, on_version, created_at) VALUES ('st_1', 'sa_1', 'andres', 'más corto', 1, ?)",
  ).run(ts);
  return db;
}

const insert = (db: DatabaseSync, id: string, status: string, mode: string | null = null) =>
  db
    .prepare("INSERT INTO salidas (id, status, source, destination, send_mode, created_at, updated_at) VALUES (?, ?, 'slack', '{}', ?, 'x', 'x')")
    .run(id, status, mode);

describe("0900_slack_drafts migration", () => {
  it("allows draft_created and a send mode without touching existing salidas or their children", () => {
    const db = legacyDb();
    expect(() =>
      db.prepare("INSERT INTO salidas (id, status, source, destination, created_at, updated_at) VALUES ('sa_0', 'draft_created', 'slack', '{}', 'x', 'x')").run(),
    ).toThrow(/CHECK/);
    expect(migrate(db)).toEqual([MIGRATION]);

    insert(db, "sa_2", "draft_created", "draft");
    insert(db, "sa_3", "sending", "send");
    expect(() => insert(db, "sa_4", "sent", "carrier-pigeon")).toThrow(/CHECK/);
    expect(() => insert(db, "sa_5", "published")).toThrow(/CHECK/);

    const old = db.prepare("SELECT status, send_mode AS sendMode, drafted_at AS draftedAt FROM salidas WHERE id = 'sa_1'").get();
    expect({ ...old }).toEqual({ status: "sent", sendMode: null, draftedAt: null });
    expect((db.prepare("SELECT COUNT(*) AS n FROM salida_versions WHERE salida_id = 'sa_1'").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM salida_turns WHERE salida_id = 'sa_1'").get() as { n: number }).n).toBe(1);
    expect(db.prepare("PRAGMA integrity_check").all().map((r) => ({ ...r }))).toEqual([{ integrity_check: "ok" }]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("is live in a fresh connection to the same file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-file-"));
    const file = path.join(dir, "mesa.db");
    legacyDb(file).close();
    openDb(file).close();
    const again = openDb(file);
    insert(again, "sa_9", "draft_created", "draft");
    expect((again.prepare("SELECT status FROM salidas WHERE id = 'sa_9'").get() as { status: string }).status).toBe("draft_created");
    again.close();
  });

  it("a brand new database has the same schema", () => {
    const db = openDb(":memory:");
    insert(db, "sa_1", "draft_created", "draft");
    expect(() => insert(db, "sa_2", "nope")).toThrow(/CHECK/);
  });
});
