// SQLite through node:sqlite (Node >= 22.13, no native deps).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { syncMark } from "../integrations/sync-mark";

export type Db = DatabaseSync;

export const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

export function defaultDbPath(): string {
  return process.env.MESA_DB ?? path.join(process.cwd(), "data", "mesa.db");
}

/**
 * node:sqlite is synchronous: a statement that waits (a write lock held by another connection, up to busy_timeout, or an
 * fsync) holds the whole event loop. Every statement goes through syncMark, so one that took 250 ms or more is logged with
 * its SQL and the stall probe can name it while it is happening (t206).
 */
class MesaDatabase extends DatabaseSync {
  private countKey: string | null;
  constructor(file: string, countKey: string | null = null) {
    super(file);
    this.countKey = countKey;
  }
  /** Also gives the connection back to the per-file count, once, so close and reopen does not look like two writers. */
  override close(): void {
    try {
      super.close();
    } finally {
      const key = this.countKey;
      this.countKey = null;
      if (key !== null) releaseConnection(key);
    }
  }
  override exec(sql: string): void {
    return syncMark("sqlite", sql, () => super.exec(sql));
  }
  override prepare(sql: string): ReturnType<DatabaseSync["prepare"]> {
    const st = super.prepare(sql);
    const wrap = st as unknown as Record<"run" | "get" | "all", (...a: unknown[]) => unknown>;
    for (const m of ["run", "get", "all"] as const) {
      const orig = wrap[m].bind(st);
      wrap[m] = (...a: unknown[]) => syncMark("sqlite", sql, () => orig(...a));
    }
    return st;
  }
}

const gc = globalThis as unknown as { __mesaDbOpen?: Map<string, number> };

function releaseConnection(key: string): void {
  const open = gc.__mesaDbOpen;
  const n = (open?.get(key) ?? 0) - 1;
  if (n > 0) open?.set(key, n);
  else open?.delete(key);
}

/** Connections opened per file in this process. More than one means two writers contending for the file's lock. */
export const openConnections = (file: string): number => gc.__mesaDbOpen?.get(path.resolve(/*turbopackIgnore: true*/ file)) ?? 0;

/** Open a database and apply pending migrations. Use ":memory:" in tests. */
export function openDb(file: string = defaultDbPath()): Db {
  let key: string | null = null;
  if (file !== ":memory:") {
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
    const open = (gc.__mesaDbOpen ??= new Map<string, number>());
    key = path.resolve(/*turbopackIgnore: true*/ file);
    const n = (open.get(key) ?? 0) + 1;
    open.set(key, n);
    if (n > 1) console.warn(`[mesa] ${n} SQLite connections to ${file} in this process: writers wait on each other's lock (up to busy_timeout) with the event loop held`);
  }
  let db: MesaDatabase;
  try {
    db = new MesaDatabase(file, key);
  } catch (err) {
    if (key !== null) releaseConnection(key);
    throw err;
  }
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
