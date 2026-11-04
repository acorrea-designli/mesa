import type { Db } from "../db/sqlite";
import { fromRow, fromRows, NotFoundError, nowIso } from "../db/util";
import type { Session } from "../domain/types";

/** A session counts as listening if it is in a long-poll or polled recently. */
export const LISTENING_GRACE_MS = 90_000;

export interface SessionInput {
  id: string;
  label?: string;
  cwd?: string;
  project?: string;
}

export function sessionsRepo(db: Db) {
  const find = (id: string): Session | null => {
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    return row ? fromRow<Session>(row) : null;
  };

  return {
    find,

    get(id: string): Session {
      const s = find(id);
      if (!s) throw new NotFoundError("session", id);
      return s;
    },

    list(): Session[] {
      return fromRows<Session>(db.prepare("SELECT * FROM sessions ORDER BY last_seen_at DESC").all());
    },

    /** Register or heartbeat a session. New sessions start at the latest cursor. */
    touch(input: SessionInput, now = new Date()): Session {
      const ts = nowIso(now);
      db.prepare(
        `INSERT INTO sessions (id, label, cwd, project, cursor, last_seen_at, created_at)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(id), 0) FROM wake_events), ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = CASE WHEN excluded.label <> '' THEN excluded.label ELSE label END,
           cwd = CASE WHEN excluded.cwd <> '' THEN excluded.cwd ELSE cwd END,
           project = CASE WHEN excluded.project <> '' THEN excluded.project ELSE project END,
           last_seen_at = excluded.last_seen_at`,
      ).run(input.id, input.label ?? "", input.cwd ?? "", input.project ?? "", ts, ts);
      return this.get(input.id);
    },

    setWaiting(id: string, waiting: boolean, now = new Date()): void {
      db.prepare("UPDATE sessions SET waiting_since = ?, last_seen_at = ? WHERE id = ?").run(
        waiting ? nowIso(now) : null,
        nowIso(now),
        id,
      );
    },

    /** Acknowledge events up to cursor (never moves backwards). */
    ack(id: string, cursor: number): Session {
      db.prepare("UPDATE sessions SET cursor = MAX(cursor, ?) WHERE id = ?").run(cursor, id);
      return this.get(id);
    },

    isListening(s: Session, now = new Date()): boolean {
      if (s.waitingSince) return true;
      return now.getTime() - Date.parse(s.lastSeenAt) < LISTENING_GRACE_MS;
    },
  };
}

/** Register a session id if it is new (owner columns reference sessions). */
export function ensureSession(db: Db, id: string | null | undefined, now = new Date()): void {
  if (!id) return;
  db.prepare(
    `INSERT OR IGNORE INTO sessions (id, label, cwd, project, cursor, last_seen_at, created_at)
     VALUES (?, '', '', '', (SELECT COALESCE(MAX(id), 0) FROM wake_events), ?, ?)`,
  ).run(id, nowIso(now), nowIso(now));
}
