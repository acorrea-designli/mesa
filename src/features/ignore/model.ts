// "Ignorar proyecto": what a Hoy row or a Tablero card offers to ignore, and the sheet rows.
// Pure and client safe; unit tested in model.test.ts.
import type { IgnoreSource } from "@/lib/domain/ignore";
import type { Source } from "@/lib/domain/types";

/** The project a row or card belongs to: POST /api/ignored-projects takes source + project + label. */
export interface IgnoreTarget {
  source: Source;
  /** Project key (domain/ignore.ts projectKey): GitHub owner/repo, Slack channel id, Basecamp project name. */
  project: string;
  /** What «X» reads: the bare repo name, the channel, the Basecamp project. */
  label: string;
}

export interface IgnoredRow {
  id: string;
  source: IgnoreSource;
  project: string;
  label: string;
  /** Open items and tasks it hides right now. */
  hidden: number;
}

/** Null when there is no project to ignore (an item with no project and no key). */
export function ignoreTarget(e: { source: Source; project: string; projectKey?: string; meta?: Record<string, unknown> }): IgnoreTarget | null {
  const key = (e.projectKey || e.project || "").trim();
  if (!key) return null;
  const channel = typeof e.meta?.channel === "string" ? e.meta.channel : "";
  let label = e.project.trim();
  if (e.source === "github" && !label) label = key.split("/").at(-1) ?? key;
  if (e.source === "slack") label = channel || label;
  return { source: e.source, project: key, label: label || key };
}

const NAME: Record<IgnoreSource, string> = { github: "GitHub", slack: "Slack", basecamp: "Basecamp", claude: "Claude", "*": "Todas las fuentes" };
export const ignoreSourceName = (s: IgnoreSource) => NAME[s];

/** "Ignorar proyecto «prospec-admin»" */
export const ignoreLabel = (t: Pick<IgnoreTarget, "label">) => `Ignorar proyecto «${t.label}»`;

/** "3 ignorados" / "1 ignorado" */
export const ignoredCountLabel = (n: number) => `${n} ${n === 1 ? "ignorado" : "ignorados"}`;

/** Sheet row detail: "GitHub · designli/prospec-admin · 2 ocultos" */
export function ignoredDetail(r: IgnoredRow): string {
  const parts = [ignoreSourceName(r.source)];
  if (r.project !== r.label) parts.push(r.project);
  parts.push(r.hidden ? `${r.hidden} ${r.hidden === 1 ? "oculto" : "ocultos"}` : "nada abierto");
  return parts.join(" · ");
}
