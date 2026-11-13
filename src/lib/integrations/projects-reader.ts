// The /proyectos reader (t152): fills the cache of migration 1100 from the client repos and boards in
// config/projects.json, read-only (every call through guardReadOnlyGh). Started with the GitHub worker
// (github-worker.ts startGithubWorker), so it shares its gating: githubEnabled() (MESA_GITHUB, scratch DBs off),
// sandbox off, no gh token off. The screen reads the cache only.
//
// Cadence and budget (GitHub gives 5000 REST requests and 5000 GraphQL points an hour; GraphQL is shared with
// pr-monitor and the Mesa Project):
//  - open PRs every 2 min: 1 conditional REST GET per repo. 304 = free. Worst case, every list changes every time:
//    7 repos x 30 = 210 requests/h (4.2%).
//  - PR details in the same pass, one GraphQL query for every PR that needs it: a new PR, a new head sha or
//    updated_at, checks still running or mergeability still UNKNOWN, or a detail older than 30 min (a base branch that
//    moves does not touch the PR's updated_at, and neither does a check run that finishes). 1 point up to 25 PRs,
//    2 up to 50: at most 30 x 2 = 60 points/h (1.2%).
//  - boards every 10 min: 1 point per 100 items (DRE 414 = 5, Prospec 275 = 3): 6 x 8 = 48 points/h (1%).
//  - Hard caps, measured with rateLimit.cost and the REST status of every call: 500 REST requests and 500 GraphQL
//    points per rolling hour (10%). Past a cap the reader skips work until the hour rolls; board reads also wait
//    while GitHub's own GraphQL remaining is under 1000, so pr-monitor keeps its room.
// Health goes to source_state "github_projects": ok on a good pass, degraded on a rate limit (until the reset) or an
// error, down for auth or a missing gh. The cache keeps the last good read and its time either way.
import type { Repos } from "../repo";
import { publishChange } from "../live/bus";
import { GH_USER, GhError, classify, runGh, type GhRunner } from "./gh";
import { healthNote } from "./github-ingest";
import { allRepos, loadProjects, type LoadedProjects } from "./projects-config";
import { projectsCache, type CachedPr } from "./projects-cache";
import { fetchBoard, fetchPrDetails, guardReadOnlyGh, listOpenPrs, type RateInfo } from "./projects-gh";

export const PRS_EVERY_MS = 2 * 60_000;
export const BOARD_EVERY_MS = 10 * 60_000;
export const DETAIL_MAX_AGE_MS = 30 * 60_000;
export const BUDGET = { restPerHour: 500, graphqlPointsPerHour: 500 };
export const GRAPHQL_FLOOR = 1000;
const HOUR_MS = 60 * 60_000;

/** Whether a cached PR needs its detail block (re)read. */
export function needsDetail(pr: CachedPr, now: Date): boolean {
  if (!pr.detailAt || pr.detailHead !== pr.headSha || pr.detailUpdatedAt !== pr.updatedAt) return true;
  if (pr.checks?.state === "pending" || pr.mergeable === "UNKNOWN" || pr.mergeable === null) return true;
  return now.getTime() - Date.parse(pr.detailAt) > DETAIL_MAX_AGE_MS;
}

export interface ReaderTick {
  ran: boolean;
  skipped?: "backoff" | "no_config" | "not_due";
  repos?: { read: number; notModified: number; changed: number };
  details?: { prs: number; points: number };
  boards?: { read: number; points: number; partial: string[] };
  budget?: string[];
  spend: { rest: number; points: number };
  error?: string;
}

interface Spend {
  at: number;
  rest: number;
  points: number;
}

export class ProjectsReader {
  private nextPrsAt = 0;
  private nextBoardAt = 0;
  private backoffUntil = 0;
  private spent: Spend[] = [];
  private lastRate: RateInfo | null = null;
  private busy: Promise<ReaderTick> | null = null;
  private gh: GhRunner;

  constructor(
    private r: Repos,
    gh: GhRunner = runGh,
    private login: string = GH_USER,
    private config: () => LoadedProjects = () => loadProjects(),
  ) {
    this.gh = guardReadOnlyGh(gh);
  }

  /** REST requests and GraphQL points spent in the hour before `now`. */
  spend(now = new Date()): { rest: number; points: number } {
    const from = now.getTime() - HOUR_MS;
    this.spent = this.spent.filter((s) => s.at > from);
    return this.spent.reduce((a, s) => ({ rest: a.rest + s.rest, points: a.points + s.points }), { rest: 0, points: 0 });
  }

  private record(now: Date, rest: number, points: number) {
    if (rest || points) this.spent.push({ at: now.getTime(), rest, points });
  }

  run(o: { now?: Date } = {}): Promise<ReaderTick> {
    if (this.busy) return this.busy;
    this.busy = this.pass(o.now ?? new Date()).finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async pass(now: Date): Promise<ReaderTick> {
    const t = now.getTime();
    const out: ReaderTick = { ran: false, spend: this.spend(now) };
    if (t < this.backoffUntil) return { ...out, skipped: "backoff" };
    const prsDue = t >= this.nextPrsAt;
    const boardDue = t >= this.nextBoardAt;
    if (!prsDue && !boardDue) return { ...out, skipped: "not_due" };
    const { projects } = this.config();
    if (!projects.length) return { ...out, skipped: "no_config" };
    out.ran = true;
    const cache = projectsCache(this.r.db);
    const budget: string[] = [];
    let changed = false;
    try {
      if (prsDue) {
        this.nextPrsAt = t + PRS_EVERY_MS;
        const repos = allRepos(projects);
        cache.prune(repos, projects.map((p) => p.key));
        out.repos = { read: 0, notModified: 0, changed: 0 };
        for (const repo of repos) {
          if (this.spend(now).rest >= BUDGET.restPerHour) {
            budget.push("rest");
            break;
          }
          const read = await listOpenPrs(this.gh, repo, cache.repoRead(repo)?.etag ?? null);
          out.repos.read++;
          this.record(now, read.notModified ? 0 : 1, 0);
          if (read.notModified) {
            out.repos.notModified++;
            cache.touchRepo(repo, now);
          } else if (cache.replaceRepo(repo, read.prs, { etag: read.etag, truncated: read.truncated }, now)) {
            out.repos.changed++;
            changed = true;
          }
        }
        const stale = cache.prs(repos).filter((p) => needsDetail(p, now));
        if (stale.length) {
          if (this.spend(now).points >= BUDGET.graphqlPointsPerHour) budget.push("graphql");
          else {
            const d = await fetchPrDetails(this.gh, stale, this.login);
            this.record(now, 0, d.points);
            if (d.rate) this.lastRate = d.rate;
            out.details = { prs: d.details.length, points: d.points };
            if (cache.setDetails(d.details, now)) changed = true;
          }
        }
      }
      if (boardDue) {
        this.nextBoardAt = t + BOARD_EVERY_MS;
        out.boards = { read: 0, points: 0, partial: [] };
        for (const p of projects) {
          if (this.spend(now).points >= BUDGET.graphqlPointsPerHour || (this.lastRate && this.lastRate.remaining < GRAPHQL_FLOOR)) {
            budget.push("board");
            break;
          }
          const b = await fetchBoard(this.gh, p);
          this.record(now, 0, b.points);
          if (b.rate) this.lastRate = b.rate;
          out.boards.read++;
          out.boards.points += b.points;
          if (!b.complete) out.boards.partial.push(p.key);
          if (cache.replaceBoard(p.key, p.board, b, now)) changed = true;
        }
      }
      if (budget.length) out.budget = budget;
      this.health("ok", "", now);
    } catch (err) {
      const e = err instanceof GhError ? err : classify({ code: 1, stdout: "", stderr: String(err) });
      out.error = e.message;
      const prev = this.r.sources.get("github_projects");
      const errorCount = prev.errorCount + 1;
      const reset = e.resetAt ?? (e.kind === "rate_limit" ? (this.lastRate?.resetAt ?? null) : null);
      const backoffMs =
        e.kind === "rate_limit" ? Math.max((reset ? Date.parse(reset) : t + 15 * 60_000) - t, 60_000) : Math.min(30 * 60_000, 60_000 * 2 ** (errorCount - 1));
      this.backoffUntil = t + backoffMs;
      const health = e.kind === "auth" || e.kind === "missing" || e.kind === "scope" || (e.kind !== "rate_limit" && errorCount >= 3) ? "down" : "degraded";
      this.health(health, healthNote(reset ? new GhError(e.kind, e.message, reset) : e, now), now, {
        errorCount,
        lastError: e.message,
        backoffUntil: new Date(this.backoffUntil).toISOString(),
      });
    }
    out.spend = this.spend(now);
    if (changed) publishChange({ entityType: "proyectos", entityId: "", kind: "updated" });
    return out;
  }

  private health(health: "ok" | "degraded" | "down", note: string, now: Date, extra: { errorCount?: number; lastError?: string; backoffUntil?: string } = {}) {
    const prev = this.r.sources.get("github_projects");
    this.r.sources.set(
      "github_projects",
      {
        health,
        note,
        lastChecked: now.toISOString(),
        cadenceS: PRS_EVERY_MS / 1000,
        errorCount: health === "ok" ? 0 : (extra.errorCount ?? prev.errorCount + 1),
        lastError: health === "ok" ? null : (extra.lastError ?? null),
        backoffUntil: health === "ok" ? null : (extra.backoffUntil ?? null),
      },
      now,
    );
    if (prev.health !== health || prev.note !== note) publishChange({ entityType: "source", entityId: "github_projects", kind: "health" });
  }
}

const g = globalThis as unknown as { __mesaProjectsReader?: ProjectsReader };

/** The app's reader over the shared repositories (one per process, across hot reloads). */
export function projectsReader(r: Repos): ProjectsReader {
  g.__mesaProjectsReader ??= new ProjectsReader(r);
  return g.__mesaProjectsReader;
}

/** The running reader's spend in the last hour, or null when it is not running (sandbox, scratch DB, no token). */
export function projectsReaderSpend(now = new Date()): { rest: number; points: number } | null {
  return g.__mesaProjectsReader?.spend(now) ?? null;
}
