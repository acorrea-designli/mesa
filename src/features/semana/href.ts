// /semana URL for a week, a project and a day. Every state of the page is a link, so this is the one place that
// builds them. The current week, "Todos" and the whole week stay out of the query.
export function semanaHref(week: string | null, project: string | null, day: string | null = null): string {
  const p = new URLSearchParams();
  if (week) p.set("semana", week);
  if (project) p.set("proyecto", project);
  if (day) p.set("dia", day);
  const s = p.toString();
  return s ? `/semana?${s}` : "/semana";
}
