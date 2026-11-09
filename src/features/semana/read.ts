// /semana read model (server only): the week's done work, grouped by project then kind, filtered by project.
import { filterGroups, groupWeek, weekOf, weekText, type Entry, type Kind, type ProjectGroup } from "@/lib/domain/week";
import type { Repos } from "@/lib/repo";

const FMT = { timeZone: "America/Bogota" } as const;
const DAY = new Intl.DateTimeFormat("es", { ...FMT, weekday: "short", day: "numeric", month: "short" });
const clean = (s: string) => s.replace(/[.,]/g, "");

/** "lun 9 nov" in Bogota. */
export const dayLabel = (iso: string): string => clean(DAY.format(new Date(iso)));

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
  date: string;
}
export interface SectionView {
  kind: Kind;
  label: string;
  entries: EntryView[];
}
export interface ProjectView {
  name: string;
  count: number;
  sections: SectionView[];
}

export interface SemanaData {
  week: { monday: string; label: string; prev: string; next: string | null; current: boolean };
  /** The project filter in effect (a shown name), or null for "Todos". */
  project: string | null;
  /** "Todos" first, then one chip per project of the week (unfiltered counts). */
  chips: { name: string; count: number }[];
  total: number;
  groups: ProjectView[];
  /** The filtered week as plain text, for "Copiar". */
  text: string;
  hasSample: boolean;
}

const view = (g: ProjectGroup): ProjectView => ({
  ...g,
  sections: g.sections.map((s) => ({ ...s, entries: s.entries.map((e) => ({ ...e, date: dayLabel(e.at) })) })),
});

/**
 * Sample rows ("Datos de muestra.") show only on a board that has nothing real yet (the seeded board);
 * once a real ticket exists they are left out.
 */
const showSamples = (r: Repos) => (r.db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE is_sample = 0").get() as { n: number }).n === 0;

export function loadSemana(r: Repos, q: { semana?: string; proyecto?: string } = {}, now: Date = new Date()): SemanaData {
  const week = weekOf(now, q.semana);
  const all = groupWeek(r.week.done({ start: week.startIso, end: week.endIso, includeSamples: showSamples(r) }));
  const project = q.proyecto && all.some((g) => g.name === q.proyecto) ? q.proyecto : null;
  const groups = filterGroups(all, project);
  const total = all.reduce((n, g) => n + g.count, 0);
  const from = dayLabel(week.startIso);
  const to = dayLabel(`${week.sunday}T12:00:00-05:00`);
  return {
    week: { monday: week.monday, label: rangeLabel(week.monday, week.sunday), prev: week.prev, next: week.next, current: week.current },
    project,
    chips: all.map((g) => ({ name: g.name, count: g.count })),
    total,
    groups: groups.map(view),
    text: groups.length ? weekText(groups, { from, to }, dayLabel) : "",
    hasSample: groups.some((g) => g.sections.some((s) => s.entries.some((e) => e.isSample))),
  };
}
