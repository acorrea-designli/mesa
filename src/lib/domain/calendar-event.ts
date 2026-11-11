// The exact text of a calendar salida (t112). A calendar salida's approved version body IS the event, one field per
// line, so what Andrés reads on the card, what he edits and what the lead creates are the same text:
//
//   Título: Meet con Matt
//   Inicio: 2026-11-12T10:00:00-05:00
//   Fin: 2026-11-12T10:30:00-05:00
//   Zona: America/Bogota
//   Invitados: matt.r@scoutapp.example, laura@example.com     (the line is omitted when nobody is invited)
//   Meet: sí
//   Descripción: free text, to the end                          (optional)
//
// Hook G5 (scripts/hooks/calendar-body.mjs, the same parser) compares the connector call to these fields.
import { validZone, zoneOffsetMs } from "./ics";

export interface EventFields {
  title: string;
  /** ISO with an explicit offset, in `timeZone`. */
  start: string;
  end: string;
  timeZone: string;
  invitees: string[];
  meet: boolean;
  description?: string;
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;

/** An instant as ISO with the offset of `tz` at that instant ("2026-11-12T10:00:00-05:00"). */
export function isoInZone(ms: number, tz: string): string {
  const off = zoneOffsetMs(ms, tz);
  const local = new Date(ms + off).toISOString().slice(0, 19);
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off) / 60_000;
  return `${local}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

export function formatEventBody(f: EventFields): string {
  const lines = [`Título: ${f.title}`, `Inicio: ${f.start}`, `Fin: ${f.end}`, `Zona: ${f.timeZone}`];
  if (f.invitees.length) lines.push(`Invitados: ${f.invitees.join(", ")}`);
  lines.push(`Meet: ${f.meet ? "sí" : "no"}`);
  if (f.description?.trim()) lines.push(`Descripción: ${f.description.trim()}`);
  return lines.join("\n");
}

export type ParsedEvent = { ok: true; fields: EventFields } | { ok: false; problem: string };

const KEYS = ["título", "inicio", "fin", "zona", "invitados", "meet", "descripción"] as const;
const strip = (s: string) => s.normalize("NFC").toLowerCase();

export function parseEventBody(body: string): ParsedEvent {
  const got: Record<string, string> = {};
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([^:]+):\s*(.*)$/.exec(lines[i]!);
    if (!m) {
      if (lines[i]!.trim()) return { ok: false, problem: `línea sin campo: «${lines[i]!.trim().slice(0, 40)}»` };
      continue;
    }
    const key = strip(m[1]!.trim());
    if (!(KEYS as readonly string[]).includes(key)) return { ok: false, problem: `campo desconocido: «${m[1]!.trim()}»` };
    if (key in got) return { ok: false, problem: `campo repetido: «${m[1]!.trim()}»` };
    if (key === "descripción") {
      got[key] = [m[2]!, ...lines.slice(i + 1)].join("\n").trim();
      break;
    }
    got[key] = m[2]!.trim();
  }
  const title = got["título"];
  if (!title) return { ok: false, problem: "falta el título" };
  const start = got["inicio"];
  const end = got["fin"];
  if (!start || !ISO.test(start) || Number.isNaN(Date.parse(start))) return { ok: false, problem: "el inicio debe ser una fecha ISO con zona, p. ej. 2026-11-12T10:00:00-05:00" };
  if (!end || !ISO.test(end) || Number.isNaN(Date.parse(end))) return { ok: false, problem: "el fin debe ser una fecha ISO con zona" };
  if (Date.parse(end) <= Date.parse(start)) return { ok: false, problem: "el fin debe ser después del inicio" };
  const timeZone = got["zona"];
  if (!validZone(timeZone)) return { ok: false, problem: "la zona debe ser una zona IANA, p. ej. America/Bogota" };
  const invitees = (got["invitados"] ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const e of invitees) if (!EMAIL.test(e)) return { ok: false, problem: `invitado inválido: «${e}»` };
  if (new Set(invitees).size !== invitees.length) return { ok: false, problem: "invitado repetido" };
  const meetRaw = strip(got["meet"] ?? "");
  if (meetRaw !== "sí" && meetRaw !== "si" && meetRaw !== "no") return { ok: false, problem: "Meet debe ser sí o no" };
  const description = got["descripción"];
  return { ok: true, fields: { title, start, end, timeZone, invitees, meet: meetRaw !== "no", ...(description ? { description } : {}) } };
}

/** The problem with a calendar salida body, or null when it is a complete, valid event. */
export const eventBodyProblem = (body: string): string | null => {
  const p = parseEventBody(body);
  return p.ok ? null : p.problem;
};

const whenFmt = (tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-CO", { timeZone: tz, ...o });

/** "jueves 12 nov · 10:00–10:30" in the event's own zone (the card adds the zone name beside it). */
export function eventWhen(f: Pick<EventFields, "start" | "end" | "timeZone">): string {
  const s = new Date(f.start);
  const e = new Date(f.end);
  const day = whenFmt(f.timeZone, { weekday: "long", day: "numeric", month: "short" }).format(s).replace(",", "").replace(" de ", " ").replace(/\./g, "");
  const hm = whenFmt(f.timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const sameDay = whenFmt(f.timeZone, { year: "numeric", month: "numeric", day: "numeric" }).format(s) === whenFmt(f.timeZone, { year: "numeric", month: "numeric", day: "numeric" }).format(e);
  return `${day} · ${hm.format(s)}–${hm.format(e)}${sameDay ? "" : " (+1 día)"}`;
}
