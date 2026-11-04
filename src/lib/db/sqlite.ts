// SQLite through node:sqlite (Node >= 22.13, no native deps).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

export const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

export function defaultDbPath(): string {
  return process.env.MESA_DB ?? path.join(process.cwd(), "data", "mesa.db");
}

/** Open a database and apply pending migrations. Use ":memory:" in tests. */
export function openDb(file: string = defaultDbPath()): Db {
  if (file !== ":memory:") fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  if (file !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
  }
  migrate(db);
  return db;
}

export function migrate(db: Db, dir: string = MIGRATIONS_DIR): string[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const files = fs
    .readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(/*turbopackIgnore: true*/ `${dir}${path.sep}${f}`, "utf8");
    tx(db, () => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
        f,
        new Date().toISOString(),
      );
    });
    ran.push(f);
  }
  return ran;
}

/** Run fn inside a transaction. Nested calls join the outer transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const g = globalThis as unknown as { __mesaDb?: Db };

/** The app's shared connection (survives dev hot reloads). */
export function getDb(): Db {
  if (!g.__mesaDb) g.__mesaDb = openDb();
  return g.__mesaDb;
}
