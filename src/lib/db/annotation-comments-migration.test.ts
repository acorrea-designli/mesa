// 1070_annotation_comments (t147): the kind and page CHECKs of annotations allow a pageless comment, and the
// annotations and replies that already exist survive (a table rebuild would cascade-delete the replies).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate } from "./sqlite";

const MIGRATION = "1070_annotation_comments.sql";
const TS = "2026-11-13T10:00:00.000Z";

/** A database migrated up to (not including) this migration, holding annotations that already have replies. */
function legacyDb(file = ":memory:") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-an-"));
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql") && n < MIGRATION)) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db, dir);
  db.prepare("INSERT INTO tickets (id, ref, direction, title, status, created_at, updated_at) VALUES ('tk_1', 't1', 'andres_asks', 'x', 'working', ?, ?)").run(TS, TS);
  db.prepare("INSERT INTO attachments (id, ticket_id, filename, mime, size, path, created_at) VALUES ('at_1', 'tk_1', 'a.pdf', 'application/pdf', 1, 'p', ?)").run(TS);
  const ann = db.prepare(
    "INSERT INTO annotations (id, ticket_id, attachment_id, page, kind, geometry, quote, body, author, state, sent_at, created_at, updated_at) VALUES (?, 'tk_1', 'at_1', ?, ?, ?, ?, ?, 'andres', ?, ?, ?, ?)",
  );
  ann.run("an_1", 1, "note", '{"x":1,"y":2}', "", "mira", "open", TS, TS, TS);
  ann.run("an_2", 3, "highlight", '{"rects":[{"x":1,"y":1,"w":9,"h":9}]}', "Costo", "¿IVA?", "resolved", null, TS, TS);
  const rep = db.prepare("INSERT INTO annotation_replies (id, annotation_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)");
  rep.run("ar_1", "an_1", "claude", "listo", TS);
  rep.run("ar_2", "an_1", "andres", "gracias", TS);
  rep.run("ar_3", "an_2", "claude", "sí incluye", TS);
  return db;
}

const insert = (db: DatabaseSync, id: string, page: number, kind: string, geometry = "{}") =>
  db.prepare("INSERT INTO annotations (id, ticket_id, attachment_id, page, kind, geometry, author, created_at, updated_at) VALUES (?, 'tk_1', 'at_1', ?, ?, ?, 'andres', ?, ?)").run(id, page, kind, geometry, TS, TS);
const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

function expectSurvived(db: DatabaseSync) {
  expect(db.prepare("SELECT id, page, kind, geometry, quote, body, state, sent_at AS sentAt FROM annotations ORDER BY id").all().map((r) => ({ ...r }))).toEqual([
    { id: "an_1", page: 1, kind: "note", geometry: '{"x":1,"y":2}', quote: "", body: "mira", state: "open", sentAt: TS },
    { id: "an_2", page: 3, kind: "highlight", geometry: '{"rects":[{"x":1,"y":1,"w":9,"h":9}]}', quote: "Costo", body: "¿IVA?", state: "resolved", sentAt: null },
  ]);
  expect(db.prepare("SELECT id, annotation_id AS a, body FROM annotation_replies ORDER BY id").all().map((r) => ({ ...r }))).toEqual([
    { id: "ar_1", a: "an_1", body: "listo" },
    { id: "ar_2", a: "an_1", body: "gracias" },
    { id: "ar_3", a: "an_2", body: "sí incluye" },
  ]);
}

describe("1070_annotation_comments migration", () => {
  it("allows a pageless comment, keeps every annotation and reply, and keeps the other CHECKs", () => {
    const db = legacyDb();
    expect(() => insert(db, "an_x", 0, "comment")).toThrow(/CHECK/);
    expect(migrate(db)[0]).toBe(MIGRATION); // later migrations may follow
    expectSurvived(db);

    insert(db, "an_3", 0, "comment"); // the whole document
    insert(db, "an_4", 2, "comment"); // a page
    insert(db, "an_5", 4, "rect", '{"x":1,"y":1,"w":2,"h":2}'); // the earlier kinds stay valid
    expect(() => insert(db, "an_6", -1, "comment")).toThrow(/CHECK/);
    expect(() => insert(db, "an_7", 1, "stamp")).toThrow(/CHECK/);
    expect(() => db.prepare("INSERT INTO annotation_replies (id, annotation_id, author, body, created_at) VALUES ('ar_9', 'an_3', 'bob', 'x', ?)").run(TS)).toThrow(/CHECK/);
    db.prepare("INSERT INTO annotation_replies (id, annotation_id, author, body, created_at) VALUES ('ar_4', 'an_3', 'claude', 'visto', ?)").run(TS);

    // Foreign keys are on: deleting an annotation still cascades to its own replies only.
    db.prepare("DELETE FROM annotations WHERE id = 'an_3'").run();
    expect(count(db, "annotation_replies")).toBe(3);
    expect(db.prepare("PRAGMA integrity_check").all().map((r) => ({ ...r }))).toEqual([{ integrity_check: "ok" }]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("rewrites the schema text once: the indexes stay and running it again changes nothing", () => {
    const db = legacyDb();
    migrate(db);
    const schema = () => (db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'annotations'").get() as { sql: string }).sql;
    const sql = schema();
    expect(sql).toContain("CHECK (page >= 0)");
    expect(sql).toContain("'ellipse','arrow','comment'");
    expect(sql).not.toContain("page >= 1");
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'annotations' AND sql IS NOT NULL ORDER BY name").all().map((r) => ({ ...r }))).toEqual([
      { name: "annotations_attachment" },
      { name: "annotations_ticket" },
    ]);
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), "utf8"));
    expect(schema()).toBe(sql);
  });

  it("survives on a file database that is closed and reopened", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-an-file-")), "mesa.db");
    legacyDb(file).close();
    const db = new DatabaseSync(file);
    db.exec("PRAGMA foreign_keys = ON;");
    migrate(db);
    db.close();
    const again = new DatabaseSync(file);
    again.exec("PRAGMA foreign_keys = ON;");
    expectSurvived(again);
    insert(again, "an_3", 0, "comment");
    expect(() => insert(again, "an_4", -1, "comment")).toThrow(/CHECK/);
    expect(again.prepare("PRAGMA integrity_check").all().map((r) => ({ ...r }))).toEqual([{ integrity_check: "ok" }]);
  });
});
