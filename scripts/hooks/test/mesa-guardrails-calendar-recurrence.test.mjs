// Hook G5 and recurring events (t128): parseEventBody / parseRrule on the same samples as src/lib/domain/calendar-event.test.ts,
// the connector's `recurrenceData`, the Meet flag `addGoogleMeetUrl`, and the refused parameters of create_event.
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../mesa-guardrails.mjs";
import { eventFromCall, eventMismatches, parseEventBody, parseRrule } from "../calendar-body.mjs";
import { fakeMesa, unreachable } from "./helpers.mjs";

const lead = { transcript_path: "C:/x/sess.jsonl", session_id: "sess" };
const CREATE = "mcp__claude_ai_Google_Calendar__create_event";
const run = (tool_input, mesa) => check({ ...lead, tool_name: CREATE, tool_input }, { fetchImpl: mesa?.fetchImpl ?? unreachable });

// The DRE weekly: Wednesdays 16:00-16:30 Bogota from 2026-11-18 (a Wednesday).
const RULE = "RRULE:FREQ=WEEKLY;BYDAY=WE";
const lines = (over = {}) => {
  const f = { title: "DRE Central & Designli Weekly Check-In", start: "2026-11-18T16:00:00-05:00", end: "2026-11-18T16:30:00-05:00", zone: "America/Bogota", guests: "matt.r@scoutapp.example, mike@scoutapp.example", meet: "sí", rule: RULE, ...over };
  return [`Título: ${f.title}`, `Inicio: ${f.start}`, `Fin: ${f.end}`, `Zona: ${f.zone}`, `Invitados: ${f.guests}`, `Meet: ${f.meet}`, ...(f.rule === null ? [] : [`Repetir: ${f.rule}`]), ...(f.description ? [`Descripción: ${f.description}`] : [])].join("\n");
};
const DRE = lines();

const salida = (body, over = {}) => ({
  id: "sa_dre",
  source: "calendar",
  releasedAt: "2026-11-17T20:30:00Z",
  approvedVersion: 1,
  versions: [{ n: 1, body }],
  destination: { kind: "calendar_event", calendar: "primary", postAs: "Andrés" },
  ...over,
});
const mesaWith = (body) => fakeMesa({ "GET /api/salidas?status=sending": { salidas: [salida(body)] } });

// The call the lead makes for the DRE sample: local times without offset, the zone on top, the series, the Meet flag.
const dreCall = {
  summary: "DRE Central & Designli Weekly Check-In",
  startTime: "2026-11-18T16:00:00",
  endTime: "2026-11-18T16:30:00",
  timeZone: "America/Bogota",
  attendees: ["matt.r@scoutapp.example", "mike@scoutapp.example"],
  addGoogleMeetUrl: true,
  recurrenceData: [RULE],
};
const rule = async (p) => (await p)?.rule ?? null;
const omit = (o, k) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));

// ---------- the body ----------

test("parseEventBody: the DRE sample parses, with the recurrence, and a body without Repetir has no recurrence key", () => {
  const p = parseEventBody(DRE);
  assert.equal(p.ok, true);
  assert.deepEqual(p.fields, {
    title: "DRE Central & Designli Weekly Check-In",
    start: "2026-11-18T16:00:00-05:00",
    end: "2026-11-18T16:30:00-05:00",
    timeZone: "America/Bogota",
    invitees: ["matt.r@scoutapp.example", "mike@scoutapp.example"],
    meet: true,
    recurrence: RULE,
    description: "",
  });
  const plain = parseEventBody(lines({ rule: null }));
  assert.equal(plain.ok, true);
  assert.equal("recurrence" in plain.fields, false);
  assert.equal(parseEventBody(lines({ description: "Weekly.\nAgenda en Basecamp." })).fields.description, "Weekly.\nAgenda en Basecamp.");
  assert.equal(parseEventBody(DRE.replace("Repetir:", "repetir:")).fields.recurrence, RULE);
});

const REFUSALS = [
  ["debe empezar por RRULE:", "FREQ=WEEKLY;BYDAY=WE"],
  ["debe empezar por RRULE:", "rrule:FREQ=WEEKLY;BYDAY=WE"],
  ["debe empezar por RRULE:", ""],
  ["mayúsculas", "RRULE:freq=weekly;byday=we"],
  ["necesita FREQ", "RRULE:BYDAY=WE"],
  ["FREQ debe ser", "RRULE:FREQ=HOURLY"],
  ["no admite «BYSETPOS»", "RRULE:FREQ=MONTHLY;BYSETPOS=1;BYDAY=WE"],
  ["no admite «BYHOUR»", "RRULE:FREQ=DAILY;BYHOUR=9"],
  ["repite «FREQ»", "RRULE:FREQ=WEEKLY;FREQ=DAILY"],
  ["repite «BYDAY»", "RRULE:FREQ=WEEKLY;BYDAY=WE;BYDAY=TH"],
  ["parte inválida", "RRULE:FREQ=WEEKLY;"],
  ["parte inválida", "RRULE:FREQ=WEEKLY;BYDAY"],
  ["INTERVAL debe ser", "RRULE:FREQ=WEEKLY;INTERVAL=0"],
  ["INTERVAL debe ser", "RRULE:FREQ=WEEKLY;INTERVAL=-2"],
  ["INTERVAL debe ser", "RRULE:FREQ=WEEKLY;INTERVAL=1.5"],
  ["COUNT debe ser", "RRULE:FREQ=WEEKLY;COUNT=0"],
  ["COUNT debe ser", "RRULE:FREQ=WEEKLY;COUNT=1O"],
  ["BYDAY debe ser", "RRULE:FREQ=WEEKLY;BYDAY=XX"],
  ["BYDAY debe ser", "RRULE:FREQ=WEEKLY;BYDAY=WE,WE"],
  ["BYMONTHDAY debe ser", "RRULE:FREQ=MONTHLY;BYMONTHDAY=0"],
  ["BYMONTHDAY debe ser", "RRULE:FREQ=MONTHLY;BYMONTHDAY=32"],
  ["BYMONTH debe ser", "RRULE:FREQ=YEARLY;BYMONTH=13"],
  ["WKST debe ser", "RRULE:FREQ=WEEKLY;WKST=XX"],
  ["COUNT y UNTIL", "RRULE:FREQ=WEEKLY;COUNT=4;UNTIL=20261231"],
  ["UNTIL debe ser YYYYMMDD", "RRULE:FREQ=WEEKLY;UNTIL=2026-12-31"],
  ["UNTIL debe ser YYYYMMDD", "RRULE:FREQ=WEEKLY;UNTIL=20261331"],
  ["UNTIL debe ser YYYYMMDD", "RRULE:FREQ=WEEKLY;UNTIL=20261231T100000"],
  ["UNTIL debe ser después", "RRULE:FREQ=WEEKLY;UNTIL=20261118"],
  ["UNTIL debe ser después", "RRULE:FREQ=WEEKLY;UNTIL=20261101"],
  ["UNTIL debe ser después", "RRULE:FREQ=WEEKLY;UNTIL=20261118T203000Z"],
  ["empieza un WE", "RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
  ["empieza el día 18 del mes", "RRULE:FREQ=MONTHLY;BYMONTHDAY=5"],
  ["empieza el día 18 del mes", "RRULE:FREQ=MONTHLY;BYMONTHDAY=5,20"],
];

test("parseEventBody: every refusal of the TS parser is a refusal here, with the same Spanish problem", () => {
  for (const [problem, r] of REFUSALS) {
    const p = parseEventBody(lines({ rule: r }));
    assert.equal(p.ok, false, r);
    assert.ok(p.problem.includes(problem), `${r}: ${p.problem}`);
  }
});

test("parseEventBody: the rules a calendar series needs are accepted", () => {
  for (const r of [
    RULE,
    "RRULE:FREQ=WEEKLY",
    "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=MO",
    "RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=10",
    "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261218",
    "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261219T045959Z",
    "RRULE:FREQ=DAILY;INTERVAL=3",
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=18",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=18",
  ])
    assert.equal(parseEventBody(lines({ rule: r })).ok, true, r);
});

test("parseEventBody: the weekday and the day of the month are read in the event zone, not in UTC", () => {
  // 20:00 Bogota on a Wednesday the 18th is already Thursday the 19th in UTC.
  const late = { start: "2026-11-18T20:00:00-05:00", end: "2026-11-18T20:30:00-05:00" };
  assert.equal(parseEventBody(lines({ ...late, rule: RULE })).ok, true);
  assert.match(parseEventBody(lines({ ...late, rule: "RRULE:FREQ=WEEKLY;BYDAY=TH" })).problem, /empieza un WE/);
  assert.equal(parseEventBody(lines({ ...late, rule: "RRULE:FREQ=MONTHLY;BYMONTHDAY=5,18,25" })).ok, true);
  assert.match(parseEventBody(lines({ ...late, rule: "RRULE:FREQ=MONTHLY;BYMONTHDAY=19" })).problem, /empieza el día 18 del mes/);
  // a MONTHLY rule without BYMONTHDAY, a YEARLY one and a non-weekly BYDAY are not checked against the start
  for (const r of ["RRULE:FREQ=MONTHLY", "RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=8", "RRULE:FREQ=MONTHLY;BYDAY=MO"]) assert.equal(parseEventBody(lines({ ...late, rule: r })).ok, true, r);
});

test("parseRrule: with no start it checks the shape only", () => {
  assert.equal(parseRrule("RRULE:FREQ=WEEKLY;BYDAY=WE").ok, true);
  assert.equal(parseRrule("RRULE:FREQ=WEEKLY;UNTIL=20200101").ok, true);
  assert.equal(parseRrule("RRULE:FREQ=WEEKLY;COUNT=2;UNTIL=20200101").ok, false);
});

// ---------- the connector call: recurrenceData ----------

test("G5: the DRE series passes: local startTime/endTime + timeZone, recurrenceData exactly the approved rule, addGoogleMeetUrl", async () => {
  assert.equal(await rule(run(dreCall, mesaWith(DRE))), null);
  const f = eventFromCall(dreCall);
  assert.equal(f.start, Date.parse("2026-11-18T21:00:00Z"));
  assert.equal(f.end, Date.parse("2026-11-18T21:30:00Z"));
  assert.deepEqual(f.recurrence, [RULE]);
  assert.equal(f.meet, true);
  assert.deepEqual(eventMismatches(parseEventBody(DRE).fields, f), []);
});

test("G5: the local times are resolved in the zone: the same wall clock in another zone is another instant", async () => {
  const r = await run({ ...dreCall, timeZone: "America/New_York" }, mesaWith(DRE));
  assert.equal(r?.rule, "G5");
  assert.match(r.reason, /time zone: approved America\/Bogota, call America\/New_York/);
  const r2 = await run({ ...dreCall, startTime: "2026-11-18T15:30:00", endTime: "2026-11-18T16:00:00" }, mesaWith(DRE));
  assert.match(r2.reason, /start: approved 2026-11-18T16:00:00-05:00/);
});

test("G5: a recurrenceData that is not exactly the approved rule is refused and says what differs", async () => {
  const mesa = mesaWith(DRE);
  const cases = [
    [{ ...dreCall, recurrenceData: ["RRULE:FREQ=WEEKLY;BYDAY=TH"] }, /recurrence: approved \[«RRULE:FREQ=WEEKLY;BYDAY=WE»\], call recurrenceData \[«RRULE:FREQ=WEEKLY;BYDAY=TH»\]/],
    [{ ...dreCall, recurrenceData: [RULE, "RRULE:FREQ=DAILY"] }, /recurrence/],
    [{ ...dreCall, recurrenceData: [RULE, "RDATE;VALUE=DATE:20261225"] }, /recurrence/],
    [{ ...dreCall, recurrenceData: [RULE, "EXDATE;TZID=America/Bogota:20261125T160000"] }, /recurrence/],
    [{ ...dreCall, recurrenceData: ["RDATE;VALUE=DATE:20261225"] }, /recurrence/],
    [{ ...dreCall, recurrenceData: [`${RULE} `] }, /recurrence/], // byte for byte: no trailing space
    [{ ...dreCall, recurrenceData: [RULE.toLowerCase()] }, /recurrence/],
    [{ ...dreCall, recurrenceData: [RULE, RULE] }, /recurrence/],
    [{ ...dreCall, recurrenceData: [""] }, /recurrence/],
    [{ ...dreCall, recurrenceData: RULE }, /recurrenceData must be an array of strings/],
    [{ ...dreCall, recurrenceData: [{ rrule: RULE }] }, /recurrenceData must be an array of strings/],
    [omit(dreCall, "recurrenceData"), /recurrence: approved \[«RRULE:FREQ=WEEKLY;BYDAY=WE»\], call recurrenceData \[none\]/],
    [{ ...dreCall, recurrenceData: [] }, /call recurrenceData \[none\]/],
  ];
  for (const [input, re] of cases) {
    const r = await run(input, mesa);
    assert.equal(r?.rule, "G5", JSON.stringify(input.recurrenceData));
    assert.match(r.reason, re);
    assert.match(r.reason, /sa_dre/);
  }
});

test("G5: a recurrenceData on an event approved without Repetir is refused", async () => {
  const single = lines({ rule: null, start: "2026-11-18T16:00:00-05:00" });
  const noSeries = omit(dreCall, "recurrenceData");
  assert.equal(await rule(run(noSeries, mesaWith(single))), null);
  for (const rd of [[RULE], ["RDATE;VALUE=DATE:20261225"], [""]]) {
    const r = await run({ ...noSeries, recurrenceData: rd }, mesaWith(single));
    assert.equal(r?.rule, "G5", JSON.stringify(rd));
    assert.match(r.reason, /recurrence: approved \[none\]/);
  }
  assert.equal(await rule(run({ ...noSeries, recurrenceData: [] }, mesaWith(single))), null); // an empty list says nothing
});

test("G5: any other recurrence alias is an unknown parameter and is refused", async () => {
  const mesa = mesaWith(DRE);
  for (const k of ["recurrence", "recurrenceRule", "rrule", "recurrence_data", "recurrenceRules", "repeat"]) {
    const r = await run({ ...dreCall, [k]: [RULE] }, mesa);
    assert.equal(r?.rule, "G5", k);
    assert.match(r.reason, new RegExp(`parameter not in the approved event: ${k}`));
  }
});

// ---------- the Meet flag ----------

test("G5: addGoogleMeetUrl is the Meet flag: true passes for Meet sí, true fails for Meet no, false passes for Meet no", async () => {
  assert.equal(await rule(run(dreCall, mesaWith(DRE))), null);
  const no = lines({ meet: "no" });
  const r = await run({ ...dreCall, addGoogleMeetUrl: true }, mesaWith(no));
  assert.equal(r?.rule, "G5");
  assert.match(r.reason, /Google Meet: approved no, call yes/);
  assert.equal(await rule(run({ ...dreCall, addGoogleMeetUrl: false }, mesaWith(no))), null);
  const none = omit(dreCall, "addGoogleMeetUrl");
  assert.equal(await rule(run(none, mesaWith(no))), null);
  const missing = await run(none, mesaWith(DRE));
  assert.match(missing.reason, /Google Meet: approved yes, call no/);
  const off = await run({ ...dreCall, addGoogleMeetUrl: false }, mesaWith(DRE));
  assert.match(off.reason, /Google Meet: approved yes, call no/);
});

test("G5: addGoogleMeetUrl is read as the Meet flag, other spellings still are, and meetingNotes is not", () => {
  assert.equal(eventFromCall({ title: "x", addGoogleMeetUrl: true }).meet, true);
  assert.equal(eventFromCall({ title: "x", addGoogleMeetUrl: false }).meet, false);
  assert.deepEqual(eventFromCall({ title: "x", addGoogleMeetUrl: true }).problems, []);
  for (const k of ["addGoogleMeet", "add_google_meet_url", "withMeet", "conferenceData"]) assert.equal(eventFromCall({ title: "x", [k]: true }).meet, true, k);
  assert.match(eventFromCall({ title: "x", meetingNotes: "x" }).problems.join(), /parameter not in the approved event: meetingNotes/);
});

test("G5: googleMeetUrl with a value is refused in every case", async () => {
  const URL_ = "https://meet.google.com/abc-defg-hij";
  const no = lines({ meet: "no" });
  const bare = omit(dreCall, "addGoogleMeetUrl");
  const cases = [
    [{ ...dreCall, googleMeetUrl: URL_ }, DRE], // flag true and a URL, Meet sí
    [{ ...bare, googleMeetUrl: URL_ }, DRE], // URL alone, Meet sí
    [{ ...dreCall, addGoogleMeetUrl: false, googleMeetUrl: URL_ }, DRE],
    [{ ...bare, googleMeetUrl: URL_ }, no], // Meet no
    [{ ...dreCall, addGoogleMeetUrl: false, googleMeetUrl: URL_ }, no],
    [{ ...dreCall, googleMeetUrl: "abc-defg-hij" }, DRE], // a meeting id
    [{ ...dreCall, googleMeetUrl: false }, DRE], // false is a setting too
  ];
  for (const [input, body] of cases) {
    const r = await run(input, mesaWith(body));
    assert.equal(r?.rule, "G5", JSON.stringify(input.googleMeetUrl));
    assert.match(r.reason, /googleMeetUrl .* is not part of the approved event/);
  }
  // empty says nothing
  for (const v of [undefined, null, ""]) assert.equal(await rule(run({ ...dreCall, googleMeetUrl: v }, mesaWith(DRE))), null, String(v));
  // the snake spelling too
  assert.equal((await run({ ...dreCall, google_meet_url: URL_ }, mesaWith(DRE)))?.rule, "G5");
});

// ---------- parameters that stay refused ----------

test("G5: every create_event parameter outside the approved event stays refused", async () => {
  const mesa = mesaWith(DRE);
  const refused = {
    attachments: [{ fileUrl: "https://example.com/a.pdf" }],
    availability: "free",
    colorId: "5",
    eventType: "focusTime",
    guestPermissions: { guestsCanModify: true },
    location: "Sala 2",
    notificationLevel: "NONE",
    overrideReminders: [{ method: "popup", minutes: 5 }],
    useDefaultReminders: false,
    visibility: "private",
    allDay: true,
  };
  for (const [k, v] of Object.entries(refused)) {
    const r = await run({ ...dreCall, [k]: v }, mesa);
    assert.equal(r?.rule, "G5", k);
    assert.match(r.reason, new RegExp(`parameter not in the approved event: ${k}`));
  }
  // allDay false is still a setting; empty values say nothing
  assert.equal((await run({ ...dreCall, allDay: false }, mesa))?.rule, "G5");
  assert.equal(await rule(run({ ...dreCall, location: "", attachments: [], guestPermissions: {}, colorId: null }, mesa)), null);
});

test("G5: Mesa unreachable still blocks a series", async () => {
  const r = await run(dreCall, undefined);
  assert.equal(r?.rule, "G5");
  assert.match(r.reason, /unreachable/);
});
