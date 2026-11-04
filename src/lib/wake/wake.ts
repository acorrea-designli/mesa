// Wake events: how Mesa tells a Claude session that something it owns changed.
// Events are persisted (wake_events.id is the cursor) and pushed through an
// in-process emitter so long-polls return immediately.
import { EventEmitter } from "node:events";
import type { Db } from "../db/sqlite";
import { fromRow, fromRows, nowIso } from "../db/util";
import type { WakeEvent, WakeKind } from "../domain/types";

const g = globalThis as unknown as { __mesaBus?: EventEmitter };
function bus(): EventEmitter {
  if (!g.__mesaBus) {
    g.__mesaBus = new EventEmitter();
    g.__mesaBus.setMaxListeners(0);
  }
  return g.__mesaBus;
}

const SPEC = { json: ["payload"] };

export interface WakeInput {
  sessionId: string | null;
  kind: WakeKind;
  entityType: WakeEvent["entityType"];
  entityId: string;
  payload?: Record<string, unknown>;
}

export function emitWake(db: Db, e: WakeInput, now: Date = new Date()): WakeEvent {
  const row = db
    .prepare(
      `INSERT INTO wake_events (session_id, kind, entity_type, entity_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(e.sessionId, e.kind, e.entityType, e.entityId, JSON.stringify(e.payload ?? {}), nowIso(now));
  const ev = fromRow<WakeEvent>(row, SPEC);
  bus().emit("wake", ev);
  return ev;
}

/** Events for a session after a cursor: targeted at it, or broadcast (session_id NULL). */
export function eventsAfter(db: Db, sessionId: string, after: number, limit = 100): WakeEvent[] {
  return fromRows<WakeEvent>(
    db
      .prepare(
        `SELECT * FROM wake_events
         WHERE id > ? AND (session_id = ? OR session_id IS NULL)
         ORDER BY id LIMIT ?`,
      )
      .all(after, sessionId, limit),
    SPEC,
  );
}

export function latestCursor(db: Db): number {
  const r = db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM wake_events").get() as { id: number };
  return r.id;
}

export interface WaitOptions {
  sessionId: string;
  after: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * Resolve with the session's events after `after`, waiting up to timeoutMs for
 * the first one. Resolves [] on timeout or abort.
 */
export function waitForEvents(db: Db, o: WaitOptions): Promise<WakeEvent[]> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (evs: WakeEvent[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      bus().off("wake", onWake);
      o.signal?.removeEventListener("abort", onAbort);
      resolve(evs);
    };
    const onWake = (ev: WakeEvent) => {
      if (ev.id > o.after && (ev.sessionId === null || ev.sessionId === o.sessionId)) {
        finish(eventsAfter(db, o.sessionId, o.after));
      }
    };
    const onAbort = () => finish([]);
    // Subscribe before reading so an event emitted in between is not lost.
    bus().on("wake", onWake);
    o.signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => finish([]), o.timeoutMs);
    const existing = eventsAfter(db, o.sessionId, o.after);
    if (existing.length) finish(existing);
  });
}

/** Fire an in-process signal (no persistence), e.g. "approval:<id>" when it is decided. */
export function signal(key: string): void {
  bus().emit(`signal:${key}`);
}

/** Resolve true when `key` is signalled, false on timeout or abort. */
export function waitSignal(key: string, timeoutMs: number, abort?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const name = `signal:${key}`;
    const done = (v: boolean) => {
      clearTimeout(timer);
      bus().off(name, onSignal);
      abort?.removeEventListener("abort", onAbort);
      resolve(v);
    };
    const onSignal = () => done(true);
    const onAbort = () => done(false);
    bus().once(name, onSignal);
    abort?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => done(false), timeoutMs);
  });
}

/** Listen to every wake event as it is emitted (the live stream forwards them to the UI). */
export function onWake(fn: (e: WakeEvent) => void): () => void {
  bus().on("wake", fn);
  return () => void bus().off("wake", fn);
}

export const WAKE_RETENTION_DAYS = 7;

/**
 * Delete wake events older than the retention window. Delivery is at least once while
 * an event is retained; a session that has not acked in a week starts from what is left.
 */
export function pruneWakeEvents(db: Db, now: Date = new Date(), days = WAKE_RETENTION_DAYS): number {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  return Number(db.prepare("DELETE FROM wake_events WHERE created_at < ?").run(cutoff).changes);
}
