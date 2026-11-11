import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { formatEventBody, type EventFields } from "../domain/calendar-event";
import { meetingsLeft, nextMeeting } from "../domain/calendar";
import { resetSamples, seedSamples } from "../seed/sample";
import { createRepos, type Repos } from ".";
import { calendarEventId } from "./calendar";

const NOW = new Date("2026-11-11T19:42:00.000Z"); // Wednesday 14:42 in Bogota
let r: Repos;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
});

const fields: EventFields = { title: "Meet con Matt", start: "2026-11-12T10:00:00-05:00", end: "2026-11-12T10:30:00-05:00", timeZone: "America/Bogota", invitees: ["matt.r@scoutapp.example"], meet: true };
const propose = (over: Record<string, unknown> = {}) =>
  r.salidas.create(
    { source: "calendar", destination: { kind: "calendar_event", calendar: "primary", invitees: fields.invitees, meet: true, postAs: "Andrés" }, body: formatEventBody(fields), title: "Evento: Meet con Matt", ownerSession: "lead", ...over },
    NOW,
  );

describe("calendar events", () => {
  it("ids are stable per occurrence", () => {
    expect(calendarEventId("u1", "2026-11-12T15:00:00.000Z")).toBe(calendarEventId("u1", "2026-11-12T15:00:00.000Z"));
    expect(calendarEventId("u1", "2026-11-12T15:00:00.000Z")).not.toBe(calendarEventId("u1", "2026-11-13T15:00:00.000Z"));
    expect(calendarEventId("u1", "2026-11-12T15:00:00.000Z")).toMatch(/^ce_[0-9a-z]+$/);
  });

  it("the seed puts a fictional week in Calendario, all flagged as sample, and reset removes only those", () => {
    seedSamples(r, NOW);
    const week = r.calendar.list({ from: new Date("2026-11-09T05:00:00Z"), to: new Date("2026-11-16T05:00:00Z") });
    expect(week.length).toBeGreaterThan(10);
    expect(week.every((e) => e.isSample)).toBe(true);
    expect(nextMeeting(week, NOW)?.title).toBe("Revisión de onboarding Bseen");
    expect(week.find((e) => e.title === "Demo Freightmate" && e.response === "declined")).toBeTruthy();
    expect(week.find((e) => e.allDay)?.title).toBe("Cumpleaños de Laura");
    const pending = r.salidas.list({ status: ["pending"] }).filter((s) => s.source === "calendar");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.isSample).toBe(true);
    expect(meetingsLeft(week, NOW)).toBe(3); // 15:00, 16:30 and 17:30 are left on Wednesday (the declined demo and the all-day birthday do not count)
    expect(typeof r.counts().calendar).toBe("number"); // the rail's figure, read at the real clock

    r.calendar.replace([], NOW); // a real read replaces real rows only
    expect(r.calendar.count()).toEqual({ real: 0, samples: week.length });
    resetSamples(r.db);
    expect(r.calendar.count()).toEqual({ real: 0, samples: 0 });
  });

  it("lists events that overlap a window, including one that started earlier", () => {
    r.calendar.replace(
      [
        { uid: "a", occurrenceKey: "2026-11-11T18:00:00.000Z", title: "Largo", startsAt: "2026-11-11T18:00:00.000Z", endsAt: "2026-11-11T21:00:00.000Z", allDay: false, timeZone: null, location: null, meetUrl: null, attendees: [], organizer: null, response: "none", status: "confirmed", recurring: false },
        { uid: "b", occurrenceKey: "2026-11-12T15:00:00.000Z", title: "Mañana", startsAt: "2026-11-12T15:00:00.000Z", endsAt: "2026-11-12T16:00:00.000Z", allDay: false, timeZone: null, location: null, meetUrl: null, attendees: [], organizer: null, response: "none", status: "confirmed", recurring: false },
      ],
      NOW,
    );
    expect(r.calendar.list({ from: NOW, to: new Date("2026-11-12T05:00:00Z") }).map((e) => e.title)).toEqual(["Largo"]);
    expect(r.calendar.list({ from: new Date("2026-11-12T05:00:00Z"), to: new Date("2026-11-13T05:00:00Z") }).map((e) => e.title)).toEqual(["Mañana"]);
  });
});

describe("calendar salidas", () => {
  it("the table accepts the new source and keeps the body as the event", () => {
    const s = propose();
    expect(s.source).toBe("calendar");
    expect(s.versions[0]!.body).toContain("Título: Meet con Matt");
    expect(r.salidas.get(s.id).destination).toMatchObject({ kind: "calendar_event", calendar: "primary" });
  });

  it("refuses a body that is not a complete event, on create and on every new version", () => {
    expect(() => propose({ body: "Meet con Matt mañana a las 10" })).toThrow(/calendar salida body/);
    const s = propose();
    expect(() => r.salidas.addVersion(s.id, { body: formatEventBody(fields).replace("Zona: America/Bogota", "Zona: Narnia/Cair"), author: "claude" }, NOW)).toThrow(/zona/);
    const v2 = r.salidas.addVersion(s.id, { body: formatEventBody({ ...fields, end: "2026-11-12T11:00:00-05:00" }), author: "claude" }, NOW);
    expect(v2.currentVersion).toBe(2);
    // Slack bodies stay free text
    expect(() => r.salidas.create({ source: "slack", destination: { kind: "slack_channel", workspace: "w", channel: "#c", postAs: "A" }, body: "hola", ownerSession: "lead" }, NOW)).not.toThrow();
  });

  it("keeps the destination's invitees and Meet equal to the current version's body (never stale after an edit or a revert)", () => {
    const s = propose();
    const edited = formatEventBody({ ...fields, invitees: ["laura@example.com", "sofia@example.com"], meet: false });
    const v2 = r.salidas.edit(s.id, edited, NOW);
    expect(v2.destination).toMatchObject({ kind: "calendar_event", invitees: ["laura@example.com", "sofia@example.com"], meet: false });
    const back = r.salidas.selectVersion(s.id, 1, NOW);
    expect(back.destination).toMatchObject({ invitees: ["matt.r@scoutapp.example"], meet: true });
  });

  it("goes out through the normal path even while the feed is down (reading is not creating)", () => {
    r.sources.set("calendar", { health: "down", note: "sin conexión con Google" }, NOW);
    const s = propose();
    const approved = r.salidas.transition(s.id, { type: "approve", version: 1 }, NOW);
    expect(approved.status).toBe("sending"); // not queued_until_back
    const released = r.salidas.transition(s.id, { type: "release" }, new Date(NOW.getTime() + 21_000));
    expect(released.releasedAt).not.toBeNull();
    const sent = r.salidas.transition(s.id, { type: "sent", permalink: "https://calendar.google.com/calendar/event?eid=abc" }, new Date(NOW.getTime() + 25_000));
    expect(sent.status).toBe("sent");
  });
});
