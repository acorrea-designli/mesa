// Hook G5 for a Google Calendar MOVE (t131): what a released calendar move salida approved, and whether an
// update_event call is exactly that. A move salida's approved version body (src/lib/domain/calendar-move.ts, the
// same format and the same samples):
//
//   Mover: 03fo5onsmpno60suu57ma2ashp
//   Título: Weekly Check-In            (display only, never compared)
//   Inicio: 2026-11-13T11:00:00-05:00
//   Fin: 2026-11-13T11:30:00-05:00
//   Zona: America/Bogota
//   Avisar: sí
//
// Plain JS on purpose (standalone hook, no build step). Self-contained: calendar-body.mjs is not touched.

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;
const EVENT_ID = /^[A-Za-z0-9_-]{5,1024}$/;
const KEYS = ["mover", "título", "inicio", "fin", "zona", "avisar"];
const CREATE_ONLY = ["invitados", "meet", "descripción"];
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

export const isMoveBody = (body) => /^\s*mover\s*:/.test(norm(String(body ?? "")));

/** { ok: true, fields } or { ok: false, problem }. */
export function parseMoveBody(body) {
  const got = {};
  for (const line of String(body ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (!m) {
      if (line.trim()) return { ok: false, problem: `línea sin campo: «${line.trim().slice(0, 40)}»` };
      continue;
    }
    const key = norm(m[1].trim());
    if (CREATE_ONLY.includes(key)) return { ok: false, problem: `«${m[1].trim()}» es solo de eventos nuevos` };
    if (!KEYS.includes(key)) return { ok: false, problem: `campo desconocido: «${m[1].trim()}»` };
    if (key in got) return { ok: false, problem: `campo repetido: «${m[1].trim()}»` };
    got[key] = m[2].trim();
  }
  const eventId = got["mover"];
  if (!eventId) return { ok: false, problem: "falta el id del evento" };
  if (!EVENT_ID.test(eventId)) return { ok: false, problem: "id de evento inválido" };
  if (!got["título"]) return { ok: false, problem: "falta el título actual del evento" };
  const start = got["inicio"];
  const end = got["fin"];
  if (!start || !ISO.test(start) || Number.isNaN(Date.parse(start))) return { ok: false, problem: "el inicio debe ser una fecha ISO con zona" };
  if (!end || !ISO.test(end) || Number.isNaN(Date.parse(end))) return { ok: false, problem: "el fin debe ser una fecha ISO con zona" };
  if (Date.parse(end) <= Date.parse(start)) return { ok: false, problem: "el fin debe ser después del inicio" };
  const timeZone = got["zona"];
  if (!validZone(timeZone)) return { ok: false, problem: "la zona debe ser una zona IANA" };
  const avisar = norm(got["avisar"] ?? "");
  if (avisar !== "sí" && avisar !== "si" && avisar !== "no") return { ok: false, problem: "Avisar debe ser sí o no" };
  return { ok: true, fields: { eventId, title: got["título"], start, end, timeZone, notify: avisar !== "no" } };
}

// ---------- the connector call ----------

// update_event's parameters (the claude.ai connector's schema): a move may carry ONLY these.
const ALLOWED = new Set(["eventId", "calendarId", "startTime", "endTime", "timeZone", "notificationLevel"]);
// Its own unset predicate (lesson review/acorrea-designli/mesa/guard-unknown-params): `false` is a value for every
// parameter outside the allowed list (allDay: false, guestPermissions: {guestsCanModify: false} change the event).
const isUnset = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

const offsetAt = (ms, tz) => {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};

// The connector's startTime/endTime: an ISO with an offset or Z is exact; one without is wall-clock time in `tz`.
function instantOf(v, tz) {
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

/** The differences between the approved move and an update_event call: [] means the call is exactly the approved move. `destination` is the salida's (its calendar). */
export function moveMismatches(approved, ti, destination = {}) {
  const call = ti ?? {};
  const out = [];
  for (const k of Object.keys(call)) if (!ALLOWED.has(k) && !isUnset(call[k])) out.push(`parameter not in the approved move: ${k}`);

  if (call.eventId !== approved.eventId) out.push(`eventId: approved ${approved.eventId}, call ${typeof call.eventId === "string" ? call.eventId : "missing"}`);
  const wantCal = destination?.calendar || "primary";
  const gotCal = isUnset(call.calendarId) ? "primary" : call.calendarId;
  if (gotCal !== wantCal) out.push(`calendar: approved ${wantCal}, call ${String(gotCal)}`);

  const tz = isUnset(call.timeZone) ? null : call.timeZone;
  if (tz !== null && tz !== approved.timeZone) out.push(`time zone: approved ${approved.timeZone}, call ${String(tz)}`);
  // Both times are required: startTime alone keeps the event's duration, which the approval did not cover.
  for (const [name, raw, want] of [["startTime", call.startTime, approved.start], ["endTime", call.endTime, approved.end]]) {
    if (isUnset(raw)) {
      out.push(`${name}: required (approved ${want})`);
      continue;
    }
    const hasOffset = typeof raw === "string" && /(Z|[+-]\d{2}:?\d{2})$/i.test(raw.trim());
    if (!hasOffset && tz !== approved.timeZone) {
      out.push(`${name}: has no offset, so timeZone must be the approved ${approved.timeZone}`);
      continue;
    }
    const got = instantOf(raw, approved.timeZone);
    if (got !== Date.parse(want)) out.push(`${name}: approved ${want}, call ${got === null ? "unreadable" : new Date(got).toISOString()}`);
  }

  // notificationLevel defaults to ALL: Avisar sí passes with ALL or nothing, Avisar no needs NONE.
  const level = isUnset(call.notificationLevel) ? null : call.notificationLevel;
  if (approved.notify) {
    if (level !== null && level !== "ALL" && level !== "NOTIFICATION_LEVEL_ALL") out.push(`notificationLevel: approved Avisar sí (ALL or omitted), call ${String(level)}`);
  } else if (level !== "NONE" && level !== "NOTIFICATION_LEVEL_NONE") {
    out.push(`notificationLevel: approved Avisar no, so the call must say NONE (got ${level === null ? "nothing, which notifies everyone" : String(level)})`);
  }
  return out;
}
