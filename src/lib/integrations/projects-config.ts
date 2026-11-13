// The project map of the /proyectos screen (t152): config/projects.json, then the optional untracked
// config/projects.local.json merged over it the way scripts/sweep-tick.mjs merges sweep.local.json (objects merge by
// key, arrays and values replace). Server only. An unreadable or invalid file yields no projects (the reader idles and
// the screen says so) rather than a half-read map.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// Names go into GraphQL documents and REST paths as text: only GitHub's own owner/repo characters are accepted.
const NAME = /^[A-Za-z0-9_.-]+$/;
const repoName = z.string().refine((s) => {
  const [o, n, ...rest] = s.split("/");
  return !rest.length && !!o && !!n && NAME.test(o) && NAME.test(n);
}, "owner/name");
const pattern = z.string().refine((s) => {
  try {
    return new RegExp(s).source.length > 0;
  } catch {
    return false;
  }
}, "a valid regular expression");

const projectSchema = z.object({
  name: z.string().min(1),
  board: z.object({ owner: z.string().regex(NAME), number: z.number().int().positive(), ownerType: z.enum(["organization", "user"]).default("organization") }),
  statusOrder: z.array(z.string().min(1)).default([]),
  repos: z.array(repoName).min(1),
  issueRepo: repoName.nullable().default(null),
  issueKeys: z.array(pattern).default([]),
});

const fileSchema = z.object({ projects: z.record(z.string().regex(/^[a-z0-9-]+$/), projectSchema) });

export type ProjectConfigInput = z.input<typeof projectSchema>;

export interface ProjectConfig {
  key: string;
  name: string;
  board: { owner: string; number: number; ownerType: "organization" | "user" };
  boardUrl: string;
  statusOrder: string[];
  repos: string[];
  issueRepo: string | null;
  issueKeys: string[];
}

export const PROJECTS_CONFIG = join(process.cwd(), "config", "projects.json");

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(over)) base[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k] as Record<string, unknown>, v) : v;
  return base;
}

export const boardUrl = (b: { owner: string; number: number; ownerType?: string }) =>
  `https://github.com/${b.ownerType === "user" ? "users" : "orgs"}/${b.owner}/projects/${b.number}`;

/** Parse an already merged config object. Throws a ZodError on an invalid one. */
export function parseProjects(raw: unknown): ProjectConfig[] {
  const f = fileSchema.parse(raw);
  return Object.entries(f.projects).map(([key, p]) => ({
    key,
    name: p.name,
    board: p.board,
    boardUrl: boardUrl(p.board),
    statusOrder: p.statusOrder,
    repos: p.repos,
    issueRepo: p.issueRepo,
    issueKeys: p.issueKeys,
  }));
}

export interface LoadedProjects {
  projects: ProjectConfig[];
  error: string | null;
}

/** config/projects.json with config/projects.local.json merged over it. */
export function loadProjects(path: string = PROJECTS_CONFIG): LoadedProjects {
  try {
    const base = JSON.parse(readFileSync(/*turbopackIgnore: true*/ path, "utf8")) as Record<string, unknown>;
    const local = path.replace(/\.json$/, ".local.json");
    if (local !== path && existsSync(/*turbopackIgnore: true*/ local)) deepMerge(base, JSON.parse(readFileSync(/*turbopackIgnore: true*/ local, "utf8")) as Record<string, unknown>);
    return { projects: parseProjects(base), error: null };
  } catch (err) {
    return { projects: [], error: err instanceof Error ? err.message.split("\n")[0]!.slice(0, 200) : String(err) };
  }
}

/** Every repo of every project, once, in config order. */
export const allRepos = (ps: ProjectConfig[]): string[] => [...new Set(ps.flatMap((p) => p.repos))];
