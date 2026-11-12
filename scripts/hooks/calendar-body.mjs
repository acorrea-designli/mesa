// Hook G5 for Google Calendar (t112): what a released calendar salida approved, and whether a connector call is exactly
// that. A calendar salida's approved version body IS the event (src/lib/domain/calendar-event.ts, the same format):
//
//   Título: Meet con Matt
//   Inicio: 2026-11-12T10:00:00-05:00
//   Fin: 2026-11-12T10:30:00-05:00
//   Zona: America/Bogota
//   Invitados: matt.r@scoutapp.example
//   Meet: sí
//   Repetir: RRULE:FREQ=WEEKLY;BYDAY=WE                  (optional, t128: a series)
//   Descripción: free text, to the end
//
// Plain JS on purpose: the hooks are standalone .mjs files with no build step. parseEventBody and parseRrule here and
// in the TS domain file must stay in step (both are tested on the same samples).
//
// The connector call (Google Calendar create_event): a series is `recurrenceData`, an array of strings (RRULE, RDATE,
// EXDATE); it passes only when it is EXACTLY ["<the approved Repetir text>"], and a call with none passes only when no
// Repetir was approved. The Meet flag is `addGoogleMeetUrl` (boolean); `googleMeetUrl` (a specific URL or meeting id,
// it overrides the flag) is never part of an approved event. Times are `startTime`/`endTime` local without offset plus a
// top-level `timeZone`, resolved in that zone.

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;
const KEYS = ["título", "inicio", "fin", "zona", "invitados", "meet", "repetir", "descripción"];
const norm = (s) => s.normalize("NFC").toLowerCase();

const validZone = (tz) => {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** { ok: true, fields } or { ok: false, problem }. */
export function parseEventBody(body) {
  const got = {};
  const lines = String(body ?? "").replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([^:]+):\s*(.*)$/.exec(lines[i]);
    if (!m) {
      if (lines[i].trim()) return { ok: false, problem: `línea sin campo: «${lines[i].trim().slice(0, 40)}»` };
      continue;
    }
    const key = norm(m[1].trim());
    if (!KEYS.includes(key)) return { ok: false, problem: `campo desconocido: «${m[1].trim()}»` };
    if (key in got) return { ok: false, problem: `campo repetido: «${m[1].trim()}»` };
    if (key === "descripción") {
      got[key] = [m[2], ...lines.slice(i + 1)].join("\n").trim();
      break;
    }
    got[key] = m[2].trim();
  }
  const title = got["título"];
  if (!title) return { ok: false, problem: "falta el título" };
  const start = got["inicio"];
  const end = got["fin"];
  if (!start || !ISO.test(start) || Number.isNaN(Date.parse(start))) return { ok: false, problem: "el inicio debe ser una fecha ISO con zona" };
  if (!end || !ISO.test(end) || Number.isNaN(Date.parse(end))) return { ok: false, problem: "el fin debe ser una fecha ISO con zona" };
  if (Date.parse(end) <= Date.parse(start)) return { ok: false, problem: "el fin debe ser después del inicio" };
  const timeZone = got["zona"];
  if (!validZone(timeZone)) return { ok: false, problem: "la zona debe ser una zona IANA" };
  const invitees = (got["invitados"] ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const e of invitees) if (!EMAIL.test(e)) return { ok: false, problem: `invitado inválido: «${e}»` };
  const meetRaw = norm(got["meet"] ?? "");
  if (meetRaw !== "sí" && meetRaw !== "si" && meetRaw !== "no") return { ok: false, problem: "Meet debe ser sí o no" };
  let recurrence;
  if ("repetir" in got) {
    const r = parseRrule(got["repetir"], { start, timeZone });
    if (!r.ok) return { ok: false, problem: r.problem };
    recurrence = got["repetir"];
  }
  const description = got["descripción"] ?? "";
  return { ok: true, fields: { title, start, end, timeZone, invitees, meet: meetRaw !== "no", ...(recurrence ? { recurrence } : {}), description } };
}

// ---------- recurrence (t128): the same strict rules as parseRrule in src/lib/domain/calendar-event.ts ----------

const FREQS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const PART_KEYS = ["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "UNTIL", "WKST"];
const UINT = /^[1-9]\d{0,5}$/;
const UNTIL_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/;
const bad = (problem) => ({ ok: false, problem });

// The start's local date (YYYYMMDD), weekday index (0 = MO) and day of the month in `tz`.
function localStart(start, tz) {
  const ms = Date.parse(start);
  const local = new Date(ms + offsetAt(ms, tz)).toISOString().slice(0, 10);
  const wd = (new Date(`${local}T00:00:00Z`).getUTCDay() + 6) % 7;
  return { ymd: local.replace(/-/g, ""), wd, day: Number(local.slice(8, 10)) };
}

function validUntil(u) {
  const m = UNTIL_RE.exec(u);
  if (!m) return { ok: false, ms: 0 };
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const dt = new Date(ms);
  const ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && h < 24 && mi < 60 && s < 60;
  return { ok, ms };
}

/** { ok: true, rule } or { ok: false, problem }; `at` ({ start, timeZone }) also checks UNTIL, WEEKLY/BYDAY and MONTHLY/BYMONTHDAY against the start. */
export function parseRrule(raw, at) {
  raw = String(raw ?? "");
  if (!raw.startsWith("RRULE:")) return bad("Repetir debe empezar por RRULE:, p. ej. RRULE:FREQ=WEEKLY;BYDAY=WE");
  const body = raw.slice("RRULE:".length);
  if (body !== body.toUpperCase()) return bad("Repetir debe ir en mayúsculas");
  if (!body) return bad("Repetir está vacío: falta FREQ");
  const seen = {};
  for (const part of body.split(";")) {
    const m = /^([A-Z]+)=([^=;]+)$/.exec(part);
    if (!m) return bad(`Repetir tiene una parte inválida: «${part.slice(0, 40)}»`);
    const [, k, v] = m;
    if (!PART_KEYS.includes(k)) return bad(`Repetir no admite «${k}»; solo ${PART_KEYS.join(", ")}`);
    if (k in seen) return bad(`Repetir repite «${k}»`);
    seen[k] = v;
  }
  const freq = seen["FREQ"];
  if (!freq) return bad("Repetir necesita FREQ");
  if (!FREQS.includes(freq)) return bad(`Repetir: FREQ debe ser ${FREQS.join(", ")}`);
  const posInt = (key) => (key in seen ? (UINT.test(seen[key]) ? Number(seen[key]) : "bad") : undefined);
  const interval = posInt("INTERVAL");
  if (interval === "bad") return bad("Repetir: INTERVAL debe ser un entero positivo");
  const count = posInt("COUNT");
  if (count === "bad") return bad("Repetir: COUNT debe ser un entero positivo");
  const list = (key, min, max) => {
    if (!(key in seen)) return [];
    const nums = [];
    for (const s of seen[key].split(",")) {
      if (!UINT.test(s) || Number(s) < min || Number(s) > max) return "bad";
      nums.push(Number(s));
    }
    return new Set(nums).size === nums.length ? nums : "bad";
  };
  const byMonthDay = list("BYMONTHDAY", 1, 31);
  if (byMonthDay === "bad") return bad("Repetir: BYMONTHDAY debe ser enteros positivos de 1 a 31, sin repetir");
  const byMonth = list("BYMONTH", 1, 12);
  if (byMonth === "bad") return bad("Repetir: BYMONTH debe ser enteros positivos de 1 a 12, sin repetir");
  let byDay = [];
  if ("BYDAY" in seen) {
    byDay = seen["BYDAY"].split(",");
    if (byDay.some((d) => !DAYS.includes(d)) || new Set(byDay).size !== byDay.length) return bad(`Repetir: BYDAY debe ser días ${DAYS.join(", ")}, sin repetir`);
  }
  const wkst = seen["WKST"];
  if (wkst !== undefined && !DAYS.includes(wkst)) return bad(`Repetir: WKST debe ser ${DAYS.join(", ")}`);
  if ("COUNT" in seen && "UNTIL" in seen) return bad("Repetir no puede tener COUNT y UNTIL a la vez");
  const ls = at ? localStart(at.start, at.timeZone) : null;
  const until = seen["UNTIL"];
  if (until !== undefined) {
    const u = validUntil(until);
    if (!u.ok) return bad("Repetir: UNTIL debe ser YYYYMMDD o YYYYMMDDTHHMMSSZ");
    const after = !at || !ls || (until.length === 8 ? until > ls.ymd : u.ms > Date.parse(at.start));
    if (!after) return bad("Repetir: UNTIL debe ser después del inicio del evento");
  }
  if (ls && freq === "WEEKLY" && byDay.length && !byDay.includes(DAYS[ls.wd])) return bad(`Repetir: el evento empieza un ${DAYS[ls.wd]}, que debe estar en BYDAY`);
  if (ls && freq === "MONTHLY" && byMonthDay.length && !byMonthDay.includes(ls.day)) return bad(`Repetir: el evento empieza el día ${ls.day} del mes, que debe estar en BYMONTHDAY`);
  return { ok: true, rule: { freq, interval: interval ?? 1, byDay, byMonthDay, byMonth, ...(count !== undefined ? { count } : {}), ...(until !== undefined ? { until } : {}), ...(wkst !== undefined ? { wkst } : {}) } };
}

// ---------- the connector call ----------

// The first alias that SAYS something: it skips exactly what isEmpty skips, so an empty alias never hides a second one.
const pick = (o, ...keys) => {
  for (const k of keys) if (!isEmpty(o?.[k])) return o[k];
  return undefined;
};

const offsetAt = (ms, tz) => {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};

// A time the connector got as an instant: an ISO with an offset or Z is exact; one without is wall-clock time in `tz`.
function instantOf(v, tz) {
  if (v && typeof v === "object") return instantOf(pick(v, "dateTime", "date_time", "iso", "value", "date"), tz ?? pick(v, "timeZone", "time_zone", "timezone"));
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const ms = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    return Number.isNaN(ms) ? null : ms;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m || !validZone(tz)) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  const t1 = guess - offsetAt(guess, tz);
  return guess - offsetAt(t1, tz);
}

const emailsOf = (v) => {
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : String(v).split(",");
  return list.map((x) => (typeof x === "string" ? x : (x?.email ?? x?.address ?? ""))).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
};

const truthyMeet = (v) => {
  if (v === undefined || v === null || v === false) return false;
  if (typeof v === "string") return !["", "false", "no", "none", "0"].includes(v.trim().toLowerCase());
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
};

// The parameters of a create_event call that Mesa knows how to compare, grouped by what they mean. A call may use
// ONE name per group; a second alias, or any parameter outside these groups (recurrence, reminders, another
// calendar's guests alias, conference settings other than the Meet flag, ...) is refused: what is not in the approved
// event must not be in the call.
const GROUPS = {
  title: ["summary", "title", "name", "subject"],
  start: ["start", "startTime", "start_time", "startDateTime", "start_date_time", "start_datetime"],
  end: ["end", "endTime", "end_time", "endDateTime", "end_date_time", "end_datetime"],
  timeZone: ["timeZone", "timezone", "time_zone"],
  attendees: ["attendees", "guests", "invitees", "attendee_emails", "attendeeEmails"],
  description: ["description", "notes", "body"],
  calendar: ["calendarId", "calendar_id", "calendar"],
};
const KNOWN = new Set(Object.values(GROUPS).flat());
// The Google Meet flag under the names a connector may use: `addGoogleMeetUrl` (the Google Calendar connector's own,
// a boolean), and addGoogleMeet, add_google_meet, withMeet, conferenceData, createMeetingRoom, ... Anchored: a key
// that merely contains "meet" (meetingNotes) is an unknown parameter.
const MEET_KEY = /^(?:(?:add|with|create|include|enable|has)[_-]?)?(?:google[_-]?)?(?:meet|meeting[_-]?room|conference)(?:[_-]?(?:data|link|solution|request))?$|^add[_-]?google[_-]?meet[_-]?url$/i;
// `googleMeetUrl` is a specific Meet URL or meeting id and overrides the flag above: an approved event never carries one.
const GOOGLE_MEET_URL = /^google[_-]?meet[_-]?url$/i;
// The series: `recurrenceData`, an array of RRULE / RDATE / EXDATE strings. Any other recurrence alias stays an unknown parameter.
const RECURRENCE_KEY = "recurrenceData";
// The Google API's conferenceDataVersion (0/1) only enables conferenceData: it neither adds nor duplicates a Meet.
const CONFERENCE_VERSION = /^conference[_-]?data[_-]?version$/i;

// A parameter that says nothing (absent, null, "", [], {}, false) does not count as present.
const isEmpty = (v) => v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

// For an UNKNOWN parameter `false` is a setting too (guestsCanInviteOthers: false changes the event), so only a value
// that is unset counts as nothing.
const isUnset = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

/** The fields a create_event call is about to write, read tolerantly from the connector's parameter names, plus `problems`: anything the approved event cannot cover. */
export function eventFromCall(ti) {
  const call = ti ?? {};
  const problems = [];
  const present = (keys) => keys.filter((k) => !isEmpty(call[k]));
  for (const [group, keys] of Object.entries(GROUPS)) {
    const p = present(keys);
    if (p.length > 1) problems.push(`duplicate parameters for ${group}: ${p.join(", ")}`);
  }
  const meetKeys = Object.keys(call).filter((k) => MEET_KEY.test(k));
  if (meetKeys.filter((k) => !isEmpty(call[k])).length > 1) problems.push(`duplicate parameters for Google Meet: ${meetKeys.filter((k) => !isEmpty(call[k])).join(", ")}`);
  for (const k of Object.keys(call)) {
    if (k === RECURRENCE_KEY || KNOWN.has(k) || MEET_KEY.test(k) || CONFERENCE_VERSION.test(k) || isUnset(call[k])) continue;
    problems.push(GOOGLE_MEET_URL.test(k) ? `${k} (a specific Meet URL that overrides the flag) is not part of the approved event` : `parameter not in the approved event: ${k}`);
  }
  // recurrenceData must be an array of strings; what it holds is compared to the approved Repetir in eventMismatches.
  let recurrence = [];
  const rd = call[RECURRENCE_KEY];
  if (!isUnset(rd)) {
    if (!Array.isArray(rd) || rd.some((x) => typeof x !== "string")) problems.push(`${RECURRENCE_KEY} must be an array of strings`);
    else recurrence = [...rd];
  }

  const startRaw = pick(call, ...GROUPS.start);
  const endRaw = pick(call, ...GROUPS.end);
  const tzTop = pick(call, ...GROUPS.timeZone);
  const tzNested = [startRaw, endRaw].map((v) => (v && typeof v === "object" ? pick(v, "timeZone", "time_zone", "timezone") : undefined)).filter(Boolean);
  if (new Set([tzTop, ...tzNested].filter(Boolean)).size > 1) problems.push("the call names different time zones for start, end or timeZone");
  const tz = tzTop ?? tzNested[0];
  return {
    title: String(pick(call, ...GROUPS.title) ?? "").trim(),
    start: instantOf(startRaw, tz),
    end: instantOf(endRaw, tz),
    invitees: [...new Set(emailsOf(pick(call, ...GROUPS.attendees)))].sort(),
    meet: meetKeys.some((k) => truthyMeet(call[k])),
    recurrence,
    description: String(pick(call, ...GROUPS.description) ?? "").trim(),
    timeZone: tz ? String(tz) : null,
    calendar: pick(call, ...GROUPS.calendar) === undefined ? null : String(pick(call, ...GROUPS.calendar)),
    problems,
  };
}

/** The differences between the approved event and the call: [] means the call is exactly the approved event. `destination` is the salida's (its calendar). */
export function eventMismatches(approved, call, destination = {}) {
  const out = [...(call.problems ?? [])];
  if (call.timeZone && call.timeZone !== approved.timeZone) out.push(`time zone: approved ${approved.timeZone}, call ${call.timeZone}`);
  const wantCal = destination?.calendar || "primary";
  if (call.calendar && call.calendar !== wantCal) out.push(`calendar: approved ${wantCal}, call ${call.calendar}`);
  if (call.title !== approved.title) out.push(`title: approved «${approved.title}», call «${call.title}»`);
  const a0 = Date.parse(approved.start);
  const a1 = Date.parse(approved.end);
  if (call.start !== a0) out.push(`start: approved ${approved.start}, call ${call.start === null ? "unreadable (pass an ISO time with its offset, or a time plus timeZone)" : new Date(call.start).toISOString()}`);
  if (call.end !== a1) out.push(`end: approved ${approved.end}, call ${call.end === null ? "unreadable" : new Date(call.end).toISOString()}`);
  const want = [...new Set(approved.invitees)].sort();
  if (want.join(",") !== call.invitees.join(",")) out.push(`invitees: approved [${want.join(", ") || "none"}], call [${call.invitees.join(", ") || "none"}]`);
  if (approved.meet !== call.meet) out.push(`Google Meet: approved ${approved.meet ? "yes" : "no"}, call ${call.meet ? "yes" : "no"}`);
  // The series: exactly one entry, byte for byte the approved Repetir text. No entry when none was approved. A second
  // RRULE, an RDATE or an EXDATE is an extra entry and refused.
  const gotRec = call.recurrence ?? [];
  const wantRec = approved.recurrence ? [approved.recurrence] : [];
  if (gotRec.length !== wantRec.length || gotRec.some((x, i) => x !== wantRec[i])) {
    const show = (l) => (l.length ? l.map((x) => `«${x}»`).join(", ") : "none");
    out.push(`recurrence: approved [${show(wantRec)}], call recurrenceData [${show(gotRec)}]`);
  }
  if ((approved.description ?? "") !== call.description) out.push("description differs from the approved text");
  return out;
}
