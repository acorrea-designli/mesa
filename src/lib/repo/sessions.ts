import type { Db } from "../db/sqlite";
import { fromRow, fromRows, NotFoundError, nowIso } from "../db/util";
import type { Session } from "../domain/types";
import { publishChange } from "../live/bus";

/** A session counts as listening if it is in a long-poll or polled recently. */
export const LISTENING_GRACE_MS = 90_000;

/** The session that runs the Slack/Basecamp sweep tick (scripts/sweep-tick.mjs). */
export const sweeperSession = () => process.env.MESA_SWEEPER_SESSION ?? "sweeper";

export interface SessionInput {
  id: string;
  label?: string;
  cwd?: string;
  project?: string;
}

/** A session counts as listening if it is in a long-poll or polled recently. */
export function isListening(s: Session, now = new Date()): boolean {
  if (s.waitingSince) return true;
  return now.getTime() - Date.parse(s.lastSeenAt) < LISTENING_GRACE_MS;
}

export function sessionsRepo(db: Db) {
  const all = () => fromRows<Session>(db.prepare("SELECT * FROM sessions").all());
  /** What the Fuentes rail shows of sessions: is any Claude session listening, and is the sweeper. */
  const railKey = (now: Date) => {
    const list = all();
    return `${list.some((s) => isListening(s, now))}|${list.some((s) => s.id === sweeperSession() && isListening(s, now))}`;
  };
  /** Run a write; when it flips what the rail shows, tell the open screens (no wake event). */
  const publishOnFlip = <T>(now: Date, write: () => T): T => {
    const before = railKey(now);
    const out = write();
    if (railKey(now) !== before) publishChange({ entityType: "source", entityId: "claude", kind: "health" });
    return out;
  };

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
      publishOnFlip(now, () =>
        db
          .prepare(
            `INSERT INTO sessions (id, label, cwd, project, cursor, last_seen_at, created_at)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(id), 0) FROM wake_events), ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = CASE WHEN excluded.label <> '' THEN excluded.label ELSE label END,
           cwd = CASE WHEN excluded.cwd <> '' THEN excluded.cwd ELSE cwd END,
           project = CASE WHEN excluded.project <> '' THEN excluded.project ELSE project END,
           last_seen_at = excluded.last_seen_at`,
          )
          .run(input.id, input.label ?? "", input.cwd ?? "", input.project ?? "", ts, ts),
      );
      return this.get(input.id);
    },

    setWaiting(id: string, waiting: boolean, now = new Date()): void {
      publishOnFlip(now, () =>
        db.prepare("UPDATE sessions SET waiting_since = ?, last_seen_at = ? WHERE id = ?").run(waiting ? nowIso(now) : null, nowIso(now), id),
      );
    },

    /** Acknowledge events up to cursor (never moves backwards). */
    ack(id: string, cursor: number): Session {
      db.prepare("UPDATE sessions SET cursor = MAX(cursor, ?) WHERE id = ?").run(cursor, id);
      return this.get(id);
    },

    isListening,
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
