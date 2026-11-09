// /semana: the week's done work (pure). Week range in America/Bogota, project normalization, grouping,
// dedupe and the plain-text copy. Facts from the DB only; nothing here reads a clock or the database.
import type { Destination } from "./types";

// ---------- week range ----------

export const WEEK_TZ = "America/Bogota";
/** Colombia has no DST: Bogota is UTC-5 all year, so a Bogota midnight is a fixed instant. */
const BOGOTA_OFFSET = "-05:00";
const DAY_MS = 86_400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const LOCAL_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: WEEK_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** The calendar day (YYYY-MM-DD) an instant falls on in Bogota. */
export const localDay = (d: Date): string => LOCAL_DAY.format(d);

const utcOf = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const ymdOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** `ymd` shifted by whole days (calendar arithmetic, no timezone involved). */
export const addDays = (ymd: string, n: number): string => ymdOf(utcOf(ymd) + n * DAY_MS);
/** The Monday of the week `ymd` falls in. */
export function mondayOf(ymd: string): string {
  const dow = new Date(utcOf(ymd)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7));
}

export interface Week {
  /** YYYY-MM-DD of the Monday: the `?semana=` value. */
  monday: string;
  sunday: string;
  /** [startIso, endIso): Monday 00:00 to the next Monday 00:00 in Bogota, as UTC ISO strings. */
  startIso: string;
  endIso: string;
  prev: string;
  /** null on the current week (no future weeks). */
  next: string | null;
  current: boolean;
}

/** The week `param` names (any day of it; invalid or future falls back to the current week). */
export function weekOf(now: Date, param?: string | null): Week {
  const currentMonday = mondayOf(localDay(now));
  let monday = currentMonday;
  if (param && YMD.test(param) && !Number.isNaN(utcOf(param))) {
    const asked = mondayOf(param);
    if (asked <= currentMonday) monday = asked;
  }
  const next = addDays(monday, 7);
  return {
    monday,
    sunday: addDays(monday, 6),
    startIso: new Date(`${monday}T00:00:00${BOGOTA_OFFSET}`).toISOString(),
    endIso: new Date(`${next}T00:00:00${BOGOTA_OFFSET}`).toISOString(),
    prev: addDays(monday, -7),
    next: monday < currentMonday ? next : null,
    current: monday === currentMonday,
  };
}

// ---------- project normalization ----------

export const NO_PROJECT = "Sin proyecto";

/**
 * How project strings are grouped. "client": the rules in PROJECT_CLIENT fold repos into the client they
 * report to. "repo": every project is shown as stored. Switching is this one line.
 */
export const GROUPING: "client" | "repo" = "client";

/** First match wins; the pattern is tested against the trimmed raw value ("7-Arrow/dre-backend", "dre-infra"). */
export const PROJECT_CLIENT: readonly (readonly [RegExp, string])[] = [
  [/^7-arrow\//i, "DRE Central"],
  [/(^|\/)dre(?:[-\s]?central)?(?:[-\s]|$)/i, "DRE Central"],
  [/(^|\/)prospec(?:[-\s]|$)/i, "Prospec"],
  [/(^|\/)(?:mesa|ops)$/i, "Mesa"],
];

export function normalizeProject(raw: string | null | undefined, grouping: "client" | "repo" = GROUPING): string {
  const p = (raw ?? "").trim();
  if (!p) return NO_PROJECT;
  if (grouping === "repo") return p;
  for (const [re, client] of PROJECT_CLIENT) if (re.test(p)) return client;
  return p;
}

/** A salida carries no project of its own: the repo or Basecamp project it goes to stands in. */
export function destinationProject(d: Destination): string {
  if (d.kind === "github_review" || d.kind === "github_comment") return d.repo;
  if (d.kind === "slack_thread" || d.kind === "slack_channel") return "";
  return "project" in d ? d.project : "";
}

// ---------- rows -> board ----------

export const KINDS = ["tickets", "mensajes", "reviews", "tarjetas"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = {
  tickets: "Tickets cerrados",
  mensajes: "Mensajes enviados",
  reviews: "Reviews aprobadas",
  tarjetas: "Tarjetas hechas",
};

/** What the repo hands over (see repo/week.ts). `ticket*` come from the linked ticket, null when none. */
export interface DoneRows {
  tickets: { id: string; ref: string; title: string; project: string; closedAt: string; isSample: boolean }[];
  salidas: {
    id: string;
    title: string;
    destination: Destination;
    permalink: string | null;
    sentAt: string;
    ticketRef: string | null;
    ticketProject: string | null;
    /** The write behind a review's approval: shown under Reviews aprobadas, not as a message. */
    reviewId: string | null;
    isSample: boolean;
  }[];
  reviews: {
    id: string;
    repo: string;
    pr: number;
    at: string;
    ticketRef: string | null;
    ticketProject: string | null;
    isSample: boolean;
  }[];
  tasks: {
    id: string;
    title: string;
    project: string;
    url: string | null;
    at: string;
    ticketId: string | null;
    ticketRef: string | null;
    ticketProject: string | null;
    isSample: boolean;
  }[];
}

export interface Entry {
  id: string;
  kind: Kind;
  /** ISO instant. */
  at: string;
  title: string;
  /** Where the line points: a Mesa path (`/tickets?t=t36`) or an external URL; null when there is nothing to open. */
  href: string | null;
  external: boolean;
  isSample: boolean;
}

export interface Section {
  kind: Kind;
  label: string;
  entries: Entry[];
}

export interface ProjectGroup {
  name: string;
  count: number;
  sections: Section[];
}

const ticketHref = (ref: string) => `/tickets?t=${encodeURIComponent(ref)}`;
const prUrl = (repo: string, pr: number) => `https://github.com/${repo}/pull/${pr}`;
/** The ticket's project wins when linked and set; otherwise the row's own. */
const inherit = (ticket: string | null, own: string) => (ticket && ticket.trim() ? ticket : own);

/** Group the week's rows by project, then kind. Dedupe: an approval write is a review, a card whose ticket closed this week is that ticket. */
export function groupWeek(rows: DoneRows, grouping: "client" | "repo" = GROUPING): ProjectGroup[] {
  const closedIds = new Set(rows.tickets.map((t) => t.id));
  const byProject = new Map<string, Map<Kind, Entry[]>>();
  const add = (project: string, e: Entry) => {
    const name = normalizeProject(project, grouping);
    const kinds = byProject.get(name) ?? new Map<Kind, Entry[]>();
    kinds.set(e.kind, [...(kinds.get(e.kind) ?? []), e]);
    byProject.set(name, kinds);
  };

  for (const t of rows.tickets) {
    add(t.project, { id: t.id, kind: "tickets", at: t.closedAt, title: `${t.ref} · ${t.title}`, href: ticketHref(t.ref), external: false, isSample: t.isSample });
  }
  for (const s of rows.salidas) {
    if (s.reviewId) continue;
    const link = s.permalink ?? (s.ticketRef ? ticketHref(s.ticketRef) : null);
    add(inherit(s.ticketProject, destinationProject(s.destination)), {
      id: s.id,
      kind: "mensajes",
      at: s.sentAt,
      title: s.title || "(sin título)",
      href: link,
      external: Boolean(s.permalink),
      isSample: s.isSample,
    });
  }
  for (const v of rows.reviews) {
    add(inherit(v.ticketProject, v.repo), { id: v.id, kind: "reviews", at: v.at, title: `${v.repo}#${v.pr}`, href: prUrl(v.repo, v.pr), external: true, isSample: v.isSample });
  }
  for (const c of rows.tasks) {
    if (c.ticketId && closedIds.has(c.ticketId)) continue;
    const href = c.url ?? (c.ticketRef ? ticketHref(c.ticketRef) : null);
    add(inherit(c.ticketProject, c.project), { id: c.id, kind: "tarjetas", at: c.at, title: c.title, href, external: Boolean(c.url), isSample: c.isSample });
  }

  const groups: ProjectGroup[] = [];
  for (const [name, kinds] of byProject) {
    const sections = KINDS.filter((k) => kinds.has(k)).map((k) => ({
      kind: k,
      label: KIND_LABEL[k],
      entries: [...kinds.get(k)!].sort((a, b) => a.at.localeCompare(b.at) || a.title.localeCompare(b.title)),
    }));
    groups.push({ name, count: sections.reduce((n, s) => n + s.entries.length, 0), sections });
  }
  // Busiest first; "Sin proyecto" always last.
  return groups.sort((a, b) => Number(a.name === NO_PROJECT) - Number(b.name === NO_PROJECT) || b.count - a.count || a.name.localeCompare(b.name));
}

/** Keep one project (by its normalized name), or all of them. An unknown name yields []. */
export const filterGroups = (groups: ProjectGroup[], project: string | null): ProjectGroup[] => (project ? groups.filter((g) => g.name === project) : groups);

// ---------- copy ----------

/**
 * Plain text for a client update: project, kind, one line per entry with its date and, when it has one,
 * its external link (a Mesa path means nothing to a client, so tickets carry none).
 */
export function weekText(groups: ProjectGroup[], range: { from: string; to: string }, fmtDate: (iso: string) => string): string {
  const out: string[] = [`Semana del ${range.from} al ${range.to}`];
  for (const g of groups) {
    out.push("", g.name);
    for (const s of g.sections) {
      out.push(`${s.label} (${s.entries.length})`);
      for (const e of s.entries) out.push(`- ${fmtDate(e.at)} · ${e.title}${e.external && e.href ? ` — ${e.href}` : ""}`);
    }
  }
  return out.join("\n");
}
