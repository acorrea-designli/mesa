// Reminders (t191): `mesa remind <when> <text> [--ref tN]` and the record of a timed pause that ended. Stored in the
// database, so a restart loses nothing: whatever came due while the server was down fires on the first sweep after it.
// The sweep (repos().sweep, every second) calls fireDue; the push notifier turns a fired reminder into a push.
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { NotFoundError, TransitionError, ValidationError, fromRow, fromRows, newId, nowIso } from "../db/util";
import type { Reminder } from "../domain/types";
import { ticketsRepo } from "./tickets";

export const MAX_REMINDER_TEXT = 500;
/** A fired reminder is pushed for this long after it fires (a scan that happens to fail still catches it). */
export const FIRED_PUSH_WINDOW_MS = 24 * 3600_000;

export interface ReminderInput {
  text: string;
  /** ISO instant, in the future. */
  dueAt: string;
  /** A ticket ref ("t188") the reminder points at; 404 when it does not exist. */
  ticketRef?: string | null;
}

export interface Fired {
  /** Standalone reminders that came due. */
  notes: Reminder[];
  /** Timed pauses that ended (the ticket is back to Claude and its owner was woken). */
  resumed: Reminder[];
}

export function remindersRepo(db: Db) {
  const tickets = ticketsRepo(db);
  const get = (id: string): Reminder => {
    const row = db.prepare("SELECT * FROM reminders WHERE id = ?").get(id);
    if (!row) throw new NotFoundError("reminder", id);
    return fromRow<Reminder>(row);
  };

  return {
    get,

    /** A standalone reminder. 400 on empty or too long text, a date in the past, or an unknown ticket (404). */
    create(input: ReminderInput, now = new Date()): Reminder {
      const text = input.text.trim();
      if (!text) throw new ValidationError("a reminder needs a text");
      if (text.length > MAX_REMINDER_TEXT) throw new ValidationError(`a reminder text is at most ${MAX_REMINDER_TEXT} characters`);
      const due = Date.parse(input.dueAt);
      if (Number.isNaN(due)) throw new ValidationError("the reminder date is not a valid date");
      if (due <= now.getTime()) throw new ValidationError("the reminder date is already past");
      const ref = input.ticketRef ? tickets.get(input.ticketRef).ref : null;
      const id = newId("rm");
      db.prepare("INSERT INTO reminders (id, kind, text, due_at, ticket_ref, state, created_at) VALUES (?, 'note', ?, ?, ?, 'pending', ?)").run(id, text, new Date(due).toISOString(), ref, nowIso(now));
      return get(id);
    },

    /** Open ones by default (pending and fired, soonest first); `all` adds done and cancelled, newest first. */
    list(o: { all?: boolean } = {}): Reminder[] {
      const sql = o.all ? "SELECT * FROM reminders WHERE kind = 'note' ORDER BY due_at DESC, id" : "SELECT * FROM reminders WHERE kind = 'note' AND state IN ('pending', 'fired') ORDER BY due_at, id";
      return fromRows<Reminder>(db.prepare(sql).all());
    },

    /** A pending reminder will not fire. 409 once it fired, was done or cancelled. */
    cancel(id: string, now = new Date()): Reminder {
      const r = db.prepare("UPDATE reminders SET state = 'cancelled', closed_at = ? WHERE id = ? AND state = 'pending' AND kind = 'note'").run(nowIso(now), id);
      if (!r.changes) {
        const cur = get(id);
        throw new TransitionError(cur.kind === "note" ? `reminder is ${cur.state}; only a pending one can be cancelled` : "a timed pause is cancelled by resuming the ticket");
      }
      return get(id);
    },

    /** "Hecho": a fired reminder leaves Hoy. 409 unless it fired. */
    done(id: string, now = new Date()): Reminder {
      const r = db.prepare("UPDATE reminders SET state = 'done', closed_at = ? WHERE id = ? AND state = 'fired' AND kind = 'note'").run(nowIso(now), id);
      if (!r.changes) throw new TransitionError(`reminder is ${get(id).state}; only one that already fired can be marked done`);
      return get(id);
    },

    /**
     * Everything due at `now`: each pending reminder becomes fired, and each paused ticket whose date is reached goes back
     * to Claude (ticket.resumed by "date") with a `resume` record for the push. Idempotent: a second call finds nothing.
     */
    fireDue(now = new Date()): Fired {
      return tx(db, () => {
        const ts = nowIso(now);
        const notes = fromRows<Reminder>(db.prepare("UPDATE reminders SET state = 'fired', fired_at = ? WHERE state = 'pending' AND kind = 'note' AND due_at <= ? RETURNING *").all(ts, ts));
        const resumed: Reminder[] = [];
        for (const id of tickets.pausedDue(now)) {
          const until = tickets.get(id).pausedUntilAt; // resuming clears it
          const t = tickets.resumeByDate(id, now);
          if (!t || t.isSample) continue; // a sample ticket never pushes
          const rid = newId("rm");
          db.prepare("INSERT INTO reminders (id, kind, text, due_at, ticket_ref, state, created_at, fired_at) VALUES (?, 'resume', ?, ?, ?, 'fired', ?, ?)").run(rid, t.title, until ?? ts, t.ref, ts, ts);
          resumed.push(get(rid));
        }
        return { notes, resumed };
      });
    },

    /** What the push notifier should consider: fired within the window and not marked done. */
    recentlyFired(now = new Date()): Reminder[] {
      return fromRows<Reminder>(db.prepare("SELECT * FROM reminders WHERE state = 'fired' AND fired_at >= ? ORDER BY fired_at, id").all(nowIso(new Date(now.getTime() - FIRED_PUSH_WINDOW_MS))));
    },
  };
}
