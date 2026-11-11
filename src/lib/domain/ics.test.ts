import { describe, expect, it } from "vitest";
import { parseIcs, zonedToUtc } from "./ics";

const wrap = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:andres@example.com", "X-WR-TIMEZONE:America/Bogota", ...events, "END:VCALENDAR"].join("\r\n");
const ev = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const W = { from: new Date("2026-11-09T00:00:00Z"), to: new Date("2026-12-09T00:00:00Z") };

describe("zonedToUtc", () => {
  it("converts Bogota (UTC-5) and a DST zone", () => {
    expect(new Date(zonedToUtc({ y: 2026, mo: 11, d: 12, h: 10, mi: 0, s: 0 }, "America/Bogota")).toISOString()).toBe("2026-11-12T15:00:00.000Z");
    expect(new Date(zonedToUtc({ y: 2026, mo: 7, d: 1, h: 9, mi: 0, s: 0 }, "America/New_York")).toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(new Date(zonedToUtc({ y: 2026, mo: 12, d: 1, h: 9, mi: 0, s: 0 }, "America/New_York")).toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });
});

describe("parseIcs: single events", () => {
  it("reads UTC, TZID and floating times, the Meet link and folded lines", () => {
    const text = wrap(
      ev("UID:a1", "DTSTART:20261112T150000Z", "DTEND:20261112T153000Z", "SUMMARY:Sync Scout con Matt", "X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij"),
      ev("UID:a2", "DTSTART;TZID=America/Bogota:20261112T100000", "DTEND;TZID=America/Bogota:20261112T110000", "SUMMARY:Revisi", " ón de onboarding", "LOCATION:Sala 2"),
      ev("UID:a3", "DTSTART:20261112T200000", "DTEND:20261112T203000", "SUMMARY:Flotante"),
    );
    const r = parseIcs(text, W);
    expect(r.occurrences.map((o) => [o.title, o.startsAt, o.endsAt])).toEqual([
      ["Revisión de onboarding", "2026-11-12T15:00:00.000Z", "2026-11-12T16:00:00.000Z"],
      ["Sync Scout con Matt", "2026-11-12T15:00:00.000Z", "2026-11-12T15:30:00.000Z"],
      ["Flotante", "2026-11-13T01:00:00.000Z", "2026-11-13T01:30:00.000Z"], // floating = the calendar zone (Bogota)
    ]);
    expect(r.occurrences.find((o) => o.uid === "a1")!.meetUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(r.occurrences.find((o) => o.uid === "a2")!.location).toBe("Sala 2");
  });

  it("finds a Meet link in the location or description and unescapes text", () => {
    const text = wrap(ev("UID:m", "DTSTART:20261112T150000Z", "DTEND:20261112T153000Z", "SUMMARY:A\\, B", "DESCRIPTION:Join: https://meet.google.com/xyz-abcd-efg\\nbye"));
    const o = parseIcs(text, W).occurrences[0]!;
    expect(o.title).toBe("A, B");
    expect(o.meetUrl).toBe("https://meet.google.com/xyz-abcd-efg");
  });

  it("uses DURATION and drops what is outside the window", () => {
    const text = wrap(
      ev("UID:d", "DTSTART:20261112T150000Z", "DURATION:PT45M", "SUMMARY:Con duración"),
      ev("UID:old", "DTSTART:20250101T150000Z", "DTEND:20250101T160000Z", "SUMMARY:Viejo"),
    );
    const r = parseIcs(text, W);
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]!.endsAt).toBe("2026-11-12T15:45:00.000Z");
  });

  it("draws an all-day event from 00:00 to 00:00 in the viewer's zone", () => {
    const text = wrap(ev("UID:b", "DTSTART;VALUE=DATE:20261111", "DTEND;VALUE=DATE:20261112", "SUMMARY:Cumpleaños de Laura"));
    const o = parseIcs(text, W).occurrences[0]!;
    expect(o.allDay).toBe(true);
    expect(o.startsAt).toBe("2026-11-11T05:00:00.000Z");
    expect(o.endsAt).toBe("2026-11-12T05:00:00.000Z");
  });

  it("drops cancelled events and keeps tentative ones", () => {
    const text = wrap(
      ev("UID:c", "DTSTART:20261112T150000Z", "DTEND:20261112T153000Z", "SUMMARY:Cancelada", "STATUS:CANCELLED"),
      ev("UID:t", "DTSTART:20261112T160000Z", "DTEND:20261112T163000Z", "SUMMARY:Tentativa", "STATUS:TENTATIVE"),
    );
    const r = parseIcs(text, W);
    expect(r.occurrences.map((o) => [o.title, o.status])).toEqual([["Tentativa", "tentative"]]);
  });

  it("reads the owner's PARTSTAT as the response (X-WR-CALNAME or ownerEmail) and counts attendees", () => {
    const lines = [
      "UID:p",
      "DTSTART:20261112T150000Z",
      "DTEND:20261112T153000Z",
      "SUMMARY:Rechazada",
      'ATTENDEE;CN="Andrés, A";PARTSTAT=DECLINED;ROLE=REQ-PARTICIPANT:mailto:Andres@Example.com',
      "ATTENDEE;CN=Matt;PARTSTAT=ACCEPTED:mailto:matt@scoutapp.example",
      "ORGANIZER;CN=Matt:mailto:matt@scoutapp.example",
    ];
    const o = parseIcs(wrap(ev(...lines)), W).occurrences[0]!;
    expect(o.response).toBe("declined");
    expect(o.attendees).toHaveLength(2);
    expect(o.attendees[0]).toEqual({ email: "andres@example.com", name: "Andrés, A", response: "declined" });
    expect(o.organizer).toBe("matt@scoutapp.example");
    const other = parseIcs(wrap(ev(...lines)).replace("X-WR-CALNAME:andres@example.com", "X-WR-CALNAME:Trabajo"), W).occurrences[0]!;
    expect(other.response).toBe("none");
    expect(parseIcs(wrap(ev(...lines)).replace("X-WR-CALNAME:andres@example.com", "X-WR-CALNAME:Trabajo"), { ...W, ownerEmail: "matt@scoutapp.example" }).occurrences[0]!.response).toBe("accepted");
  });

  it("counts a bad event as skipped and keeps going; ignores VALARM inside an event", () => {
    const text = wrap(
      ev("UID:bad", "DTSTART:garbage", "SUMMARY:Roto"),
      ev("UID:tz", "DTSTART;TZID=Not/AZone:20261112T100000", "SUMMARY:Zona rara"),
      ev("UID:ok", "DTSTART:20261112T150000Z", "DTEND:20261112T153000Z", "SUMMARY:Bien", "BEGIN:VALARM", "TRIGGER:-PT10M", "SUMMARY:alarma", "END:VALARM"),
    );
    const r = parseIcs(text, W);
    expect(r.skipped).toBe(2);
    expect(r.occurrences.map((o) => o.title)).toEqual(["Bien"]);
  });
});

describe("parseIcs: recurrence", () => {
  const dtstart = "DTSTART;TZID=America/Bogota:20261109T090000";
  const dtend = "DTEND;TZID=America/Bogota:20261109T091500";

  it("expands a weekday standup and honours EXDATE", () => {
    const text = wrap(ev("UID:s", dtstart, dtend, "SUMMARY:Standup", "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "EXDATE;TZID=America/Bogota:20261111T090000"));
    const r = parseIcs(text, { from: new Date("2026-11-09T00:00:00Z"), to: new Date("2026-11-16T00:00:00Z") });
    expect(r.occurrences.map((o) => o.startsAt)).toEqual([
      "2026-11-09T14:00:00.000Z",
      "2026-11-10T14:00:00.000Z",
      "2026-11-12T14:00:00.000Z",
      "2026-11-13T14:00:00.000Z",
    ]);
    expect(r.occurrences.every((o) => o.recurring)).toBe(true);
  });

  it("applies COUNT, INTERVAL and UNTIL", () => {
    const biweekly = wrap(ev("UID:i", dtstart, dtend, "SUMMARY:Cada dos semanas", "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3"));
    expect(parseIcs(biweekly, W).occurrences.map((o) => o.startsAt.slice(0, 10))).toEqual(["2026-11-09", "2026-11-23", "2026-12-07"]);
    const until = wrap(ev("UID:u", dtstart, dtend, "SUMMARY:Diario", "RRULE:FREQ=DAILY;UNTIL=20261111T140000Z"));
    expect(parseIcs(until, W).occurrences.map((o) => o.startsAt.slice(0, 10))).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
  });

  it("expands monthly by the Nth weekday and by month day", () => {
    const nth = wrap(ev("UID:n", dtstart, dtend, "SUMMARY:Primer lunes", "RRULE:FREQ=MONTHLY;BYDAY=1MO"));
    expect(parseIcs(nth, { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2027-02-01T00:00:00Z") }).occurrences.map((o) => o.startsAt.slice(0, 10))).toEqual(["2026-11-02", "2026-12-07", "2027-01-04"].filter((d) => d >= "2026-11-09"));
    const last = wrap(ev("UID:l", dtstart, dtend, "SUMMARY:Último viernes", "RRULE:FREQ=MONTHLY;BYDAY=-1FR"));
    expect(parseIcs(last, { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2027-01-01T00:00:00Z") }).occurrences.map((o) => o.startsAt.slice(0, 10))).toEqual(["2026-11-27", "2026-12-25"]);
    const day = wrap(ev("UID:md", dtstart, dtend, "SUMMARY:Día 15", "RRULE:FREQ=MONTHLY;BYMONTHDAY=15,-1"));
    expect(parseIcs(day, { from: new Date("2026-11-09T00:00:00Z"), to: new Date("2027-01-01T00:00:00Z") }).occurrences.map((o) => o.startsAt.slice(0, 10))).toEqual(["2026-11-15", "2026-11-30", "2026-12-15", "2026-12-31"]);
  });

  it("keeps the local time across a DST change", () => {
    const text = wrap(ev("UID:ny", "DTSTART;TZID=America/New_York:20261030T090000", "DTEND;TZID=America/New_York:20261030T093000", "SUMMARY:NY", "RRULE:FREQ=DAILY;COUNT=5"));
    const r = parseIcs(text, { from: new Date("2026-10-29T00:00:00Z"), to: new Date("2026-11-10T00:00:00Z") });
    expect(r.occurrences.map((o) => o.startsAt)).toEqual([
      "2026-10-30T13:00:00.000Z", // EDT
      "2026-10-31T13:00:00.000Z",
      "2026-11-01T14:00:00.000Z", // EST after the change on Nov 1
      "2026-11-02T14:00:00.000Z",
      "2026-11-03T14:00:00.000Z",
    ]);
  });

  it("applies a moved occurrence (RECURRENCE-ID) and drops a cancelled one", () => {
    const text = wrap(
      ev("UID:s", dtstart, dtend, "SUMMARY:Standup", "RRULE:FREQ=DAILY;COUNT=4"),
      ev("UID:s", "RECURRENCE-ID;TZID=America/Bogota:20261110T090000", "DTSTART;TZID=America/Bogota:20261110T110000", "DTEND;TZID=America/Bogota:20261110T111500", "SUMMARY:Standup movido"),
      ev("UID:s", "RECURRENCE-ID;TZID=America/Bogota:20261111T090000", "DTSTART;TZID=America/Bogota:20261111T090000", "SUMMARY:Standup", "STATUS:CANCELLED"),
    );
    const r = parseIcs(text, W);
    expect(r.occurrences.map((o) => [o.title, o.startsAt, o.occurrenceKey])).toEqual([
      ["Standup", "2026-11-09T14:00:00.000Z", "2026-11-09T14:00:00.000Z"],
      ["Standup movido", "2026-11-10T16:00:00.000Z", "2026-11-10T14:00:00.000Z"], // moved: starts 11:00, keyed by the original 09:00
      ["Standup", "2026-11-12T14:00:00.000Z", "2026-11-12T14:00:00.000Z"],
    ]);
  });

  it("expands an all-day yearly event", () => {
    const text = wrap(ev("UID:y", "DTSTART;VALUE=DATE:20250217", "DTEND;VALUE=DATE:20250218", "SUMMARY:Aniversario", "RRULE:FREQ=YEARLY"));
    const r = parseIcs(text, { from: new Date("2026-02-01T00:00:00Z"), to: new Date("2026-03-01T00:00:00Z") });
    expect(r.occurrences.map((o) => o.startsAt)).toEqual(["2026-02-17T05:00:00.000Z"]);
  });

  it("stops a runaway rule instead of looping", () => {
    const text = wrap(ev("UID:r", dtstart, dtend, "SUMMARY:Sin fin", "RRULE:FREQ=DAILY"));
    const r = parseIcs(text, { from: new Date("2026-11-09T00:00:00Z"), to: new Date("2026-11-12T00:00:00Z") });
    expect(r.occurrences).toHaveLength(3);
  });
});
