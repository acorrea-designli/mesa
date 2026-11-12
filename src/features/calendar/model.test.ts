import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/domain/types";
import { agendaRows, calendarHref, healthPill, outsideNote, stations, stripModel, weekLabel, weekNav } from "./model";

let n = 0;
const ev = (start: string, end: string, o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `ce_${++n}`,
  uid: `u${n}`,
  occurrenceKey: new Date(start).toISOString(),
  title: `Reunión ${n}`,
  startsAt: new Date(start).toISOString(),
  endsAt: new Date(end).toISOString(),
  allDay: false,
  timeZone: null,
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
const at = (hm: string, day = "2026-11-11") => `${day}T${hm}:00-05:00`;
const NOW = new Date(at("14:42"));

const standup = ev(at("09:00"), at("09:15"), { title: "Standup", meetUrl: "https://meet.google.com/a-b-c", attendeesCount: 6 });
const declined = ev(at("14:00"), at("14:45"), { title: "Demo", response: "declined", attendeesCount: 3 });
const allDay = ev(at("00:00"), at("00:00", "2026-11-12"), { title: "Cumple", allDay: true });
const onboarding = ev(at("15:00"), at("15:30"), { title: "Onboarding", meetUrl: "https://meet.google.com/x-y-z", attendeesCount: 4 });
const laura = ev(at("16:30"), at("17:00"), { title: "1:1", location: "Sala 2" });
const thu = ev(at("09:00", "2026-11-12"), at("09:15", "2026-11-12"), { title: "Standup jueves" });
const events = [laura, standup, declined, onboarding, allDay, thu];

describe("agendaRows", () => {
  const rows = agendaRows(events, "2026-11-11", NOW);
  it("orders all-day first and marks each state", () => {
    expect(rows.map((r) => [r.event.title, r.state])).toEqual([
      ["Cumple", "allday"],
      ["Standup", "past"],
      ["Demo", "declined"],
      ["Onboarding", "next"],
      ["1:1", "ahead"],
    ]);
  });
  it("says time, people and the line under the title", () => {
    const next = rows.find((r) => r.state === "next")!;
    expect(next.time).toBe("15:00–15:30");
    expect(next.people).toBe("4");
    expect(next.sub).toBe("Google Meet · en 18 min · aviso a las 14:50");
    expect(next.canJoin).toBe(true);
    expect(rows.find((r) => r.event.title === "Standup")!.sub).toBe("Google Meet · terminó");
    expect(rows.find((r) => r.event.title === "Standup")!.canJoin).toBe(false);
    expect(rows.find((r) => r.state === "declined")!.sub).toBe("Rechazada por ti · sin aviso");
    expect(rows.find((r) => r.event.title === "1:1")!.sub).toBe("Sala 2");
    expect(rows.find((r) => r.event.title === "1:1")!.people).toBe("");
    expect(rows[0]!.time).toBe("Todo el día");
  });
  it("marks the meeting in progress and offers Unirse", () => {
    const r = agendaRows(events, "2026-11-11", new Date(at("15:10"))).find((x) => x.event.title === "Onboarding")!;
    expect(r.state).toBe("now");
    expect(r.sub).toBe("Google Meet · termina 15:30");
    expect(r.canJoin).toBe(true);
  });
});

describe("stations", () => {
  const s = stations(events, "2026-11-11", NOW);
  it("lists the week with counts, today's remainder and the selection", () => {
    expect(s.map((x) => [x.name.slice(0, 3), x.count, x.selected, x.today, x.past])).toEqual([
      ["Lun", 0, false, false, true],
      ["Mar", 0, false, false, true],
      ["Mié", 3, true, true, false],
      ["Jue", 1, false, false, false],
      ["Vie", 0, false, false, false],
    ]);
    expect(s[2]!.note).toBe("hoy · 2 faltan");
    expect(s[3]!.note).toBe("reunión");
    expect(s[0]!.note).toBe("reuniones");
  });
});

describe("healthPill", () => {
  const base = { configured: true, sandbox: false, health: "ok" as const, lastRefresh: "2026-11-11T19:39:00.000Z", note: "", events: [] as CalendarEvent[] };
  it("reads the age of the last read", () => {
    expect(healthPill(base, NOW)).toEqual({ text: "Google Calendar · leído hace 3 min", off: false });
    expect(healthPill({ ...base, lastRefresh: "2026-11-11T19:42:00.000Z" }, NOW).text).toBe("Google Calendar · leído ahora");
  });
  it("is dashed when the read fails, nothing is connected or it is the sandbox", () => {
    expect(healthPill({ ...base, health: "down" }, NOW)).toEqual({ text: "Última lectura 14:39", off: true });
    expect(healthPill({ ...base, configured: false, lastRefresh: null }, NOW)).toEqual({ text: "Sin conectar", off: true });
    expect(healthPill({ ...base, configured: false, lastRefresh: null, events: [{ ...standup, isSample: true }] }, NOW).text).toBe("Datos de muestra");
    expect(healthPill({ ...base, sandbox: true }, NOW).off).toBe(true);
  });
});

describe("stripModel", () => {
  it("is next beyond ten minutes, soon within them, now while it runs", () => {
    expect(stripModel(onboarding, NOW)).toMatchObject({ mode: "next", when: "en 18 min", time: "15:00–15:30" });
    expect(stripModel(onboarding, new Date(at("14:51"))).mode).toBe("soon");
    expect(stripModel(onboarding, new Date(at("15:10")))).toMatchObject({ mode: "now", when: "termina 15:30" });
  });
  it("names the day when the next meeting is not today, and is none without one", () => {
    expect(stripModel(thu, NOW).when).toBe("mañana");
    expect(stripModel(thu, new Date(at("14:00", "2026-11-09"))).when).toBe("jue 12");
    expect(stripModel(null, NOW)).toEqual({ mode: "none", event: null, when: "", time: "" });
  });
});

describe("calendarHref", () => {
  it("builds the screen's links", () => {
    expect(calendarHref()).toBe("/calendario");
    expect(calendarHref("2026-11-12")).toBe("/calendario?dia=2026-11-12");
    expect(calendarHref("2026-11-12", "semana")).toBe("/calendario?dia=2026-11-12&vista=semana");
    expect(calendarHref(null, "semana")).toBe("/calendario?vista=semana");
  });
});

describe("weekNav and weekLabel (t127)", () => {
  it("moves seven days and keeps the view", () => {
    const n = weekNav("2026-11-11", "semana", "2026-11-11");
    expect(n).toMatchObject({ monday: "2026-11-09", label: "9–15 nov", current: true, thisHref: null });
    expect(n.prevHref).toBe("/calendario?dia=2026-11-04&vista=semana");
    expect(n.nextHref).toBe("/calendario?dia=2026-11-18&vista=semana");
    expect(weekNav("2026-11-11", "hoy", "2026-11-11").nextHref).toBe("/calendario?dia=2026-11-18");
  });

  it("goes back to today without a day, and says it is another week", () => {
    const n = weekNav("2026-10-05", "semana", "2026-11-11");
    expect(n).toMatchObject({ monday: "2026-10-05", label: "5–11 oct", current: false, thisHref: "/calendario?vista=semana" });
    expect(weekNav("2026-10-05", "hoy", "2026-11-11").thisHref).toBe("/calendario");
    // another day of the current week: the button is there to go back to today
    expect(weekNav("2026-11-13", "hoy", "2026-11-11").thisHref).toBe("/calendario");
  });

  it("crosses the year in both directions", () => {
    expect(weekNav("2026-12-29", "semana", "2026-12-29").nextHref).toBe("/calendario?dia=2027-01-05&vista=semana");
    expect(weekNav("2027-01-02", "semana", "2027-01-02").prevHref).toBe("/calendario?dia=2026-12-26&vista=semana");
  });

  it("labels a week that spans months or years, and one from another year", () => {
    expect(weekLabel("2026-09-28", "2026-11-11")).toBe("28 sep–4 oct");
    expect(weekLabel("2026-12-28", "2026-11-11")).toBe("28 dic 2026–3 ene 2027");
    expect(weekLabel("2025-03-03", "2026-11-11")).toBe("3–9 mar 2025");
  });
});

describe("outsideNote (t127)", () => {
  const today = "2026-11-12";
  it("is null for a week or a day the poller keeps", () => {
    expect(outsideNote("2026-11-12", "semana", today)).toBeNull();
    expect(outsideNote("2026-08-13", "hoy", today)).toBeNull();
  });
  it("explains a week outside and links the same week in Google Calendar", () => {
    const n = outsideNote("2026-05-06", "semana", today)!;
    expect(n.whole).toBe(true);
    expect(n.text).toContain("13 semanas atrás y 26 adelante");
    expect(n.href).toBe("https://calendar.google.com/calendar/r/week/2026/5/4");
  });
  it("links the day in the day view, and a half-stored week says only part is missing", () => {
    expect(outsideNote("2027-06-01", "hoy", today)!.href).toBe("https://calendar.google.com/calendar/r/day/2027/6/1");
    const p = outsideNote("2026-08-12", "semana", today)!;
    expect(p.whole).toBe(false);
    expect(p.text).toMatch(/^Parte de esta semana/);
  });
});

describe("the row's Abrir en Google link (t127)", () => {
  it("uses the event's own link, else its day", () => {
    const own = ev(at("09:00"), at("09:30"), { googleUrl: "https://www.google.com/calendar/event?eid=abc" });
    expect(agendaRows([own], "2026-11-11", NOW)[0]!.openUrl).toBe("https://www.google.com/calendar/event?eid=abc");
    const bare = ev(at("10:00"), at("10:30"));
    expect(agendaRows([bare], "2026-11-11", NOW)[0]!.openUrl).toBe("https://calendar.google.com/calendar/r/day/2026/11/11");
  });
});
