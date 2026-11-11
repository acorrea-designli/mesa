import { describe, expect, it } from "vitest";
import { conflictsWith, dayLabel, eventsOn, freeSlots, isMeeting, knownPeople, meetingKey, meetingsLeft, nextMeeting, remindersDue, shortDay, weekDays, whenLabel } from "./calendar";
import type { CalendarEvent } from "./types";

let n = 0;
const ev = (start: string, end: string, o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `ce_${++n}`,
  uid: `u${n}`,
  title: `Reunión ${n}`,
  startsAt: new Date(start).toISOString(),
  endsAt: new Date(end).toISOString(),
  allDay: false,
  timeZone: "America/Bogota",
  location: null,
  meetUrl: null,
  attendees: [],
  attendeesCount: 0,
  organizer: null,
  response: "accepted",
  status: "confirmed",
  recurring: false,
  isSample: false,
  fetchedAt: "2026-11-11T19:00:00.000Z",
  ...o,
});
// 2026-11-11 (Wednesday), Bogota = UTC-5
const at = (hm: string, day = "2026-11-11") => `${day}T${hm}:00-05:00`;
const NOW = new Date(at("14:42"));

describe("nextMeeting", () => {
  const standup = ev(at("09:00"), at("09:15"));
  const declined = ev(at("14:50"), at("15:20"), { response: "declined" });
  const allDay = ev(at("00:00"), at("00:00", "2026-11-12"), { allDay: true });
  const onboarding = ev(at("15:00"), at("15:30"), { title: "Onboarding" });
  const laura = ev(at("16:30"), at("17:00"));
  const events = [laura, declined, allDay, standup, onboarding];

  it("skips what is over, declined and all-day", () => {
    expect(nextMeeting(events, NOW)?.title).toBe("Onboarding");
    expect(nextMeeting([declined, allDay, standup], NOW)).toBeNull();
  });
  it("prefers the meeting in progress", () => {
    expect(nextMeeting(events, new Date(at("15:10")))?.title).toBe("Onboarding");
    expect(nextMeeting(events, new Date(at("15:31")))?.id).toBe(laura.id);
  });
  it("counts the meetings left today", () => {
    expect(meetingsLeft(events, NOW)).toBe(2);
    expect(isMeeting(declined)).toBe(false);
  });
});

describe("remindersDue", () => {
  const m = ev(at("15:00"), at("15:30"));
  it("fires from 10 minutes before until the start, once per start", () => {
    expect(remindersDue([m], new Date(at("14:49")))).toHaveLength(0);
    expect(remindersDue([m], new Date(at("14:50")))).toHaveLength(1);
    expect(remindersDue([m], new Date(at("14:59")))).toHaveLength(1);
    expect(remindersDue([m], new Date(at("15:00")))).toHaveLength(0);
  });
  it("never reminds a declined meeting or an all-day event", () => {
    const d = ev(at("15:00"), at("15:30"), { response: "declined" });
    const a = ev(at("15:00"), at("15:30"), { allDay: true });
    expect(remindersDue([d, a], new Date(at("14:55")))).toHaveLength(0);
  });
  it("gives a moved meeting a new key", () => {
    const moved = { ...m, startsAt: new Date(at("16:00")).toISOString() };
    expect(meetingKey(m)).not.toBe(meetingKey(moved));
    expect(meetingKey(m)).toBe(`meeting:${m.id}:${m.startsAt}`);
  });
});

describe("labels", () => {
  it("says when", () => {
    const e = ev(at("15:00"), at("15:30"));
    expect(whenLabel(e, NOW)).toBe("en 18 min");
    expect(whenLabel(e, new Date(at("13:55")))).toBe("en 1 h 05 min");
    expect(whenLabel(e, new Date(at("13:00")))).toBe("en 2 h");
    expect(whenLabel(e, new Date(at("15:10")))).toBe("termina 15:30");
  });
  it("names days in Spanish", () => {
    expect(dayLabel("2026-11-12")).toMatch(/jueves 12 nov/);
    expect(shortDay("2026-11-11")).toMatch(/^Mi/);
  });
});

describe("days and weeks", () => {
  const sat = ev(at("10:00", "2026-11-14"), at("11:00", "2026-11-14"));
  it("lists Monday to Friday, and the weekend only when it holds a meeting", () => {
    expect(weekDays("2026-11-11")).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(weekDays("2026-11-11", [sat])).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]);
  });
  it("lists a day's events, all-day first, and does not leak the next day", () => {
    const allDay = ev(at("00:00"), at("00:00", "2026-11-12"), { allDay: true, title: "Cumple" });
    const late = ev(at("17:30"), at("18:00"));
    const early = ev(at("09:00"), at("09:15"));
    const tomorrow = ev(at("09:00", "2026-11-12"), at("09:15", "2026-11-12"));
    expect(eventsOn([late, tomorrow, early, allDay], "2026-11-11").map((e) => e.title)).toEqual(["Cumple", early.title, late.title]);
  });
});

describe("free slots", () => {
  const events = [ev(at("09:00"), at("09:15")), ev(at("11:00"), at("11:45")), ev(at("14:00"), at("15:00")), ev(at("17:30"), at("18:00"), { response: "declined" })];
  const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" });
  const show = (s: { start: string; end: string }[]) => s.map((x) => `${hm(x.start)}-${hm(x.end)}`);
  it("returns the gaps inside working hours", () => {
    expect(show(freeSlots(events, "2026-11-11"))).toEqual(["08:00-09:00", "09:15-11:00", "11:45-14:00", "15:00-19:00"]);
  });
  it("drops short gaps and respects notBefore and minMinutes", () => {
    expect(show(freeSlots(events, "2026-11-11", { minMinutes: 120 }))).toEqual(["11:45-14:00", "15:00-19:00"]);
    expect(show(freeSlots(events, "2026-11-11", { notBefore: new Date(at("12:30")) }))).toEqual(["12:30-14:00", "15:00-19:00"]);
  });
  it("finds the collisions of a proposal", () => {
    expect(conflictsWith(events, new Date(at("10:30")), new Date(at("11:15")))).toHaveLength(1);
    expect(conflictsWith(events, new Date(at("11:45")), new Date(at("12:15")))).toHaveLength(0);
  });
});

describe("knownPeople", () => {
  it("counts shared meetings, skips the owner and keeps the first name seen", () => {
    const a = ev(at("09:00"), at("09:15"), { attendees: [{ email: "andres@x.co", name: "Andrés", response: "accepted" }, { email: "matt@s.co", name: "Matt R.", response: "accepted" }] });
    const b = ev(at("10:00"), at("10:15"), { attendees: [{ email: "matt@s.co", name: null, response: "accepted" }, { email: "laura@x.co", name: "Laura", response: "accepted" }] });
    expect(knownPeople([a, b], "andres@x.co")).toEqual([
      { email: "matt@s.co", name: "Matt R.", meetings: 2 },
      { email: "laura@x.co", name: "Laura", meetings: 1 },
    ]);
  });
});
