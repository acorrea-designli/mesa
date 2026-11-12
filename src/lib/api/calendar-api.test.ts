// /api/calendar*: the stored events and the connection (never the feed address), the free slots, the people, the
// refresh (409 in sandbox and without the variable) and the meeting request that opens a ticket.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getCalendar } from "@/app/api/calendar/route";
import { GET as getFree } from "@/app/api/calendar/free/route";
import { GET as getPeople } from "@/app/api/calendar/people/route";
import { POST as postRefresh } from "@/app/api/calendar/refresh/route";
import { POST as postRequest } from "@/app/api/calendar/requests/route";
import { POST as postSalida } from "@/app/api/salidas/route";
import { openDb } from "../db/sqlite";
import { MEETING_REQUEST_MARK } from "../domain/calendar";
import { formatEventBody } from "../domain/calendar-event";
import { createRepos, type Repos } from "../repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
const ctx = { params: Promise.resolve({}) };
const req = (path: string, init?: RequestInit) => new Request(`http://local${path}`, init);
const post = (path: string, body: unknown) => req(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const SECRET = "https://calendar.google.com/calendar/ical/me%40example.com/private-abcdef0123456789/basic.ics";
const saved = { ...process.env };

const occ = (uid: string, start: string, end: string, o: Record<string, unknown> = {}) => ({
  uid,
  occurrenceKey: new Date(start).toISOString(),
  title: uid,
  startsAt: new Date(start).toISOString(),
  endsAt: new Date(end).toISOString(),
  allDay: false,
  timeZone: null,
  location: null,
  meetUrl: null,
  attendees: [],
  organizer: null,
  response: "accepted" as const,
  status: "confirmed" as const,
  recurring: false,
  ...o,
});

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" }, new Date());
  delete process.env.MESA_GCAL_ICS_URL;
  delete process.env.MESA_ENV;
  delete process.env.MESA_GCAL_OWNER_EMAIL;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("GET /api/calendar", () => {
  it("says it is not connected without the variable and returns the stored events", async () => {
    r.calendar.replace([occ("a", "2026-11-12T15:00:00Z", "2026-11-12T15:30:00Z")], new Date());
    const d = await (await getCalendar(req("/api/calendar?from=2026-11-09&to=2026-11-16"), ctx)).json();
    expect(d).toMatchObject({ configured: false, sandbox: false, health: "none", lastRefresh: null });
    expect(d.events.map((e: { uid: string }) => e.uid)).toEqual(["a"]);
  });

  it("reports the connection and the health, and never the address", async () => {
    process.env.MESA_GCAL_ICS_URL = SECRET;
    r.sources.set("calendar", { health: "degraded", note: "Google no respondió a tiempo", lastNewAt: "2026-11-11T19:39:00.000Z", lastError: "Google no respondió a tiempo" });
    const res = await getCalendar(req("/api/calendar"), ctx);
    const text = await res.text();
    expect(text).not.toContain("private-abcdef0123456789");
    expect(text).not.toContain("me%40example.com");
    expect(JSON.parse(text)).toMatchObject({ configured: true, health: "degraded", note: "Google no respondió a tiempo", lastRefresh: "2026-11-11T19:39:00.000Z" });
  });

  it("is a sandbox board whatever the variable says", async () => {
    process.env.MESA_GCAL_ICS_URL = SECRET;
    process.env.MESA_ENV = "sandbox";
    expect(await (await getCalendar(req("/api/calendar"), ctx)).json()).toMatchObject({ configured: false, sandbox: true });
  });

  it("rejects a bad window", async () => {
    for (const q of ["?from=hoy", "?from=2026-11-09&to=2026-11-09", "?from=2026-01-01&to=2026-12-31"]) expect((await getCalendar(req(`/api/calendar${q}`), ctx)).status).toBe(400);
  });

  it("gives the next meeting a week ahead whatever window the screen asked for", async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000);
    r.calendar.replace([occ("later", soon.toISOString(), new Date(soon.getTime() + 1_800_000).toISOString())], new Date());
    const d = await (await getCalendar(req("/api/calendar?from=2020-01-01&to=2020-01-08"), ctx)).json();
    expect(d.events).toEqual([]);
    expect(d.next.uid).toBe("later");
  });
});

describe("GET /api/calendar/free and /people", () => {
  it("lists the free gaps of a day from the stored events", async () => {
    r.calendar.replace([occ("m", "2026-11-12T15:00:00Z", "2026-11-12T16:00:00Z")], new Date());
    const d = await (await getFree(req("/api/calendar/free?day=2026-11-12&minutes=60"), ctx)).json();
    expect(d.day).toBe("2026-11-12");
    expect(d.slots).toEqual([
      { start: "2026-11-12T13:00:00.000Z", end: "2026-11-12T15:00:00.000Z" },
      { start: "2026-11-12T16:00:00.000Z", end: "2026-11-13T00:00:00.000Z" },
    ]);
    for (const q of ["?day=jueves", "?day=2026-11-12&minutes=2", "?day=2026-11-12&open=19:00&close=08:00"]) expect((await getFree(req(`/api/calendar/free${q}`), ctx)).status).toBe(400);
  });

  it("finds a person's address from the meetings they shared", async () => {
    process.env.MESA_GCAL_OWNER_EMAIL = "me@example.com";
    const att = (email: string, name: string) => ({ email, name, response: "accepted" as const });
    const soon = new Date(Date.now() + 86_400_000);
    r.calendar.replace(
      [
        occ("a", soon.toISOString(), new Date(soon.getTime() + 1_800_000).toISOString(), { attendees: [att("me@example.com", "Yo"), att("matt.r@scoutapp.example", "Matt Ross")] }),
        occ("b", new Date(soon.getTime() + 7_200_000).toISOString(), new Date(soon.getTime() + 9_000_000).toISOString(), { attendees: [att("matt.r@scoutapp.example", "Matt Ross")] }),
      ],
      new Date(),
    );
    const d = await (await getPeople(req("/api/calendar/people"), ctx)).json();
    expect(d.people).toEqual([{ email: "matt.r@scoutapp.example", name: "Matt Ross", meetings: 2 }]);
  });
});

describe("POST /api/calendar/refresh", () => {
  it("is 409 in the sandbox and without the variable, and never fetches", async () => {
    const off = await postRefresh(post("/api/calendar/refresh", {}), ctx);
    expect(off.status).toBe(409);
    expect((await off.json()).error.code).toBe("not_configured");
    process.env.MESA_GCAL_ICS_URL = SECRET;
    process.env.MESA_ENV = "sandbox";
    const sb = await postRefresh(post("/api/calendar/refresh", {}), ctx);
    expect(sb.status).toBe(409);
    expect((await sb.json()).error.code).toBe("sandbox");
  });
});

describe("POST /api/calendar/requests", () => {
  it("opens a ticket owned by the lead with his own words under the marker line", async () => {
    const res = await postRequest(post("/api/calendar/requests", { text: "meet con Matt el jueves 30 min" }), ctx);
    expect(res.status).toBe(201);
    const t = await res.json();
    expect(t.title).toBe("Reunión: meet con Matt el jueves 30 min");
    expect(t.direction).toBe("andres_asks");
    expect(t.ownerSession).toBe("lead");
    expect(t.messages[0].body).toBe(`${MEETING_REQUEST_MARK}\n\nmeet con Matt el jueves 30 min`);
    expect(r.db.prepare("SELECT kind FROM wake_events WHERE kind = 'ticket.created'").all()).toHaveLength(1);
  });

  it("rejects an empty request", async () => {
    expect((await postRequest(post("/api/calendar/requests", { text: "  " }), ctx)).status).toBe(400);
  });

  it("adds a 'Se repite' line for a repeat choice and nothing without one", async () => {
    for (const [repeat, label] of [["weekly", "cada semana"], ["biweekly", "cada 2 semanas"], ["monthly", "cada mes"]] as const) {
      const res = await postRequest(post("/api/calendar/requests", { text: "weekly de DRE los miércoles a las 4", repeat }), ctx);
      expect(res.status).toBe(201);
      expect((await res.json()).messages[0].body).toBe(`${MEETING_REQUEST_MARK}\n\nweekly de DRE los miércoles a las 4\n\nSe repite: ${label}`);
    }
    const none = await postRequest(post("/api/calendar/requests", { text: "meet con Matt", repeat: undefined }), ctx);
    expect((await none.json()).messages[0].body).not.toContain("Se repite");
  });

  it("rejects a repeat choice that is not in the list", async () => {
    expect((await postRequest(post("/api/calendar/requests", { text: "meet con Matt", repeat: "daily" }), ctx)).status).toBe(400);
  });
});

describe("a calendar salida over the API", () => {
  const dest = { kind: "calendar_event", calendar: "primary", invitees: ["matt.r@scoutapp.example"], meet: true, postAs: "Andrés" };
  const body = formatEventBody({ title: "Meet con Matt", start: "2026-11-12T10:00:00-05:00", end: "2026-11-12T10:30:00-05:00", timeZone: "America/Bogota", invitees: ["matt.r@scoutapp.example"], meet: true });
  it("is created with source calendar; a body that is not an event is a 400", async () => {
    const ok = await postSalida(post("/api/salidas", { source: "calendar", destination: dest, body, ownerSession: "lead" }), ctx);
    expect(ok.status).toBe(201);
    const bad = await postSalida(post("/api/salidas", { source: "calendar", destination: dest, body: "mañana a las 10", ownerSession: "lead" }), ctx);
    expect(bad.status).toBe(400);
    const rule = "RRULE:FREQ=WEEKLY;BYDAY=TH";
    const series = await postSalida(post("/api/salidas", { source: "calendar", destination: dest, body: body.replace("Meet: sí", `Meet: sí\nRepetir: ${rule}`), ownerSession: "lead" }), ctx);
    expect(series.status).toBe(201);
    expect((await series.json()).destination).toMatchObject({ recurrence: rule });
    const badRule = await postSalida(post("/api/salidas", { source: "calendar", destination: dest, body: body.replace("Meet: sí", "Meet: sí\nRepetir: RRULE:FREQ=WEEKLY;BYDAY=MO"), ownerSession: "lead" }), ctx);
    expect(badRule.status).toBe(400);
    expect(JSON.stringify(await badRule.json())).toMatch(/empieza un TH/);
    const mismatch = await postSalida(post("/api/salidas", { source: "slack", destination: dest, body: "x", ownerSession: "lead" }), ctx);
    expect(mismatch.status).toBe(400);
  });

  it("an invalid Repetir with the CLI's destination shape is the Spanish problem, not the schema error", async () => {
    // `mesa calendar propose --repeat X` copies X into destination.recurrence and into the body's Repetir line.
    for (const [rule, problem] of [
      ["FREQ=WEEKLY;BYDAY=TH", /debe empezar por RRULE:/],
      ["rrule:FREQ=WEEKLY;BYDAY=TH", /debe empezar por RRULE:/],
      ["RRULE:freq=weekly;byday=th", /mayúsculas/],
      ["RRULE:FREQ=MONTHLY;BYMONTHDAY=5", /empieza el día 12 del mes/],
    ] as const) {
      const res = await postSalida(post("/api/salidas", { source: "calendar", destination: { ...dest, recurrence: rule }, body: body.replace("Meet: sí", `Meet: sí\nRepetir: ${rule}`), ownerSession: "lead" }), ctx);
      expect(res.status, rule).toBe(400);
      const text = JSON.stringify(await res.json());
      expect(text, rule).toMatch(problem);
      expect(text, rule).not.toMatch(/invalid request body/i);
    }
  });
});
