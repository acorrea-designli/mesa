// Hook G5 for Google Calendar (t112): what a released calendar salida approved, and whether a connector call is exactly
// that. A calendar salida's approved version body IS the event (src/lib/domain/calendar-event.ts, the same format):
//
//   Título: Meet con Matt
//   Inicio: 2026-11-12T10:00:00-05:00
//   Fin: 2026-11-12T10:30:00-05:00
//   Zona: America/Bogota
//   Invitados: matt.r@scoutapp.example
//   Meet: sí
//   Descripción: free text, to the end
//
// Plain JS on purpose: the hooks are standalone .mjs files with no build step. parseEventBody here and in the TS
// domain file must stay in step (both are tested on the same samples).

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;
const KEYS = ["título", "inicio", "fin", "zona", "invitados", "meet", "descripción"];
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
  const description = got["descripción"] ?? "";
  return { ok: true, fields: { title, start, end, timeZone, invitees, meet: meetRaw !== "no", description } };
}

// ---------- the connector call ----------

const pick = (o, ...keys) => {
  for (const k of keys) if (o?.[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
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

/** The fields a create_event call is about to write, read tolerantly from the connector's parameter names. */
export function eventFromCall(ti) {
  const startRaw = pick(ti, "start", "startTime", "start_time", "startDateTime", "start_date_time", "start_datetime");
  const endRaw = pick(ti, "end", "endTime", "end_time", "endDateTime", "end_date_time", "end_datetime");
  const tz = pick(ti, "timeZone", "timezone", "time_zone") ?? (startRaw && typeof startRaw === "object" ? pick(startRaw, "timeZone", "time_zone", "timezone") : undefined);
  const meetKeys = Object.keys(ti ?? {}).filter((k) => /meet|conference/i.test(k));
  return {
    title: String(pick(ti, "summary", "title", "name", "subject") ?? "").trim(),
    start: instantOf(startRaw, tz),
    end: instantOf(endRaw, tz),
    invitees: [...new Set(emailsOf(pick(ti, "attendees", "guests", "invitees", "attendee_emails", "attendeeEmails")))].sort(),
    meet: meetKeys.some((k) => truthyMeet(ti[k])),
    description: String(pick(ti, "description", "notes", "body") ?? "").trim(),
  };
}

/** The differences between the approved event and the call: [] means the call is exactly the approved event. */
export function eventMismatches(approved, call) {
  const out = [];
  if (call.title !== approved.title) out.push(`title: approved «${approved.title}», call «${call.title}»`);
  const a0 = Date.parse(approved.start);
  const a1 = Date.parse(approved.end);
  if (call.start !== a0) out.push(`start: approved ${approved.start}, call ${call.start === null ? "unreadable (pass an ISO time with its offset, or a time plus timeZone)" : new Date(call.start).toISOString()}`);
  if (call.end !== a1) out.push(`end: approved ${approved.end}, call ${call.end === null ? "unreadable" : new Date(call.end).toISOString()}`);
  const want = [...new Set(approved.invitees)].sort();
  if (want.join(",") !== call.invitees.join(",")) out.push(`invitees: approved [${want.join(", ") || "none"}], call [${call.invitees.join(", ") || "none"}]`);
  if (approved.meet !== call.meet) out.push(`Google Meet: approved ${approved.meet ? "yes" : "no"}, call ${call.meet ? "yes" : "no"}`);
  if ((approved.description ?? "") !== call.description) out.push("description differs from the approved text");
  return out;
}
