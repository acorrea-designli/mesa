import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate } from "./sqlite";

const MIGRATION = "1180_attachment_relink.sql";

/** A database migrated up to (not including) this migration. */
function legacyDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-"));
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql") && n < MIGRATION)) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  }
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db, dir);
  return db;
}

let seq = 0;
const ticket = (db: DatabaseSync, id: string) => {
  seq += 1;
  db.prepare("INSERT OR IGNORE INTO sessions (id, last_seen_at, created_at) VALUES ('lead', 'x', 'x')").run();
  db.prepare(
    "INSERT INTO tickets (id, ref, direction, title, status, owner_session, created_at, updated_at) VALUES (?, ?, 'andres_asks', 't', 'waiting_claude', 'lead', 'x', 'x')",
  ).run(id, `t${900 + seq}`);
};
const att = (db: DatabaseSync, id: string, ticketId: string, filename: string, createdAt: string, mime = "application/pdf", versionOf: string | null = null, version = 1) =>
  db
    .prepare("INSERT INTO attachments (id, ticket_id, filename, mime, size, path, created_at, version_of, version) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)")
    .run(id, ticketId, filename, mime, `${ticketId}/${id}`, createdAt, versionOf, version);
const rows = (db: DatabaseSync, ticketId: string) =>
  db
    .prepare("SELECT id, version_of AS versionOf, version FROM attachments WHERE ticket_id = ? ORDER BY created_at, rowid")
    .all(ticketId)
    .map((r) => ({ ...r }));

describe("1180_attachment_relink migration", () => {
  it("links same-filename PDF roots of a ticket into one chain ordered by created_at, keeping ids and marks", () => {
    const db = legacyDb();
    ticket(db, "tk_a");
    // inserted out of order on purpose: the order is created_at, not insertion
    att(db, "at_3", "tk_a", "report.pdf", "2026-11-16T10:03:00.000Z");
    att(db, "at_1", "tk_a", "report.pdf", "2026-11-16T10:01:00.000Z");
    att(db, "at_2", "tk_a", "report.pdf", "2026-11-16T10:02:00.000Z");
    db.prepare(
      "INSERT INTO annotations (id, ticket_id, attachment_id, page, kind, geometry, body, author, created_at, updated_at) VALUES ('an_1', 'tk_a', 'at_2', 1, 'note', '{}', 'n', 'andres', 'x', 'x')",
    ).run();
    expect(migrate(db)[0]).toBe(MIGRATION);
    expect(rows(db, "tk_a")).toEqual([
      { id: "at_1", versionOf: null, version: 1 },
      { id: "at_2", versionOf: "at_1", version: 2 },
      { id: "at_3", versionOf: "at_1", version: 3 },
    ]);
    expect((db.prepare("SELECT attachment_id AS a FROM annotations WHERE id = 'an_1'").get() as { a: string }).a).toBe("at_2");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("leaves other filenames, other tickets, non-PDFs and single documents alone", () => {
    const db = legacyDb();
    ticket(db, "tk_a");
    ticket(db, "tk_b");
    att(db, "at_1", "tk_a", "a.pdf", "2026-11-16T10:01:00.000Z");
    att(db, "at_2", "tk_a", "b.pdf", "2026-11-16T10:02:00.000Z");
    att(db, "at_3", "tk_a", "a.png", "2026-11-16T10:03:00.000Z", "image/png");
    att(db, "at_4", "tk_a", "a.png", "2026-11-16T10:04:00.000Z", "image/png");
    att(db, "at_5", "tk_b", "a.pdf", "2026-11-16T10:05:00.000Z");
    migrate(db);
    expect(rows(db, "tk_a").map((r) => [r.versionOf, r.version])).toEqual([[null, 1], [null, 1], [null, 1], [null, 1]]);
    expect(rows(db, "tk_b")).toEqual([{ id: "at_5", versionOf: null, version: 1 }]);
  });

  it("keeps an existing chain and appends the stray same-filename root after it", () => {
    const db = legacyDb();
    ticket(db, "tk_a");
    att(db, "at_1", "tk_a", "r.pdf", "2026-11-16T10:01:00.000Z");
    att(db, "at_2", "tk_a", "r2.pdf", "2026-11-16T10:02:00.000Z", "application/pdf", "at_1", 2);
    att(db, "at_3", "tk_a", "r.pdf", "2026-11-16T10:03:00.000Z");
    migrate(db);
    expect(rows(db, "tk_a")).toEqual([
      { id: "at_1", versionOf: null, version: 1 },
      { id: "at_2", versionOf: "at_1", version: 2 },
      { id: "at_3", versionOf: "at_1", version: 3 },
    ]);
  });

  it("is idempotent: running its SQL again changes nothing", () => {
    const db = legacyDb();
    ticket(db, "tk_a");
    for (let i = 1; i <= 4; i++) att(db, `at_${i}`, "tk_a", "r.pdf", `2026-11-16T10:0${i}:00.000Z`);
    migrate(db);
    const first = rows(db, "tk_a");
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), "utf8"));
    expect(rows(db, "tk_a")).toEqual(first);
    expect(first.map((r) => r.version)).toEqual([1, 2, 3, 4]);
    expect(migrate(db)).toEqual([]);
  });
});
