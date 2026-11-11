import { test } from "node:test";
import assert from "node:assert/strict";
import { check, sandboxBlock } from "../mesa-guardrails.mjs";
import { eventFromCall, eventMismatches, parseEventBody } from "../calendar-body.mjs";
import { fakeAgent, fakeMesa, unreachable } from "./helpers.mjs";

const lead = { transcript_path: "C:/x/sess.jsonl", session_id: "sess" };
const mate = () => fakeAgent({ name: "dev-t112" }).input;
const run = (base, tool_name, tool_input, fetchImpl = unreachable) => check({ ...base, tool_name, tool_input }, { fetchImpl });
const rule = async (p) => (await p)?.rule ?? null;

const CREATE = "mcp__claude_ai_Google_Calendar__create_event";
const BODY = [
  "Título: Meet con Matt",
  "Inicio: 2026-11-12T10:00:00-05:00",
  "Fin: 2026-11-12T10:30:00-05:00",
  "Zona: America/Bogota",
  "Invitados: matt.r@scoutapp.example",
  "Meet: sí",
].join("\n");

const salida = (over = {}) => ({
  id: "sa_cal1",
  source: "calendar",
  releasedAt: "2026-11-11T20:30:00Z",
  approvedVersion: 1,
  versions: [{ n: 1, body: BODY }],
  destination: { kind: "calendar_event", calendar: "primary", invitees: ["matt.r@scoutapp.example"], meet: true, postAs: "Andrés" },
  ...over,
});
const mesaWith = (...salidas) => fakeMesa({ "GET /api/salidas?status=sending": { salidas } });
const call = {
  summary: "Meet con Matt",
  start: { dateTime: "2026-11-12T10:00:00", timeZone: "America/Bogota" },
  end: { dateTime: "2026-11-12T10:30:00", timeZone: "America/Bogota" },
  attendees: [{ email: "Matt.R@scoutapp.example" }],
  addGoogleMeet: true,
};

test("calendar body: parses the approved fields and refuses a malformed one", () => {
  const p = parseEventBody(BODY);
  assert.equal(p.ok, true);
  assert.deepEqual(p.fields, { title: "Meet con Matt", start: "2026-11-12T10:00:00-05:00", end: "2026-11-12T10:30:00-05:00", timeZone: "America/Bogota", invitees: ["matt.r@scoutapp.example"], meet: true, description: "" });
  for (const bad of [BODY.replace("Título: Meet con Matt\n", ""), BODY.replace("-05:00", ""), BODY.replace("Meet: sí", "Meet: quizá"), `${BODY}\nColor: rojo`, BODY.replace("America/Bogota", "Narnia/Cair"), BODY.replace("10:30", "09:30")]) {
    assert.equal(parseEventBody(bad).ok, false, bad);
  }
});

test("calendar body: reads the connector's parameters tolerantly", () => {
  const f = eventFromCall(call);
  assert.equal(f.title, "Meet con Matt");
  assert.equal(f.start, Date.parse("2026-11-12T15:00:00Z"));
  assert.deepEqual(f.invitees, ["matt.r@scoutapp.example"]);
  assert.equal(f.meet, true);
  const g = eventFromCall({ title: "X", startTime: "2026-11-12T15:00:00Z", endTime: "2026-11-12T15:30:00Z", guests: "a@b.co, c@d.co", conferenceData: { createRequest: {} } });
  assert.equal(g.start, Date.parse("2026-11-12T15:00:00Z"));
  assert.deepEqual(g.invitees, ["a@b.co", "c@d.co"]);
  assert.equal(g.meet, true);
  assert.equal(eventFromCall({ title: "X", add_meet: false }).meet, false);
  assert.equal(eventFromCall({ title: "X", start: "2026-11-12T10:00:00" }).start, null); // no zone: unreadable
});

test("G5: create_event passes only for a released calendar salida with exactly the approved fields", async () => {
  assert.equal(await rule(run(lead, CREATE, call, mesaWith(salida()).fetchImpl)), null);
  // the full salida is fetched when the list does not carry the approved body
  const lean = { ...salida(), versions: undefined, approvedVersion: undefined };
  const mesa = fakeMesa({ "GET /api/salidas?status=sending": { salidas: [lean] }, "GET /api/salidas/sa_cal1": { salida: salida() } });
  assert.equal(await rule(run(lead, CREATE, call, mesa.fetchImpl)), null);
});

test("G5: any difference from the approved event is refused and says what differs", async () => {
  const mesa = mesaWith(salida());
  const cases = [
    [{ ...call, summary: "Meet con Matthew" }, /title/],
    [{ ...call, start: { dateTime: "2026-11-12T11:00:00", timeZone: "America/Bogota" } }, /start/],
    [{ ...call, end: { dateTime: "2026-11-12T11:00:00", timeZone: "America/Bogota" } }, /end/],
    [{ ...call, attendees: [{ email: "matt.r@scoutapp.example" }, { email: "boss@example.com" }] }, /invitees/],
    [{ ...call, attendees: [] }, /invitees/],
    [{ ...call, addGoogleMeet: false }, /Google Meet/],
    [{ ...call, description: "surprise" }, /description/],
  ];
  for (const [input, re] of cases) {
    const r = await run(lead, CREATE, input, mesa.fetchImpl);
    assert.equal(r?.rule, "G5");
    assert.match(r.reason, re);
    assert.match(r.reason, /sa_cal1/);
  }
});

test("G5: a calendar salida that is not released, already sent, a sample or another source never matches", async () => {
  for (const s of [salida({ releasedAt: null }), salida({ sentAt: "2026-11-11T20:31:00Z" }), salida({ isSample: true }), salida({ source: "slack" })]) {
    assert.equal(await rule(run(lead, CREATE, call, mesaWith(s).fetchImpl)), "G5");
  }
  assert.equal(await rule(run(lead, CREATE, call, mesaWith().fetchImpl)), "G5");
});

test("G5: Mesa unreachable blocks the create", async () => {
  const r = await run(lead, CREATE, call, unreachable);
  assert.equal(r?.rule, "G5");
  assert.match(r.reason, /unreachable/);
});

test("G5: other Google Calendar writes are refused for the lead; reads pass", async () => {
  for (const t of ["update_event", "delete_event", "respond_to_event", "move_event"]) {
    assert.equal(await rule(run(lead, `mcp__claude_ai_Google_Calendar__${t}`, { eventId: "x" }, mesaWith(salida()).fetchImpl)), "G5", t);
  }
  for (const t of ["list_events", "get_event", "find_free_time", "list_calendars"]) {
    assert.equal(await rule(run(lead, `mcp__claude_ai_Google_Calendar__${t}`, {}, unreachable)), null, t);
  }
  assert.equal(await rule(run(lead, "mcp__google-calendar__create_event", call, mesaWith(salida()).fetchImpl)), null);
});

test("G4: a teammate never writes to Google Calendar, even create_event; it may read", async () => {
  assert.equal(await rule(run(mate(), CREATE, call, mesaWith(salida()).fetchImpl)), "G4");
  assert.equal(await rule(run(mate(), "mcp__claude_ai_Google_Calendar__update_event", {}, unreachable)), "G4");
  assert.equal(await rule(run(mate(), "mcp__claude_ai_Google_Calendar__list_events", {}, unreachable)), null);
});

test("G11: the sandbox lets no Google Calendar write out", async () => {
  assert.match(sandboxBlock(CREATE, call), /sandbox: nada sale de aquí/);
  assert.match(sandboxBlock(CREATE, call), /--simulated/);
  assert.equal(sandboxBlock("mcp__claude_ai_Google_Calendar__list_events", {}), null);
});

test("mismatches: an exact call has none", () => {
  const ok = parseEventBody(BODY).fields;
  assert.deepEqual(eventMismatches(ok, eventFromCall(call)), []);
});
