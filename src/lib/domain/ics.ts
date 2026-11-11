// iCalendar (RFC 5545) reader for the Calendario poller (t112). Pure: text in, occurrences out. It handles what
// Google's private ICS feed uses: folded lines, DTSTART/DTEND/DURATION in UTC, floating, TZID (IANA) and VALUE=DATE,
// RRULE (DAILY, WEEKLY, MONTHLY, YEARLY with INTERVAL, COUNT, UNTIL, BYDAY with ordinals, BYMONTHDAY, BYMONTH,
// WKST), EXDATE, RDATE, RECURRENCE-ID overrides, STATUS:CANCELLED, ATTENDEE PARTSTAT and the Meet link
// (X-GOOGLE-CONFERENCE, LOCATION, DESCRIPTION). Not handled: BYSETPOS, BYHOUR-style expansion, SECONDLY..HOURLY
// rules (an event with one keeps only its first occurrence). Times in the output are UTC ISO strings; an all-day
// event is drawn from 00:00 of its first day to 00:00 of the day after its last, in the viewer's zone (`viewTz`).
//
// This file never sees the feed's address and never logs the feed: the caller owns the secret.

import type { CalendarResponse } from "./types";

export interface IcsAttendee {
  email: string;
  name: string | null;
  response: CalendarResponse;
}

export interface IcsOccurrence {
  uid: string;
  /** The occurrence's ORIGINAL start (UTC ISO): stable when one occurrence of a series is moved. */
  occurrenceKey: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timeZone: string | null;
  location: string | null;
  meetUrl: string | null;
  attendees: IcsAttendee[];
  organizer: string | null;
  response: CalendarResponse;
  status: "confirmed" | "tentative";
  recurring: boolean;
}

export interface IcsResult {
  occurrences: IcsOccurrence[];
  calendarName: string | null;
  /** VEVENTs that could not be read (bad date, unknown zone): counted, never fatal. */
  skipped: number;
}

export interface IcsOptions {
  /** Keep occurrences that end after `from` and start before `to`. */
  from: Date;
  to: Date;
  /** The zone all-day events are drawn in (default America/Bogota). */
  viewTz?: string;
  /** Lower-case address of the calendar's owner: their PARTSTAT is "declined" detection. Else X-WR-CALNAME when it has an @. */
  ownerEmail?: string | null;
}

const DAY = 86_400_000;
const MAX_STEPS = 6000;

// ---------- time zones ----------

const dtf = new Map<string, Intl.DateTimeFormat | null>();
function formatter(tz: string): Intl.DateTimeFormat | null {
  if (dtf.has(tz)) return dtf.get(tz)!;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  } catch {
    f = null;
  }
  dtf.set(tz, f);
  return f;
}

export const validZone = (tz: string | null | undefined): tz is string => Boolean(tz) && (tz === "UTC" || formatter(tz!) !== null);

/** The zone's UTC offset in ms at an instant. */
export function zoneOffsetMs(ms: number, tz: string): number {
  if (tz === "UTC") return 0;
  const f = formatter(tz);
  if (!f) return 0;
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(ms / 1000) * 1000;
}

export interface Civil {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** A wall-clock time in `tz` as a UTC instant (the later reading in a repeated hour, a shifted one in a skipped hour). */
export function zonedToUtc(c: Civil, tz: string): number {
  const guess = Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s);
  if (tz === "UTC") return guess;
  const t1 = guess - zoneOffsetMs(guess, tz);
  return guess - zoneOffsetMs(t1, tz);
}

// ---------- lines and properties ----------

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  return out.filter((l) => l.length > 0);
}

function parseProp(line: string): Prop | null {
  // NAME[;PARAM=v[,v]...]:value  (a param value may be quoted and hold ':' or ';')
  let i = 0;
  let inQuote = false;
  let colon = -1;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let cur = "";
  inQuote = false;
  for (const ch of head) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === ";" && !inQuote) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const name = parts.shift()!.toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

const unescapeText = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

// ---------- date values ----------

interface DateVal {
  kind: "date" | "utc" | "local";
  c: Civil;
  tz: string | null; // TZID for kind local
}

function parseDateVal(p: Prop): DateVal | null {
  const v = p.value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { kind: "date", c: { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: 0, mi: 0, s: 0 }, tz: null };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const c = { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +m[4]!, mi: +m[5]!, s: +m[6]! };
  if (m[7]) return { kind: "utc", c, tz: null };
  return { kind: "local", c, tz: p.params.TZID ?? null };
}

function dateValMs(v: DateVal, floatingTz: string, viewTz: string): number {
  if (v.kind === "utc") return Date.UTC(v.c.y, v.c.mo - 1, v.c.d, v.c.h, v.c.mi, v.c.s);
  if (v.kind === "date") return zonedToUtc(v.c, viewTz);
  return zonedToUtc(v.c, validZone(v.tz) ? v.tz : floatingTz);
}

function parseDuration(s: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s.trim());
  if (!m) return null;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

// ---------- RRULE ----------

type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
const WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

interface Rule {
  freq: Freq;
  interval: number;
  count: number | null;
  until: DateVal | null;
  byDay: { n: number; wd: number }[];
  byMonthDay: number[];
  byMonth: number[];
  wkst: number;
}

function parseRule(value: string): Rule | null {
  const kv: Record<string, string> = {};
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = kv.FREQ as Freq | undefined;
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  const byDay: Rule["byDay"] = [];
  for (const d of (kv.BYDAY ?? "").split(",").filter(Boolean)) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(d.trim());
    if (m) byDay.push({ n: m[1] ? +m[1] : 0, wd: WD.indexOf(m[2]!.toUpperCase()) });
  }
  const nums = (s?: string) => (s ?? "").split(",").filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
  const wkst = WD.indexOf((kv.WKST ?? "MO").toUpperCase());
  return {
    freq,
    interval: Math.max(1, Number(kv.INTERVAL ?? 1) || 1),
    count: kv.COUNT ? Number(kv.COUNT) : null,
    until: kv.UNTIL ? parseDateVal({ name: "UNTIL", params: {}, value: kv.UNTIL }) : null,
    byDay,
    byMonthDay: nums(kv.BYMONTHDAY),
    byMonth: nums(kv.BYMONTH),
    wkst: wkst < 0 ? 1 : wkst,
  };
}

const dayNum = (c: Civil) => Math.floor(Date.UTC(c.y, c.mo - 1, c.d) / DAY);
const civilOfDay = (n: number, time: Civil): Civil => {
  const d = new Date(n * DAY);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: time.h, mi: time.mi, s: time.s };
};
const weekday = (n: number) => (((n + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday (4)
const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** Day numbers of one month that a MONTHLY or YEARLY rule selects. */
function monthDays(y: number, mo: number, r: Rule, startDay: Civil): number[] {
  const dim = daysInMonth(y, mo);
  const first = Math.floor(Date.UTC(y, mo - 1, 1) / DAY);
  const out = new Set<number>();
  const byMonthDay = r.byMonthDay.map((d) => (d < 0 ? dim + d + 1 : d)).filter((d) => d >= 1 && d <= dim);
  if (r.byDay.length) {
    for (const { n, wd } of r.byDay) {
      const days: number[] = [];
      for (let d = 1; d <= dim; d++) if (weekday(first + d - 1) === wd) days.push(first + d - 1);
      if (n === 0) days.forEach((x) => out.add(x));
      else {
        const x = n > 0 ? days[n - 1] : days[days.length + n];
        if (x !== undefined) out.add(x);
      }
    }
    if (byMonthDay.length) for (const x of [...out]) if (!byMonthDay.includes(x - first + 1)) out.delete(x);
  } else if (byMonthDay.length) {
    byMonthDay.forEach((d) => out.add(first + d - 1));
  } else if (startDay.d <= dim) {
    out.add(first + startDay.d - 1);
  }
  return [...out].sort((a, b) => a - b);
}

/** Candidate start days of a rule from DTSTART on, in order (lazy). */
function* candidateDays(r: Rule, start: Civil): Generator<number> {
  const startDay = dayNum(start);
  if (r.freq === "DAILY") {
    for (let k = 0; ; k++) yield startDay + k * r.interval;
  } else if (r.freq === "WEEKLY") {
    const days = (r.byDay.length ? r.byDay.map((x) => x.wd) : [weekday(startDay)]).slice();
    days.sort((a, b) => ((a - r.wkst + 7) % 7) - ((b - r.wkst + 7) % 7));
    const weekStart = startDay - ((weekday(startDay) - r.wkst + 7) % 7);
    for (let p = 0; ; p++) {
      const base = weekStart + p * 7 * r.interval;
      for (const wd of days) {
        const day = base + ((wd - r.wkst + 7) % 7);
        if (day >= startDay) yield day;
      }
    }
  } else if (r.freq === "MONTHLY") {
    for (let k = 0; ; k++) {
      const idx = start.mo - 1 + k * r.interval;
      const y = start.y + Math.floor(idx / 12);
      const mo = (idx % 12) + 1;
      for (const day of monthDays(y, mo, r, start)) if (day >= startDay) yield day;
    }
  } else {
    const months = r.byMonth.length ? [...r.byMonth].sort((a, b) => a - b) : [start.mo];
    for (let k = 0; ; k++) {
      const y = start.y + k * r.interval;
      const days = months.flatMap((mo) => monthDays(y, mo, r, start));
      for (const day of days.sort((a, b) => a - b)) if (day >= startDay) yield day;
    }
  }
}

// ---------- events ----------

interface RawEvent {
  uid: string;
  props: Prop[];
}

const first = (e: RawEvent, name: string) => e.props.find((p) => p.name === name);
const all = (e: RawEvent, name: string) => e.props.filter((p) => p.name === name);

function responseOf(partstat: string | undefined): CalendarResponse {
  switch ((partstat ?? "").toUpperCase()) {
    case "ACCEPTED":
      return "accepted";
    case "DECLINED":
      return "declined";
    case "TENTATIVE":
      return "tentative";
    case "NEEDS-ACTION":
      return "needs_action";
    default:
      return "none";
  }
}

const mailOf = (v: string) => v.replace(/^mailto:/i, "").trim().toLowerCase();

const MEET_RE = /https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?[^\s"<>\\]*)?/i;
const CONF_RE = /https:\/\/[^\s"<>\\]+/i;

function meetOf(e: RawEvent): string | null {
  const conf = first(e, "X-GOOGLE-CONFERENCE");
  if (conf) {
    const m = CONF_RE.exec(conf.value);
    if (m) return m[0];
  }
  for (const name of ["LOCATION", "DESCRIPTION", "URL"]) {
    const p = first(e, name);
    if (!p) continue;
    const m = MEET_RE.exec(unescapeText(p.value));
    if (m) return m[0];
  }
  return null;
}

/** Parse an ICS feed into the occurrences that overlap [from, to). Never throws on a bad event. */
export function parseIcs(text: string, opts: IcsOptions): IcsResult {
  const viewTz = opts.viewTz ?? "America/Bogota";
  const fromMs = opts.from.getTime();
  const toMs = opts.to.getTime();
  const lines = unfold(text);

  let calName: string | null = null;
  let calTz = "UTC";
  const events: RawEvent[] = [];
  let cur: RawEvent | null = null;
  let depth = 0; // nested components inside a VEVENT (VALARM)
  for (const line of lines) {
    const p = parseProp(line);
    if (!p) continue;
    if (p.name === "BEGIN") {
      if (p.value.toUpperCase() === "VEVENT") cur = { uid: "", props: [] };
      else if (cur) depth++;
    } else if (p.name === "END") {
      if (p.value.toUpperCase() === "VEVENT" && cur) {
        cur.uid = first(cur, "UID")?.value.trim() ?? "";
        if (cur.uid) events.push(cur);
        cur = null;
        depth = 0;
      } else if (cur && depth > 0) depth--;
    } else if (cur) {
      if (depth === 0) cur.props.push(p);
    } else if (p.name === "X-WR-CALNAME") calName = unescapeText(p.value);
    else if (p.name === "X-WR-TIMEZONE" && validZone(p.value.trim())) calTz = p.value.trim();
  }

  const owner = (opts.ownerEmail ?? (calName && calName.includes("@") ? calName : null))?.trim().toLowerCase() ?? null;
  let skipped = 0;
  const out: IcsOccurrence[] = [];

  const overrides = new Map<string, RawEvent>(); // `${uid}|${original start ms}`
  const masters: RawEvent[] = [];
  for (const e of events) {
    const rid = first(e, "RECURRENCE-ID");
    if (rid) {
      const v = parseDateVal(rid);
      if (v) overrides.set(`${e.uid}|${dateValMs(v, calTz, viewTz)}`, e);
      else skipped++;
    } else masters.push(e);
  }

  function build(e: RawEvent, startMs: number, endMs: number, keyMs: number, recurring: boolean, allDay: boolean, tz: string | null): IcsOccurrence | null {
    if (endMs <= fromMs || startMs >= toMs) return null;
    const status = (first(e, "STATUS")?.value ?? "").toUpperCase();
    if (status === "CANCELLED") return null;
    const attendees: IcsAttendee[] = all(e, "ATTENDEE").map((a) => ({
      email: mailOf(a.value),
      name: a.params.CN ? unescapeText(a.params.CN) : null,
      response: responseOf(a.params.PARTSTAT),
    }));
    let response: CalendarResponse = "none";
    if (owner) {
      const me = attendees.find((a) => a.email === owner);
      if (me) response = me.response;
    }
    const org = first(e, "ORGANIZER");
    return {
      uid: e.uid,
      occurrenceKey: new Date(keyMs).toISOString(),
      title: unescapeText(first(e, "SUMMARY")?.value ?? "").trim() || "(sin título)",
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(endMs).toISOString(),
      allDay,
      timeZone: tz,
      location: first(e, "LOCATION") ? unescapeText(first(e, "LOCATION")!.value).trim() || null : null,
      meetUrl: meetOf(e),
      attendees,
      organizer: org ? mailOf(org.value) : null,
      response,
      status: status === "TENTATIVE" ? "tentative" : "confirmed",
      recurring,
    };
  }

  /** start, end, all-day and zone of one VEVENT; null when its times cannot be read. */
  function timesOf(e: RawEvent): { startMs: number; endMs: number; allDay: boolean; tz: string | null; dtstart: DateVal } | null {
    const ds = first(e, "DTSTART");
    const dtstart = ds ? parseDateVal(ds) : null;
    if (!ds || !dtstart) return null;
    if (dtstart.kind === "local" && dtstart.tz && !validZone(dtstart.tz)) return null;
    const allDay = dtstart.kind === "date";
    const startMs = dateValMs(dtstart, calTz, viewTz);
    let endMs: number;
    const de = first(e, "DTEND");
    const dur = first(e, "DURATION");
    const dtend = de ? parseDateVal(de) : null;
    if (dtend) endMs = dateValMs(dtend, calTz, viewTz);
    else if (dur && parseDuration(dur.value) !== null) endMs = startMs + parseDuration(dur.value)!;
    else endMs = allDay ? zonedToUtc({ ...dtstart.c, d: dtstart.c.d + 1 }, viewTz) : startMs;
    if (endMs < startMs) endMs = startMs;
    const tz = dtstart.kind === "local" ? (validZone(dtstart.tz) ? dtstart.tz : null) : dtstart.kind === "utc" ? "UTC" : null;
    return { startMs, endMs, allDay, tz, dtstart };
  }

  for (const e of masters) {
    const t = timesOf(e);
    if (!t) {
      skipped++;
      continue;
    }
    const rruleProp = first(e, "RRULE");
    const rdates = all(e, "RDATE");
    const recurring = Boolean(rruleProp) || rdates.length > 0;
    const duration = t.endMs - t.startMs;
    const exdates = new Set<number>();
    for (const x of all(e, "EXDATE"))
      for (const part of x.value.split(",")) {
        const v = parseDateVal({ ...x, value: part });
        if (v) exdates.add(dateValMs(v, calTz, viewTz));
      }

    const starts: number[] = [t.startMs];
    const rule = rruleProp ? parseRule(rruleProp.value) : null;
    if (rule) {
      const evTz = t.dtstart.kind === "local" && validZone(t.dtstart.tz) ? t.dtstart.tz : t.dtstart.kind === "utc" ? "UTC" : calTz;
      const untilMs = rule.until ? (rule.until.kind === "date" ? dateValMs(rule.until, calTz, viewTz) + DAY : dateValMs(rule.until, calTz, viewTz)) : null;
      starts.length = 0;
      let n = 0;
      let steps = 0;
      const time = t.dtstart.c;
      for (const day of candidateDays(rule, time)) {
        if (++steps > MAX_STEPS) break;
        const startMs = t.allDay ? zonedToUtc(civilOfDay(day, { ...time, h: 0, mi: 0, s: 0 }), viewTz) : zonedToUtc(civilOfDay(day, time), evTz);
        if (untilMs !== null && (t.allDay ? startMs >= untilMs : startMs > untilMs)) break;
        if (startMs >= toMs) break;
        starts.push(startMs);
        if (rule.count !== null && ++n >= rule.count) break;
      }
    }
    for (const rd of rdates)
      for (const part of rd.value.split(",")) {
        const v = parseDateVal({ ...rd, value: part });
        if (v) starts.push(dateValMs(v, calTz, viewTz));
      }

    const seen = new Set<number>();
    for (const startMs of starts) {
      if (seen.has(startMs)) continue;
      seen.add(startMs);
      if (exdates.has(startMs)) continue;
      const ov = overrides.get(`${e.uid}|${startMs}`);
      if (ov) continue; // an override stands for this occurrence (handled below)
      const occ = build(e, startMs, startMs + duration, startMs, recurring, t.allDay, t.tz);
      if (occ) out.push(occ);
    }
  }

  // Overrides: the moved or edited occurrence (a cancelled one is dropped by build()).
  for (const [key, e] of overrides) {
    const t = timesOf(e);
    if (!t) {
      skipped++;
      continue;
    }
    const keyMs = Number(key.split("|").pop());
    const occ = build(e, t.startMs, t.endMs, keyMs, true, t.allDay, t.tz);
    if (occ) out.push(occ);
  }

  out.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));
  return { occurrences: out, calendarName: calName, skipped };
}
