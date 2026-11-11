// Calendario (t112): the stored occurrences of Andrés's Google Calendar, read only. The poller replaces the non-sample
// rows with each read (one transaction); the seed owns the sample rows. Nothing here talks to Google.
import { createHash } from "node:crypto";
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { fromRow, fromRows, nowIso } from "../db/util";
import type { IcsOccurrence } from "../domain/ics";
import type { CalendarEvent } from "../domain/types";

const SPEC = { json: ["attendees"], bool: ["all_day", "recurring", "is_sample"] };

/** A stable id for one occurrence of a series, so a re-read keeps the id (and a reminder key) of a meeting that did not move. */
export const calendarEventId = (uid: string, occurrenceKey: string): string => `ce_${BigInt(`0x${createHash("sha1").update(`${uid}|${occurrenceKey}`).digest("hex").slice(0, 12)}`).toString(36).padStart(8, "0")}`;

export interface CalendarRange {
  from: Date;
  to: Date;
  includeSamples?: boolean;
}

export type SampleEvent = Omit<CalendarEvent, "id" | "isSample" | "fetchedAt" | "attendeesCount"> & { attendeesCount?: number };

export function calendarRepo(db: Db) {
  const insert = db.prepare(
    `INSERT INTO calendar_events (id, uid, occurrence_key, title, starts_at, ends_at, all_day, time_zone, location, meet_url, attendees, attendees_count, organizer, response, status, recurring, is_sample, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const put = (o: IcsOccurrence | (SampleEvent & { occurrenceKey: string }), sample: boolean, fetchedAt: string) => {
    const attendees = o.attendees;
    insert.run(
      calendarEventId(o.uid, o.occurrenceKey),
      o.uid,
      o.occurrenceKey,
      o.title,
      o.startsAt,
      o.endsAt,
      o.allDay ? 1 : 0,
      o.timeZone,
      o.location,
      o.meetUrl,
      JSON.stringify(attendees),
      attendees.length,
      o.organizer,
      o.response,
      o.status,
      o.recurring ? 1 : 0,
      sample ? 1 : 0,
      fetchedAt,
    );
  };

  return {
    /** Events that overlap [from, to), by start. Samples are included only when asked (the seeded board). */
    list(r: CalendarRange): CalendarEvent[] {
      const rows = db
        .prepare(`SELECT * FROM calendar_events WHERE starts_at < ? AND (ends_at > ? OR starts_at >= ?) ${r.includeSamples === false ? "AND is_sample = 0" : ""} ORDER BY starts_at, title`)
        .all(r.to.toISOString(), r.from.toISOString(), r.from.toISOString());
      return fromRows<CalendarEvent>(rows, SPEC);
    },

    get(id: string): CalendarEvent | null {
      const row = db.prepare("SELECT * FROM calendar_events WHERE id = ?").get(id);
      return row ? fromRow<CalendarEvent>(row, SPEC) : null;
    },

    count(): { real: number; samples: number } {
      const n = (sample: number) => (db.prepare("SELECT COUNT(*) AS n FROM calendar_events WHERE is_sample = ?").get(sample) as { n: number }).n;
      return { real: n(0), samples: n(1) };
    },

    /** One read of the feed: the non-sample rows become exactly these occurrences. */
    replace(occurrences: readonly IcsOccurrence[], now = new Date()): { inserted: number; removed: number } {
      return tx(db, () => {
        const removed = Number(db.prepare("DELETE FROM calendar_events WHERE is_sample = 0").run().changes);
        const fetchedAt = nowIso(now);
        const seen = new Set<string>();
        let inserted = 0;
        for (const o of occurrences) {
          const key = `${o.uid}|${o.occurrenceKey}`;
          if (seen.has(key)) continue; // a feed that repeats an occurrence
          seen.add(key);
          put(o, false, fetchedAt);
          inserted++;
        }
        return { inserted, removed };
      });
    },

    /** The seed: replace the sample rows (real rows are never touched). */
    replaceSamples(events: readonly (SampleEvent & { occurrenceKey: string })[], now = new Date()): number {
      return tx(db, () => {
        db.prepare("DELETE FROM calendar_events WHERE is_sample = 1").run();
        const fetchedAt = nowIso(now);
        for (const e of events) put(e, true, fetchedAt);
        return events.length;
      });
    },

    clearSamples(): number {
      return Number(db.prepare("DELETE FROM calendar_events WHERE is_sample = 1").run().changes);
    },
  };
}
