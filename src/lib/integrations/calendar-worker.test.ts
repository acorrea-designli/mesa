import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { calendarEnabled } from "./calendar-env";
import { feedConfig, type Env, type FetchLike } from "./calendar-feed";
import { CalendarWorker } from "./calendar-worker";

// A fixture feed. The address below is a made-up secret: no test ever prints it, and none may find it stored.
const SECRET_URL = "https://calendar.google.com/calendar/ical/secret-owner%40example.com/private-0123456789abcdef/basic.ics";
const T0 = new Date("2026-11-11T19:42:00.000Z"); // 14:42 in Bogota

const FEED = [
  "BEGIN:VCALENDAR",
  "X-WR-CALNAME:andres@example.com",
  "X-WR-TIMEZONE:America/Bogota",
  "BEGIN:VEVENT",
  "UID:onb",
  "DTSTART:20261111T200000Z",
  "DTEND:20261111T203000Z",
  "SUMMARY:Revisión de onboarding Bseen",
  "X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij",
  "ATTENDEE;PARTSTAT=ACCEPTED:mailto:andres@example.com",
  "ATTENDEE;CN=Laura;PARTSTAT=ACCEPTED:mailto:laura@example.com",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:demo",
  "DTSTART:20261111T190000Z",
  "DTEND:20261111T194500Z",
  "SUMMARY:Demo Freightmate",
  "ATTENDEE;PARTSTAT=DECLINED:mailto:andres@example.com",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:standup",
  "DTSTART;TZID=America/Bogota:20261109T090000",
  "DTEND;TZID=America/Bogota:20261109T091500",
  "SUMMARY:Standup",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const ok = (text: string): FetchLike => async () => ({ ok: true, status: 200, text: async () => text, headers: new Headers() });
const status = (code: number): FetchLike => async () => ({ ok: false, status: code, text: async () => "", headers: new Headers() });
const boom = (name: string): FetchLike => async () => {
  throw Object.assign(new Error(`failed to fetch ${SECRET_URL}`), { name });
};

let r: Repos;
const env: Env = { MESA_GCAL_ICS_URL: SECRET_URL, MESA_GCAL_OWNER_EMAIL: "andres@example.com" };
const worker = (f: FetchLike, e: Env = env) => new CalendarWorker(r, f, e);
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
});

describe("feedConfig", () => {
  it("is off without the variable, in sandbox and with MESA_CALENDAR=off", () => {
    expect(feedConfig({}).state).toBe("off");
    expect(feedConfig({ MESA_GCAL_ICS_URL: SECRET_URL, MESA_ENV: "sandbox" }).state).toBe("off");
    expect(feedConfig({ MESA_GCAL_ICS_URL: SECRET_URL, MESA_CALENDAR: "off" }).state).toBe("off");
    expect(calendarEnabled({})).toBe(false);
  });
  it("rejects a value that is not an https address, without echoing it", () => {
    expect(feedConfig({ MESA_GCAL_ICS_URL: "http://example.com/x.ics" })).toEqual({ state: "invalid" });
    expect(feedConfig({ MESA_GCAL_ICS_URL: "not a url" })).toEqual({ state: "invalid" });
    expect(feedConfig({ MESA_GCAL_ICS_URL: SECRET_URL }).state).toBe("ready");
  });
});

describe("CalendarWorker", () => {
  it("does nothing and writes no health without the variable", async () => {
    let called = false;
    const w = worker(async () => {
      called = true;
      return { ok: true, status: 200, text: async () => FEED, headers: new Headers() };
    }, {});
    expect(await w.run({ now: T0 })).toEqual({ state: "off" });
    expect(called).toBe(false);
    expect(r.sources.list()).toEqual([]);
  });

  it("never fetches in sandbox even with the variable set", async () => {
    let called = false;
    const w = worker(async () => {
      called = true;
      return { ok: true, status: 200, text: async () => FEED, headers: new Headers() };
    }, { ...env, MESA_ENV: "sandbox" });
    expect((await w.run({ now: T0, force: true })).state).toBe("off");
    expect(called).toBe(false);
  });

  it("reads the feed into the table and marks the source ok", async () => {
    const res = await worker(ok(FEED)).run({ now: T0 });
    expect(res).toMatchObject({ state: "ok", skippedEvents: 0 });
    const rows = r.calendar.list({ from: new Date("2026-11-11T05:00:00Z"), to: new Date("2026-11-12T05:00:00Z") });
    expect(rows.map((e) => [e.title, e.response, e.meetUrl, e.attendeesCount])).toEqual([
      ["Standup", "none", null, 0],
      ["Demo Freightmate", "declined", null, 1],
      ["Revisión de onboarding Bseen", "accepted", "https://meet.google.com/abc-defg-hij", 2],
    ]);
    expect(r.sources.get("calendar")).toMatchObject({ health: "ok", errorCount: 0, lastError: null, lastChecked: T0.toISOString(), cadenceS: 300, backoffUntil: null });
  });

  it("keeps ids stable across reads and replaces the rows (a deleted meeting disappears)", async () => {
    await worker(ok(FEED)).run({ now: T0 });
    const before = r.calendar.list({ from: new Date("2026-11-11T05:00:00Z"), to: new Date("2026-11-12T05:00:00Z") });
    const smaller = FEED.replace(/BEGIN:VEVENT\r\nUID:demo[\s\S]*?END:VEVENT\r\n/, "");
    await worker(ok(smaller)).run({ now: at(10) });
    const after = r.calendar.list({ from: new Date("2026-11-11T05:00:00Z"), to: new Date("2026-11-12T05:00:00Z") });
    expect(after).toHaveLength(before.length - 1);
    expect(after.find((e) => e.uid === "onb")!.id).toBe(before.find((e) => e.uid === "onb")!.id);
  });

  it("leaves sample rows alone", async () => {
    r.calendar.replaceSamples([{ uid: "s1", occurrenceKey: "2026-11-11T21:00:00.000Z", title: "Muestra", startsAt: "2026-11-11T21:00:00.000Z", endsAt: "2026-11-11T21:30:00.000Z", allDay: false, timeZone: null, location: null, meetUrl: null, attendees: [], organizer: null, response: "accepted", status: "confirmed", recurring: false }], T0);
    await worker(ok(FEED)).run({ now: T0 });
    expect(r.calendar.count().samples).toBe(1);
    expect(r.calendar.clearSamples()).toBe(1);
  });

  it("respects the cadence unless forced", async () => {
    const w = worker(ok(FEED));
    await w.run({ now: T0 });
    expect(await w.run({ now: at(2) })).toEqual({ state: "skipped", reason: "not_due" });
    expect((await w.run({ now: at(2), force: true })).state).toBe("ok");
    expect((await w.run({ now: at(8) })).state).toBe("ok");
  });

  it("backs off with a fixed phrase on failure, degraded then down, and recovers", async () => {
    const w = worker(status(403));
    let res = await w.run({ now: T0 });
    expect(res).toEqual({ state: "error", error: "Google no entrega el calendario (HTTP 403)" });
    expect(r.sources.get("calendar")).toMatchObject({ health: "degraded", errorCount: 1, lastError: "Google no entrega el calendario (HTTP 403)" });
    expect(r.sources.get("calendar").backoffUntil).toBe(at(10).toISOString()); // 300 s * 2^1
    expect(await w.run({ now: at(5) })).toEqual({ state: "skipped", reason: "not_due" });
    await w.run({ now: at(11) });
    expect(r.sources.get("calendar")).toMatchObject({ health: "degraded", errorCount: 2 });
    expect(r.sources.get("calendar").backoffUntil).toBe(at(11 + 20).toISOString());
    await w.run({ now: at(40) });
    expect(r.sources.get("calendar")).toMatchObject({ health: "down", errorCount: 3 });
    // the stored events survive a failed read; the next good read heals the source
    res = await worker(ok(FEED)).run({ now: at(120) });
    expect(res.state).toBe("ok");
    expect(r.sources.get("calendar")).toMatchObject({ health: "ok", errorCount: 0, backoffUntil: null });
  });

  it.each([
    ["TimeoutError", "Google no respondió a tiempo"],
    ["TypeError", "sin conexión con Google"],
  ])("maps a %s to a fixed phrase", async (name, phrase) => {
    expect(await worker(boom(name)).run({ now: T0 })).toEqual({ state: "error", error: phrase });
  });

  it("rejects a response that is not a calendar", async () => {
    expect(await worker(ok("<html>login</html>")).run({ now: T0 })).toEqual({ state: "error", error: "la respuesta no es un calendario iCal" });
  });

  it("an invalid address is down with a note and never fetches", async () => {
    let called = false;
    const w = worker(async () => {
      called = true;
      return { ok: true, status: 200, text: async () => FEED, headers: new Headers() };
    }, { MESA_GCAL_ICS_URL: "ftp://nope" });
    expect(await w.run({ now: T0 })).toEqual({ state: "invalid" });
    expect(called).toBe(false);
    expect(r.sources.get("calendar")).toMatchObject({ health: "down" });
  });

  it("never stores or reports the address anywhere", async () => {
    const w = worker(boom("TypeError"));
    await w.run({ now: T0 });
    await worker(ok(FEED)).run({ now: at(20) });
    const dump = JSON.stringify([r.sources.list(), r.calendar.list({ from: new Date(0), to: new Date("2100-01-01") }), r.db.prepare("SELECT * FROM wake_events").all()]);
    expect(dump).not.toContain("private-0123456789abcdef");
    expect(dump).not.toContain("secret-owner");
  });
});
