import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/sqlite";
import { createRepos } from "@/lib/repo";
import { loadCalendar, parseCalendarQuery } from "./read";

const NOW = new Date("2026-11-12T17:00:00Z");

describe("loadCalendar (t127)", () => {
  it("opens the week a direct link names", () => {
    expect(parseCalendarQuery({ dia: "2026-10-05", vista: "semana" }, NOW)).toEqual({ day: "2026-10-05", view: "semana" });
    expect(parseCalendarQuery({ dia: "nope" }, NOW)).toEqual({ day: "2026-11-12", view: "hoy" });
  });

  it("reads Monday to Monday of the week asked, and knows whether anything is stored at all", () => {
    const r = createRepos(openDb(":memory:"));
    expect(loadCalendar(r, { day: "2026-10-05", view: "semana" }, NOW).hasStored).toBe(false);
    r.calendar.replace(
      [
        { uid: "a", occurrenceKey: "2026-10-06T15:00:00.000Z", title: "Pasada", startsAt: "2026-10-06T15:00:00.000Z", endsAt: "2026-10-06T15:30:00.000Z", allDay: false, timeZone: null, location: null, meetUrl: null, attendees: [], organizer: null, response: "accepted", status: "confirmed", recurring: false },
      ],
      NOW,
    );
    const past = loadCalendar(r, { day: "2026-10-05", view: "semana" }, NOW);
    expect(past.payload.events.map((e) => e.title)).toEqual(["Pasada"]);
    expect(past.hasStored).toBe(true);
    // an empty week is still a connected calendar
    const empty = loadCalendar(r, { day: "2026-03-02", view: "semana" }, NOW);
    expect(empty.payload.events).toEqual([]);
    expect(empty.hasStored).toBe(true);
  });
});
