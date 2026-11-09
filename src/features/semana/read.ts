// /semana read model (server only): the week's done work, drawn by day, kind and project, listed by project.
// The week, the project and an optional day live in the URL; the page opens on the whole current week.
import {
  breakdownLabel,
  countOn,
  dayCounts,
  doneTotal,
  entryDay,
  filterGroups,
  groupWeek,
  kindCounts,
  localDay,
  newestFirst,
  onDay,
  weekOf,
  weekText,
  type Entry,
  type KindCount,
  type ProjectGroup,
} from "@/lib/domain/week";
import type { Repos } from "@/lib/repo";
import { semanaHref } from "./href";

const FMT = { timeZone: "America/Bogota" } as const;
const DAY = new Intl.DateTimeFormat("es", { ...FMT, weekday: "short", day: "numeric", month: "short" });
const SHORT = new Intl.DateTimeFormat("es", { ...FMT, weekday: "short", day: "numeric" });
const CLOCK = new Intl.DateTimeFormat("en-GB", { ...FMT, hour: "2-digit", minute: "2-digit", hour12: false });
const clean = (s: string) => s.replace(/[.,]/g, "");

/** "lun 9 nov" in Bogota. */
export const dayLabel = (iso: string): string => clean(DAY.format(new Date(iso)));
/** "lun 9": the short date a row carries. */
export const shortDay = (iso: string): string => clean(SHORT.format(new Date(iso)));
/** "17:52" in Bogota. */
export const clock = (iso: string): string => CLOCK.format(new Date(iso));

/** "9–15 nov 2026", or "30 nov – 6 dic 2026" across months. Takes the Monday and Sunday as YYYY-MM-DD. */
export function rangeLabel(monday: string, sunday: string): string {
  const a = new Date(`${monday}T12:00:00Z`);
  const b = new Date(`${sunday}T12:00:00Z`);
  const f = { timeZone: "UTC" } as const;
  const day = (d: Date) => new Intl.DateTimeFormat("es", { ...f, day: "numeric" }).format(d);
  const mon = (d: Date) => clean(new Intl.DateTimeFormat("es", { ...f, month: "short" }).format(d));
  const year = new Intl.DateTimeFormat("es", { ...f, year: "numeric" }).format(b);
  return mon(a) === mon(b) ? `${day(a)}–${day(b)} ${mon(b)} ${year}` : `${day(a)} ${mon(a)} – ${day(b)} ${mon(b)} ${year}`;
}

export interface EntryView extends Entry {
  /** "lun 9". */
  date: string;
  /** "17:52". */
  time: string;
}
export interface ProjectView {
  name: string;
  count: number;
  /** "20 tickets · 13 reviews". */
  breakdown: string;
  /** Newest first. */
  entries: EntryView[];
}
export interface DayView {
  /** YYYY-MM-DD. */
  day: string;
  /** "lun 9". */
  label: string;
  count: number;
  future: boolean;
  today: boolean;
  selected: boolean;
  /** Narrows the page to that day (or back to the week when it is the selected one); null when there is nothing to open. */
  href: string | null;
}

export interface SemanaData {
  week: { monday: string; label: string; prev: string; next: string | null; current: boolean };
  /** The project filter in effect (a shown name), or null for "Todos". */
  project: string | null;
  /** The day the page is narrowed to, or null for the whole week. */
  day: { key: string; label: string } | null;
  /** The week's done work for the project selection (the hero number). */
  total: number;
  /** Done today, in the same selection; null on any week but the current one. Unfiltered it is the rail's number. */
  todayCount: number | null;
  /** Monday to Sunday, for the project selection. */
  days: DayView[];
  /** Done per kind in the selection, biggest first. */
  kinds: KindCount[];
  /** One row per project (busiest first, "Sin proyecto" last), the bars that filter. Narrowed to the day, not to the project. */
  projects: { name: string; count: number }[];
  /** What "Todos" counts: every project, narrowed to the day. */
  projectsTotal: number;
  groups: ProjectView[];
  /** Rows show the time instead of the date: one day is picked or everything happened on one. */
  showTime: boolean;
  /** The selection as plain text, for "Copiar". */
  text: string;
  hasSample: boolean;
}

const view = (e: Entry): EntryView => ({ ...e, date: shortDay(e.at), time: clock(e.at) });
const projectView = (g: ProjectGroup): ProjectView => ({ name: g.name, count: g.count, breakdown: breakdownLabel(g), entries: newestFirst(g).map(view) });

export interface SemanaQuery {
  semana?: string;
  proyecto?: string;
  dia?: string;
}

export function loadSemana(r: Repos, q: SemanaQuery = {}, now: Date = new Date()): SemanaData {
  const week = weekOf(now, q.semana);
  const today = localDay(now);
  // Sample rows ("Datos de muestra.") show only on a board that has nothing real yet.
  const all = groupWeek(r.week.done({ start: week.startIso, end: week.endIso, includeSamples: r.week.showSamples() }));
  const project = q.proyecto && all.some((g) => g.name === q.proyecto) ? q.proyecto : null;
  const byProject = filterGroups(all, project);
  // A day outside the week, or one that has not happened, is ignored.
  const day = q.dia && q.dia >= week.monday && q.dia <= week.sunday && q.dia <= today ? q.dia : null;
  const picked = day ? onDay(byProject, day) : byProject;
  const dayScoped = day ? onDay(all, day) : all;

  const here = week.current ? null : week.monday;
  const days = dayCounts(byProject, week.monday, today).map((d) => ({
    ...d,
    label: shortDay(`${d.day}T12:00:00-05:00`),
    selected: d.day === day,
    href: d.count > 0 ? semanaHref(here, project, d.day === day ? null : d.day) : null,
  }));

  const projects = dayScoped.map((g) => ({ name: g.name, count: g.count }));
  if (project && !projects.some((p) => p.name === project)) projects.push({ name: project, count: 0 });

  const from = dayLabel(week.startIso);
  const to = dayLabel(`${week.sunday}T12:00:00-05:00`);
  const dayText = day ? dayLabel(`${day}T12:00:00-05:00`) : null;
  const entries = picked.flatMap((g) => g.sections.flatMap((s) => s.entries));
  return {
    week: { monday: week.monday, label: rangeLabel(week.monday, week.sunday), prev: week.prev, next: week.next, current: week.current },
    project,
    day: day && dayText ? { key: day, label: dayText } : null,
    total: doneTotal(byProject),
    todayCount: week.current ? countOn(byProject, today) : null,
    days,
    kinds: kindCounts(picked),
    projects,
    projectsTotal: doneTotal(dayScoped),
    groups: picked.map(projectView),
    showTime: Boolean(day) || new Set(entries.map(entryDay)).size === 1,
    text: picked.length ? weekText(picked, dayText ? { from: dayText, to: dayText } : { from, to }, dayLabel) : "",
    hasSample: entries.some((e) => e.isSample),
  };
}
