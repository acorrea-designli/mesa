import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate, openDb } from "./sqlite";

const MIGRATION = "1100_github_projects.sql";

/** A database migrated up to (not including) this migration, with source rows that must survive it. */
function legacyDb(file = ":memory:") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-mig-"));
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql") && n < MIGRATION)) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db, dir);
  const ts = "2026-11-13T10:00:00.000Z";
  db.prepare("INSERT INTO source_state (source, health, note, updated_at) VALUES ('github', 'degraded', 'límite de API · 11:05', ?)").run(ts);
  db.prepare("INSERT INTO source_state (source, health, updated_at) VALUES ('calendar', 'ok', ?)").run(ts);
  return db;
}

const setSource = (db: DatabaseSync, source: string) =>
  db.prepare("INSERT INTO source_state (source, health, note, updated_at) VALUES (?, 'degraded', 'x', 'x')").run(source);

const tables = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'gh_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

describe("1100_github_projects migration", () => {
  it("adds the cache tables and the github_projects health row without touching the existing source rows", () => {
    const db = legacyDb();
    expect(() => setSource(db, "github_projects")).toThrow(/CHECK/);
    expect(tables(db)).toEqual([]);
    expect(migrate(db)[0]).toBe(MIGRATION); // later migrations may follow

    expect(tables(db)).toEqual(["gh_board_items", "gh_boards", "gh_open_prs", "gh_repo_reads"]);
    setSource(db, "github_projects");
    expect(() => setSource(db, "nope")).toThrow(/CHECK/);
    const rows = db.prepare("SELECT source, health, note FROM source_state ORDER BY source").all().map((r) => ({ ...r }));
    expect(rows).toEqual([
      { source: "calendar", health: "ok", note: "" },
      { source: "github", health: "degraded", note: "límite de API · 11:05" },
      { source: "github_projects", health: "degraded", note: "x" },
    ]);

    db.prepare(
      "INSERT INTO gh_open_prs (repo, number, title, url, created_at, updated_at, seen_at) VALUES ('7-Arrow/dre-backend', 490, 't', 'u', 'c', 'u', 's')",
    ).run();
    expect(() =>
      db.prepare("INSERT INTO gh_open_prs (repo, number, title, url, created_at, updated_at, seen_at) VALUES ('7-Arrow/dre-backend', 490, 't', 'u', 'c', 'u', 's')").run(),
    ).toThrow(/UNIQUE/);
    const pr = db.prepare("SELECT draft, requested, closing_issues, mergeable, checks_state FROM gh_open_prs").get();
    expect({ ...pr }).toEqual({ draft: 0, requested: "[]", closing_issues: "[]", mergeable: null, checks_state: null });
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
    setSource(again, "github_projects");
    again.prepare("INSERT INTO gh_boards (project, owner, number, read_at) VALUES ('dre', '7-Arrow', 2, 'x')").run();
    expect((again.prepare("SELECT COUNT(*) AS n FROM gh_boards").get() as { n: number }).n).toBe(1);
    again.close();
  });

  it("a brand new database has the same schema, and migrating twice changes nothing", () => {
    const db = openDb(":memory:");
    setSource(db, "github_projects");
    setSource(db, "calendar");
    const sql = () => (db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'source_state'").all() as { sql: string }[]).map((r) => r.sql);
    const before = sql();
    expect(migrate(db)).toEqual([]);
    expect(sql()).toEqual(before);
    expect(before.join("\n").match(/'github_projects'/g)).toHaveLength(1);
  });
});
