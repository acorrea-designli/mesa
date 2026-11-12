// The exact text of a calendar salida (t112). A calendar salida's approved version body IS the event, one field per
// line, so what Andrés reads on the card, what he edits and what the lead creates are the same text:
//
//   Título: Meet con Matt
//   Inicio: 2026-11-12T10:00:00-05:00
//   Fin: 2026-11-12T10:30:00-05:00
//   Zona: America/Bogota
//   Invitados: matt.r@scoutapp.example, laura@example.com     (the line is omitted when nobody is invited)
//   Meet: sí
//   Repetir: RRULE:FREQ=WEEKLY;BYDAY=WE                          (optional: the exact RRULE, in the event's zone)
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
  /** The exact RRULE string ("RRULE:FREQ=WEEKLY;BYDAY=WE"); absent when the event does not repeat. */
  recurrence?: string;
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
  if (f.recurrence?.trim()) lines.push(`Repetir: ${f.recurrence.trim()}`);
  if (f.description?.trim()) lines.push(`Descripción: ${f.description.trim()}`);
  return lines.join("\n");
}

export type ParsedEvent = { ok: true; fields: EventFields } | { ok: false; problem: string };

const KEYS = ["título", "inicio", "fin", "zona", "invitados", "meet", "repetir", "descripción"] as const;
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
  let recurrence: string | undefined;
  if ("repetir" in got) {
    const r = parseRrule(got["repetir"]!, { start, timeZone });
    if (!r.ok) return { ok: false, problem: r.problem };
    recurrence = got["repetir"];
  }
  const description = got["descripción"];
  return {
    ok: true,
    fields: { title, start, end, timeZone, invitees, meet: meetRaw !== "no", ...(recurrence ? { recurrence } : {}), ...(description ? { description } : {}) },
  };
}

// --- recurrence (t128): one RRULE, validated strictly so what Andrés approves is what Google Calendar receives ---

const FREQS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
type Freq = (typeof FREQS)[number];
const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const PART_KEYS = ["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "UNTIL", "WKST"] as const;

export interface Rrule {
  freq: Freq;
  interval: number;
  byDay: string[];
  byMonthDay: number[];
  byMonth: number[];
  count?: number;
  until?: string;
  wkst?: string;
}

const bad = (problem: string) => ({ ok: false as const, problem });
const UINT = /^[1-9]\d{0,5}$/;
const UNTIL_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/;

/** The start's local date (YYYYMMDD) and weekday index (0 = MO) in `tz`. */
function localStart(start: string, tz: string): { ymd: string; wd: number } {
  const local = isoInZone(Date.parse(start), tz).slice(0, 10);
  const wd = (new Date(`${local}T00:00:00Z`).getUTCDay() + 6) % 7;
  return { ymd: local.replace(/-/g, ""), wd };
}

function validUntil(u: string): { ok: boolean; ms: number } {
  const m = UNTIL_RE.exec(u);
  if (!m) return { ok: false, ms: 0 };
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number) as [number, number, number, number, number, number];
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const dt = new Date(ms);
  const ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && h < 24 && mi < 60 && s < 60;
  return { ok, ms };
}

/** Parses and validates "RRULE:FREQ=WEEKLY;BYDAY=WE"; with `at` it also checks UNTIL and BYDAY against the event's start and zone. */
export function parseRrule(raw: string, at?: { start: string; timeZone: string }): { ok: true; rule: Rrule } | { ok: false; problem: string } {
  if (!raw.startsWith("RRULE:")) return bad("Repetir debe empezar por RRULE:, p. ej. RRULE:FREQ=WEEKLY;BYDAY=WE");
  const body = raw.slice("RRULE:".length);
  if (body !== body.toUpperCase()) return bad("Repetir debe ir en mayúsculas");
  if (!body) return bad("Repetir está vacío: falta FREQ");
  const seen: Record<string, string> = {};
  for (const part of body.split(";")) {
    const m = /^([A-Z]+)=([^=;]+)$/.exec(part);
    if (!m) return bad(`Repetir tiene una parte inválida: «${part.slice(0, 40)}»`);
    const [, k, v] = m as unknown as [string, string, string];
    if (!(PART_KEYS as readonly string[]).includes(k)) return bad(`Repetir no admite «${k}»; solo ${PART_KEYS.join(", ")}`);
    if (k in seen) return bad(`Repetir repite «${k}»`);
    seen[k] = v;
  }
  const freq = seen["FREQ"];
  if (!freq) return bad("Repetir necesita FREQ");
  if (!(FREQS as readonly string[]).includes(freq)) return bad(`Repetir: FREQ debe ser ${FREQS.join(", ")}`);
  const posInt = (key: string): number | undefined | "bad" => {
    if (!(key in seen)) return undefined;
    return UINT.test(seen[key]!) ? Number(seen[key]) : "bad";
  };
  const interval = posInt("INTERVAL");
  if (interval === "bad") return bad("Repetir: INTERVAL debe ser un entero positivo");
  const count = posInt("COUNT");
  if (count === "bad") return bad("Repetir: COUNT debe ser un entero positivo");
  const list = (key: string, min: number, max: number): number[] | "bad" => {
    if (!(key in seen)) return [];
    const nums: number[] = [];
    for (const s of seen[key]!.split(",")) {
      if (!UINT.test(s) || Number(s) < min || Number(s) > max) return "bad";
      nums.push(Number(s));
    }
    return new Set(nums).size === nums.length ? nums : "bad";
  };
  const byMonthDay = list("BYMONTHDAY", 1, 31);
  if (byMonthDay === "bad") return bad("Repetir: BYMONTHDAY debe ser enteros positivos de 1 a 31, sin repetir");
  const byMonth = list("BYMONTH", 1, 12);
  if (byMonth === "bad") return bad("Repetir: BYMONTH debe ser enteros positivos de 1 a 12, sin repetir");
  let byDay: string[] = [];
  if ("BYDAY" in seen) {
    byDay = seen["BYDAY"]!.split(",");
    if (byDay.some((d) => !(DAYS as readonly string[]).includes(d)) || new Set(byDay).size !== byDay.length)
      return bad(`Repetir: BYDAY debe ser días ${DAYS.join(", ")}, sin repetir`);
  }
  const wkst = seen["WKST"];
  if (wkst !== undefined && !(DAYS as readonly string[]).includes(wkst)) return bad(`Repetir: WKST debe ser ${DAYS.join(", ")}`);
  if ("COUNT" in seen && "UNTIL" in seen) return bad("Repetir no puede tener COUNT y UNTIL a la vez");
  const ls = at ? localStart(at.start, at.timeZone) : null;
  const until = seen["UNTIL"];
  if (until !== undefined) {
    const u = validUntil(until);
    if (!u.ok) return bad("Repetir: UNTIL debe ser YYYYMMDD o YYYYMMDDTHHMMSSZ");
    const after = !at || !ls || (until.length === 8 ? until > ls.ymd : u.ms > Date.parse(at.start));
    if (!after) return bad("Repetir: UNTIL debe ser después del inicio del evento");
  }
  if (ls && freq === "WEEKLY" && byDay.length && !byDay.includes(DAYS[ls.wd]!))
    return bad(`Repetir: el evento empieza un ${DAYS[ls.wd]}, que debe estar en BYDAY`);
  return {
    ok: true,
    rule: {
      freq: freq as Freq,
      interval: interval ?? 1,
      byDay,
      byMonthDay,
      byMonth,
      ...(count !== undefined ? { count } : {}),
      ...(until !== undefined ? { until } : {}),
      ...(wkst !== undefined ? { wkst } : {}),
    },
  };
}

const DAY_ES: Record<string, [string, string]> = {
  MO: ["lunes", "lunes"],
  TU: ["martes", "martes"],
  WE: ["miércoles", "miércoles"],
  TH: ["jueves", "jueves"],
  FR: ["viernes", "viernes"],
  SA: ["sábado", "sábados"],
  SU: ["domingo", "domingos"],
};
const MONTH_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const UNIT: Record<Freq, [string, string, string]> = {
  DAILY: ["día", "días", "Cada día"],
  WEEKLY: ["semanas", "semanas", "Cada semana"],
  MONTHLY: ["meses", "meses", "Cada mes"],
  YEARLY: ["años", "años", "Cada año"],
};
const joinEs = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/** An RRULE in Spanish: "Cada semana, los miércoles", "Cada 2 semanas, lunes y jueves", "Cada mes, el día 5". The
 * raw rule comes back unchanged when it does not parse. `timeZone` places a UNTIL that carries a time. */
export function describeRecurrence(raw: string, timeZone = "UTC"): string {
  const parsed = parseRrule(raw);
  if (!parsed.ok) return raw;
  const r = parsed.rule;
  const every = r.interval === 1 ? UNIT[r.freq][2] : `Cada ${r.interval} ${UNIT[r.freq][1]}`;
  const parts: string[] = [];
  if (r.byDay.length) {
    const sorted = [...r.byDay].sort((a, b) => DAYS.indexOf(a as (typeof DAYS)[number]) - DAYS.indexOf(b as (typeof DAYS)[number]));
    parts.push(sorted.length === 1 ? `los ${DAY_ES[sorted[0]!]![1]}` : joinEs(sorted.map((d) => DAY_ES[d]![1])));
  }
  if (r.byMonthDay.length) parts.push(r.byMonthDay.length === 1 ? `el día ${r.byMonthDay[0]}` : `los días ${joinEs(r.byMonthDay.map(String))}`);
  if (r.byMonth.length) parts.push(`en ${joinEs(r.byMonth.map((m) => MONTH_ES[m - 1]!))}`);
  let out = [every, ...parts].join(", ");
  if (r.until) {
    const m = UNTIL_RE.exec(r.until)!;
    let [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[4] !== undefined) {
      const iso = isoInZone(Date.UTC(y, mo - 1, d, Number(m[4]), Number(m[5]), Number(m[6])), timeZone).slice(0, 10);
      [y, mo, d] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
    }
    out += `, hasta el ${d} ${MONTH_ABBR[mo - 1]} ${y}`;
  } else if (r.count) out += `, ${r.count} ${r.count === 1 ? "vez" : "veces"}`;
  return out;
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

/** eventWhen for a list line: "desde miércoles 18 nov · 16:00–16:30 · cada semana, los miércoles" when the event repeats. */
export function eventWhenLine(f: Pick<EventFields, "start" | "end" | "timeZone" | "recurrence">): string {
  const when = eventWhen(f);
  if (!f.recurrence) return when;
  const d = describeRecurrence(f.recurrence, f.timeZone);
  return `desde ${when} · ${d.charAt(0).toLowerCase()}${d.slice(1)}`;
}
