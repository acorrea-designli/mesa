import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../mesa-guardrails.mjs";
import { isMoveBody, moveMismatches, parseMoveBody } from "../calendar-move.mjs";
import { fakeAgent, fakeMesa, unreachable } from "./helpers.mjs";

const lead = { transcript_path: "C:/x/sess.jsonl", session_id: "sess" };
const mate = () => fakeAgent({ name: "dev-t131" }).input;
const run = (base, tool_name, tool_input, fetchImpl = unreachable) => check({ ...base, tool_name, tool_input }, { fetchImpl });
const rule = async (p) => (await p)?.rule ?? null;

const UPDATE = "mcp__claude_ai_Google_Calendar__update_event";
const ID = "03fo5onsmpno60suu57ma2ashp";
const BODY = [`Mover: ${ID}`, "Título: Weekly Check-In", "Inicio: 2026-11-13T11:00:00-05:00", "Fin: 2026-11-13T11:30:00-05:00", "Zona: America/Bogota", "Avisar: sí"].join("\n");
const BODY_QUIET = BODY.replace("Avisar: sí", "Avisar: no");

const salida = (over = {}) => ({
  id: "sa_mv1",
  source: "calendar",
  releasedAt: "2026-11-12T20:30:00Z",
  approvedVersion: 1,
  versions: [{ n: 1, body: BODY }],
  destination: { kind: "calendar_event", calendar: "primary", postAs: "Andrés" },
  ...over,
});
const mesaWith = (...salidas) => fakeMesa({ "GET /api/salidas?status=sending": { salidas } });
const call = { eventId: ID, startTime: "2026-11-13T11:00:00", endTime: "2026-11-13T11:30:00", timeZone: "America/Bogota" };

test("move body: parses the approved fields and refuses a malformed one", () => {
  const p = parseMoveBody(BODY);
  assert.equal(p.ok, true);
  assert.deepEqual(p.fields, { eventId: ID, title: "Weekly Check-In", start: "2026-11-13T11:00:00-05:00", end: "2026-11-13T11:30:00-05:00", timeZone: "America/Bogota", notify: true });
  assert.equal(parseMoveBody(BODY_QUIET).fields.notify, false);
  assert.equal(isMoveBody(BODY), true);
  assert.equal(isMoveBody("Título: x"), false);
  const bad = [
    BODY.replace(`Mover: ${ID}\n`, ""),
    BODY.replace(ID, "has space"),
    BODY.replace("11:00:00-05:00", "11:00:00"),
    BODY.replace("11:30:00-05:00", "10:00:00-05:00"),
    BODY.replace("America/Bogota", "Narnia/Cair"),
    BODY.replace("Avisar: sí", "Avisar: quizá"),
    BODY.replace("\nAvisar: sí", ""),
    BODY.replace("Título: Weekly Check-In\n", ""),
    `${BODY}\nInvitados: a@b.co`,
    `${BODY}\nMeet: sí`,
    `${BODY}\nDescripción: x`,
    `${BODY}\nColor: rojo`,
    `${BODY}\nAvisar: no`,
  ];
  for (const b of bad) assert.equal(parseMoveBody(b).ok, false, b);
});

test("G5: update_event passes only for a released move salida with exactly its eventId and times", async () => {
  const mesa = mesaWith(salida());
  assert.equal(await rule(run(lead, UPDATE, call, mesa.fetchImpl)), null);
  // seconds are optional
  assert.equal(await rule(run(lead, UPDATE, { ...call, startTime: "2026-11-13T11:00", endTime: "2026-11-13T11:30" }, mesa.fetchImpl)), null);
  assert.equal(await rule(run(lead, UPDATE, { ...call, calendarId: "primary", notificationLevel: "ALL" }, mesa.fetchImpl)), null);
  // an empty value of an allowed key means "the default"; undefined is absent
  assert.equal(await rule(run(lead, UPDATE, { ...call, calendarId: "", notificationLevel: "" }, mesa.fetchImpl)), null);
  assert.equal(await rule(run(lead, UPDATE, { ...call, summary: undefined }, mesa.fetchImpl)), null);
  // patch_event is the same gate
  assert.equal(await rule(run(lead, "mcp__claude_ai_Google_Calendar__patch_event", call, mesa.fetchImpl)), null);
  // the full salida is fetched when the list does not carry the approved body
  const lean = { ...salida(), versions: undefined, approvedVersion: undefined };
  const lazy = fakeMesa({ "GET /api/salidas?status=sending": { salidas: [lean] }, "GET /api/salidas/sa_mv1": { salida: salida() } });
  assert.equal(await rule(run(lead, UPDATE, call, lazy.fetchImpl)), null);
});

test("G5: a different eventId or different times are refused and say what differs", async () => {
  const mesa = mesaWith(salida());
  const cases = [
    [{ ...call, eventId: "otherevent123" }, /eventId/],
    [{ ...call, eventId: undefined }, /eventId/],
    [{ ...call, startTime: "2026-11-13T12:00:00" }, /startTime/],
    [{ ...call, endTime: "2026-11-13T12:00:00" }, /endTime/],
    [{ ...call, startTime: "2026-11-13T11:00:00-04:00" }, /startTime: must be a local time/],
    [{ ...call, startTime: "garbage" }, /startTime/],
    [{ ...call, calendarId: "boss@example.com" }, /calendar: approved primary/],
    [{ ...call, timeZone: "America/New_York" }, /time zone/],
  ];
  for (const [input, re] of cases) {
    const r = await run(lead, UPDATE, input, mesa.fetchImpl);
    assert.equal(r?.rule, "G5", JSON.stringify(input));
    assert.match(r.reason, re);
    assert.match(r.reason, /sa_mv1/);
  }
});

test("G5: both times are required, and a time with no offset needs the approved timeZone", async () => {
  const mesa = mesaWith(salida());
  const { endTime, ...noEnd } = call;
  const { startTime, ...noStart } = call;
  const { timeZone, ...noZone } = call;
  const mixed = { ...call, startTime: "2026-11-13T11:00:00-05:00" };
  for (const [input, re] of [[noEnd, /endTime: required/], [noStart, /startTime: required/], [{ eventId: ID }, /startTime: required/], [noZone, /timeZone: required/], [mixed, /startTime: must be a local time/]]) {
    const r = await run(lead, UPDATE, input, mesa.fetchImpl);
    assert.equal(r?.rule, "G5", JSON.stringify(input));
    assert.match(r.reason, re);
  }
});

test("G5: times with an offset or Z, or in a loose format, are refused (the connector reads the wall clock in timeZone)", async () => {
  const mesa = mesaWith(salida());
  const loose = [
    "2026-11-13T16:00:00Z", // the right instant, but with timeZone Bogota the connector would read 16:00 Bogota
    "2026-11-13T11:00:00-05:00", // same instant as approved, offset form
    "2026-11-13T11:00:00.000Z",
    "Fri Nov 13 2026 11:00:00 GMT-0500",
    "2026-11-13 11:00:00",
    "2026-11-13",
    "11:00",
    "2026-02-31T11:00:00",
  ];
  for (const t of loose) {
    for (const input of [{ ...call, startTime: t }, { ...call, endTime: t }, { eventId: ID, startTime: t, endTime: t }]) {
      const r = await run(lead, UPDATE, input, mesa.fetchImpl);
      assert.equal(r?.rule, "G5", `${t} ${JSON.stringify(input)}`);
    }
  }
  const r = await run(lead, UPDATE, { ...call, startTime: "2026-11-13T16:00:00Z", endTime: "2026-11-13T16:30:00Z" }, mesa.fetchImpl);
  assert.match(r.reason, /local time/);
});

test("G5: any parameter outside eventId, calendarId, startTime, endTime, timeZone, notificationLevel is refused", async () => {
  const mesa = mesaWith(salida());
  const extra = {
    summary: "New title",
    description: "x",
    location: "Sala 2",
    colorId: "5",
    visibility: "private",
    availability: "AVAILABILITY_FREE",
    addGoogleMeetUrl: true,
    googleMeetUrl: "https://meet.google.com/x",
    addedAttendees: [{ email: "boss@example.com" }],
    addedAttendeeEmails: ["boss@example.com"],
    removedAttendeeEmails: ["mike@drugimpairment.com"],
    addedAttachments: [{ fileUrl: "https://x" }],
    guestPermissions: { guestsCanModify: false },
    overrideReminders: [{ method: "popup", minutes: 5 }],
    allDay: true,
    recurrenceData: ["RRULE:FREQ=DAILY"],
    sendUpdates: "none",
    start: "2026-11-13T11:00:00",
    attendees: ["a@b.co"],
  };
  for (const [k, v] of Object.entries(extra)) {
    const r = await run(lead, UPDATE, { ...call, [k]: v }, mesa.fetchImpl);
    assert.equal(r?.rule, "G5", k);
    assert.match(r.reason, new RegExp(`parameter not in the approved move: ${k}`));
  }
  // false AND the empty values are values for an unknown parameter (lesson #4073): an empty summary, location or
  // googleMeetUrl can clear the field on the client's event
  for (const k of ["summary", "description", "location", "googleMeetUrl", "colorId", "addedAttendees", "removedAttendeeEmails", "addedAttachments", "guestPermissions", "overrideReminders"]) {
    for (const empty of ["", null, [], {}]) {
      const r = await run(lead, UPDATE, { ...call, [k]: empty }, mesa.fetchImpl);
      assert.equal(r?.rule, "G5", `${k}=${JSON.stringify(empty)}`);
      assert.match(r.reason, new RegExp(`parameter not in the approved move: ${k}`));
    }
  }
  for (const k of ["allDay", "useDefaultReminders", "guestsCanModify"]) assert.equal(await rule(run(lead, UPDATE, { ...call, [k]: false }, mesa.fetchImpl)), "G5", k);
});

test("G5: notificationLevel must agree with Avisar", async () => {
  const yes = mesaWith(salida());
  for (const level of [undefined, "ALL", "NOTIFICATION_LEVEL_ALL"]) assert.equal(await rule(run(lead, UPDATE, { ...call, notificationLevel: level }, yes.fetchImpl)), null, String(level));
  for (const level of ["NONE", "EXTERNAL_ONLY", "NOTIFICATION_LEVEL_UNSPECIFIED", "all", false]) {
    const r = await run(lead, UPDATE, { ...call, notificationLevel: level }, yes.fetchImpl);
    assert.equal(r?.rule, "G5", String(level));
    assert.match(r.reason, /notificationLevel/);
  }
  const quiet = mesaWith(salida({ versions: [{ n: 1, body: BODY_QUIET }] }));
  for (const level of ["NONE", "NOTIFICATION_LEVEL_NONE"]) assert.equal(await rule(run(lead, UPDATE, { ...call, notificationLevel: level }, quiet.fetchImpl)), null, level);
  for (const level of [undefined, "ALL", "EXTERNAL_ONLY", "NOTIFICATION_LEVEL_UNSPECIFIED"]) {
    const r = await run(lead, UPDATE, { ...call, notificationLevel: level }, quiet.fetchImpl);
    assert.equal(r?.rule, "G5", String(level));
    assert.match(r.reason, /Avisar no/);
  }
});

test("G5: no matching move salida refuses update_event", async () => {
  const create = salida({ versions: [{ n: 1, body: ["Título: Meet con Matt", "Inicio: 2026-11-13T11:00:00-05:00", "Fin: 2026-11-13T11:30:00-05:00", "Zona: America/Bogota", "Meet: no"].join("\n") }] });
  for (const s of [salida({ releasedAt: null }), salida({ sentAt: "2026-11-12T20:31:00Z" }), salida({ isSample: true }), salida({ source: "slack" }), create]) {
    assert.equal(await rule(run(lead, UPDATE, call, mesaWith(s).fetchImpl)), "G5");
  }
  assert.equal(await rule(run(lead, UPDATE, call, mesaWith().fetchImpl)), "G5");
  const r = await run(lead, UPDATE, call, unreachable);
  assert.equal(r?.rule, "G5");
  assert.match(r.reason, /unreachable/);
  // a move salida never authorizes create_event
  const created = { summary: "Weekly Check-In", start: "2026-11-13T11:00:00-05:00", end: "2026-11-13T11:30:00-05:00" };
  assert.equal(await rule(run(lead, "mcp__claude_ai_Google_Calendar__create_event", created, mesaWith(salida()).fetchImpl)), "G5");
});

test("G5: the other Google Calendar writes stay refused, even with a released move salida; G4 holds for teammates", async () => {
  const mesa = mesaWith(salida());
  for (const t of ["delete_event", "respond_to_event", "move_event"]) {
    assert.equal(await rule(run(lead, `mcp__claude_ai_Google_Calendar__${t}`, call, mesa.fetchImpl)), "G5", t);
  }
  assert.equal(await rule(run(mate(), UPDATE, call, mesa.fetchImpl)), "G4");
  assert.equal(await rule(run(mate(), "mcp__claude_ai_Google_Calendar__patch_event", call, mesa.fetchImpl)), "G4");
});

test("mismatches: an exact call has none; a second salida can be the match", async () => {
  const ok = parseMoveBody(BODY).fields;
  assert.deepEqual(moveMismatches(ok, call, {}), []);
  const other = salida({ id: "sa_mv2", versions: [{ n: 1, body: BODY.replace(ID, "anotherevent999").replace("T11:", "T14:") }] });
  assert.equal(await rule(run(lead, UPDATE, call, mesaWith(other, salida()).fetchImpl)), null);
});
