// The exact text of a calendar MOVE salida (t131): reschedule an existing Google Calendar event. Like a create salida
// (calendar-event.ts) the approved version body is the whole instruction, one field per line, and it starts with Mover:
//
//   Mover: 03fo5onsmpno60suu57ma2ashp        (the Google eventId)
//   Título: Weekly Check-In                  (display only: the event's current title, never sent)
//   Inicio: 2026-11-13T11:00:00-05:00
//   Fin: 2026-11-13T11:30:00-05:00
//   Zona: America/Bogota
//   Avisar: sí                               (sí = notify the invitees, no = move silently)
//
// A move never changes invitees, Meet or description, so those create-only fields are refused here. Hook G5
// (scripts/hooks/calendar-move.mjs, the same parser) lets update_event through only for exactly these fields.
import { validZone } from "./ics";

export interface MoveFields {
  eventId: string;
  /** The event's current title: shown on the card, never compared and never sent. */
  title: string;
  /** ISO with an explicit offset, in `timeZone`. */
  start: string;
  end: string;
  timeZone: string;
  /** Notify the invitees (notificationLevel ALL) or not (NONE). */
  notify: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;
// Google event ids are base32hex; a single instance of a series adds _<YYYYMMDDTHHMMSSZ>. Anything with spaces or a colon is not one.
const EVENT_ID = /^[A-Za-z0-9_-]{5,1024}$/;
const KEYS = ["mover", "título", "inicio", "fin", "zona", "avisar"] as const;
const CREATE_ONLY = ["invitados", "meet", "descripción"];
const strip = (s: string) => s.normalize("NFC").toLowerCase();

export function formatMoveBody(f: MoveFields): string {
  return [`Mover: ${f.eventId}`, `Título: ${f.title}`, `Inicio: ${f.start}`, `Fin: ${f.end}`, `Zona: ${f.timeZone}`, `Avisar: ${f.notify ? "sí" : "no"}`].join("\n");
}

export type ParsedMove = { ok: true; fields: MoveFields } | { ok: false; problem: string };

/** True when the body is a move instruction (its first field is Mover), valid or not. */
export const isMoveBody = (body: string): boolean => /^\s*mover\s*:/i.test(strip(body));

export function parseMoveBody(body: string): ParsedMove {
  const got: Record<string, string> = {};
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (!m) {
      if (line.trim()) return { ok: false, problem: `línea sin campo: «${line.trim().slice(0, 40)}»` };
      continue;
    }
    const key = strip(m[1]!.trim());
    if (CREATE_ONLY.includes(key)) return { ok: false, problem: `«${m[1]!.trim()}» es solo de eventos nuevos: mover no cambia invitados, Meet ni descripción` };
    if (!(KEYS as readonly string[]).includes(key)) return { ok: false, problem: `campo desconocido: «${m[1]!.trim()}»` };
    if (key in got) return { ok: false, problem: `campo repetido: «${m[1]!.trim()}»` };
    got[key] = m[2]!.trim();
  }
  const eventId = got["mover"];
  if (!eventId) return { ok: false, problem: "falta el id del evento (Mover: <eventId>)" };
  if (!EVENT_ID.test(eventId)) return { ok: false, problem: `id de evento inválido: «${eventId.slice(0, 40)}»` };
  const title = got["título"];
  if (!title) return { ok: false, problem: "falta el título actual del evento (solo para mostrarlo)" };
  const start = got["inicio"];
  const end = got["fin"];
  if (!start || !ISO.test(start) || Number.isNaN(Date.parse(start))) return { ok: false, problem: "el inicio debe ser una fecha ISO con zona, p. ej. 2026-11-13T11:00:00-05:00" };
  if (!end || !ISO.test(end) || Number.isNaN(Date.parse(end))) return { ok: false, problem: "el fin debe ser una fecha ISO con zona" };
  if (Date.parse(end) <= Date.parse(start)) return { ok: false, problem: "el fin debe ser después del inicio" };
  const timeZone = got["zona"];
  if (!validZone(timeZone)) return { ok: false, problem: "la zona debe ser una zona IANA, p. ej. America/Bogota" };
  const avisar = strip(got["avisar"] ?? "");
  if (avisar !== "sí" && avisar !== "si" && avisar !== "no") return { ok: false, problem: "Avisar debe ser sí o no" };
  return { ok: true, fields: { eventId, title, start, end, timeZone, notify: avisar !== "no" } };
}

/** The problem with a move body, or null when it is a valid move. */
export const moveBodyProblem = (body: string): string | null => {
  const p = parseMoveBody(body);
  return p.ok ? null : p.problem;
};
