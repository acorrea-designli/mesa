// `pnpm sandbox:reset`: build data/sandbox.db, the dummy board the sandbox server runs on.
//
//   --from live (default)  a consistent snapshot of the live DB taken with VACUUM INTO over a
//                          read-only connection. WAL readers never block the live server's writes,
//                          and nothing is written to the live file, its -wal or its schema.
//   --from seed            the sample seed instead.
//
// Then the copy is scrubbed of everything that could cause an outward action or confuse a live
// session: session ownership and wake events are cleared, live agents retired, salidas waiting to go
// out return to pending (they can only be sent as simulated there), GitHub Project ids are dropped so
// nothing can sync, and a `sandbox.copy` settings row marks the database as a copy. docs/SANDBOX.md.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate, openDb, tx, type Db } from "../db/sqlite";
import { createRepos } from "../repo";
import { seedSamples } from "../seed/sample";
import { SANDBOX_COPY_KEY, type SandboxCopy, type SandboxFrom, type ScrubReport } from "./copy";

export { readSandboxCopy, SANDBOX_COPY_KEY, type SandboxCopy, type SandboxFrom, type ScrubReport } from "./copy";

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;
const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function removeDb(file: string) {
  for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) fs.rmSync(f, { force: true });
}

/** Refuse any target that is, or looks like, the live database. */
export function assertSafeTarget(target: string, source?: string) {
  if (source && same(source, target)) throw new Error(`refusing to write the sandbox over its source (${target})`);
  if (path.basename(target).toLowerCase() === "mesa.db") throw new Error(`refusing to write ${target}: mesa.db is the live board`);
}

/**
 * Consistent copy of `source` into `target`. The source is opened read-only and only read
 * (VACUUM INTO writes nothing but the new file); the copy lands under a temp name and is renamed.
 */
export function snapshotLive(source: string, target: string): void {
  assertSafeTarget(target, source);
  if (!fs.existsSync(source)) throw new Error(`live database not found: ${source}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  removeDb(tmp);
  // With the live server stopped there is no -wal/-shm, and a read-only WAL reader leaves empty
  // ones behind. Remove only the ones this copy created, only while the -wal is still empty; on
  // Windows a file another connection holds open cannot be unlinked, so a live server is safe.
  const sidecars = [`${source}-wal`, `${source}-shm`].filter((f) => !fs.existsSync(f));
  const src = new DatabaseSync(source, { readOnly: true });
  try {
    src.exec(`VACUUM INTO ${sqlStr(tmp)}`);
  } finally {
    src.close();
  }
  const wal = `${source}-wal`;
  if (sidecars.length === 2 && fs.existsSync(wal) && fs.statSync(wal).size === 0) {
    for (const f of sidecars) {
      try {
        fs.rmSync(f, { force: true });
      } catch {
        // in use: someone opened the live board meanwhile; leave it
      }
    }
  }
  removeDb(target);
  fs.renameSync(tmp, target);
}

const count = (db: Db, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const tables = (db: Db) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
const hasColumn = (db: Db, table: string, col: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);

/** Make a copied board safe to play with. Idempotent. */
export function scrubForSandbox(db: Db, now = new Date()): ScrubReport {
  const ts = now.toISOString();
  return tx(db, () => {
    const run = (sql: string, ...args: (string | null)[]) => Number(db.prepare(sql).run(...args).changes);
    const out: ScrubReport = {
      // Every pending wake belongs to a live session; the sandbox lead starts from the state.
      wakeEvents: run("DELETE FROM wake_events"),
      sessions: 0,
      agentsRetired: run("UPDATE ticket_team SET status = 'retired', retired_at = ? WHERE status = 'live'", ts),
      // Approved (in the undo window or released), scheduled or held salidas go back to Andrés.
      salidasToPending: run(
        `UPDATE salidas SET status = 'pending', approved_version = NULL, undo_until = NULL, released_at = NULL,
           send_at = NULL, error = NULL, updated_at = ?
         WHERE status IN ('sending', 'scheduled', 'queued_until_back')`,
        ts,
      ),
      // A pending permission card waits on a live agent's hook, which polls the live board.
      approvalsExpired: run("UPDATE approvals SET status = 'expired' WHERE status = 'pending'"),
      // No GitHub Project item ids: nothing can be pushed to, or matched against, the real Project.
      tasksUnlinked: run("UPDATE tasks SET gh_item_id = NULL, sync_state = 'local', sync_error = NULL, synced_at = NULL"),
      githubSettings: run("DELETE FROM settings WHERE key LIKE 'gh_project.%'"),
      samplesUnflagged: 0,
    };
    // Session ownership: owners become "any session", so the sandbox lead receives every wake.
    run("UPDATE tickets SET owner_session = NULL");
    run("UPDATE salidas SET owner_session = NULL");
    out.sessions = run("DELETE FROM sessions");
    // Reviews waiting on an approve salida that just went back to pending reopen on their next read.
    return out;
  });
}

/**
 * Sample rows ("Datos de muestra.") can never be sent or released. On the sandbox the whole board
 * is dummy data, so the seed's rows become ordinary rows and the full salida flow works on them. Calendar events are
 * the exception (t112): they are only ever read, never sent, and the sandbox never fetches the feed, so the seeded
 * ones stay "Datos de muestra." on Calendario.
 */
function unflagSamples(db: Db): number {
  let n = 0;
  for (const t of tables(db)) if (t !== "calendar_events" && hasColumn(db, t, "is_sample")) n += Number(db.prepare(`UPDATE ${t} SET is_sample = 0 WHERE is_sample = 1`).run().changes);
  return n;
}

export interface ResetOptions {
  from: SandboxFrom;
  /** The sandbox database (data/sandbox.db). */
  target: string;
  /** The live database for `from: "live"` (data/mesa.db). */
  source?: string;
  now?: Date;
}

export function resetSandbox(o: ResetOptions): SandboxCopy {
  const now = o.now ?? new Date();
  assertSafeTarget(o.target, o.source);
  if (o.from === "live") {
    if (!o.source) throw new Error("--from live needs the live database path");
    snapshotLive(o.source, o.target);
  } else {
    removeDb(o.target);
  }
  const db = openDb(o.target); // applies migrations the live copy may not have yet
  try {
    migrate(db);
    let samples = 0;
    if (o.from === "seed") {
      seedSamples(createRepos(db), now);
      samples = unflagSamples(db);
    }
    const scrubbed = { ...scrubForSandbox(db, now), samplesUnflagged: samples };
    const rows: Record<string, number> = {};
    for (const t of tables(db)) rows[t] = count(db, t);
    const copy: SandboxCopy = { from: o.from, source: o.from === "live" ? path.resolve(o.source!) : null, copiedAt: now.toISOString(), rows, scrubbed };
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SANDBOX_COPY_KEY, JSON.stringify(copy));
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return copy;
  } finally {
    db.close();
  }
}
