// The server-side GitHub loop, started from src/instrumentation.ts.
//  - notifications + review requests (github-ingest), at X-Poll-Interval;
//  - Project push of pending tasks every few seconds, pull every 2 min (github-project).
// Health goes to source_state rows "github" and "github_project" (rail notice, Estados B).
//
// Enabled when MESA_GITHUB=on, or when MESA_GITHUB is unset and MESA_DB is unset (the real
// board on data/mesa.db). Dev servers on scratch databases (MESA_DB=…) do not touch GitHub
// unless they opt in, so test data never reaches the real Project. In sandbox (MESA_ENV=sandbox) it is
// always off, MESA_GITHUB=on included: no polling, no Project push or pull.
import { isSandbox } from "../env";
import { repos, type Repos } from "../repo";
import { GH_USER, GhError, runGh, type GhRunner } from "./gh";
import { ingestTick, initialIngestState, healthNote, type IngestState, type TickResult } from "./github-ingest";
import { ensureProject, pullProject, pushPending, readProjectSettings, type ProjectSettings, type PullResult, type PushResult } from "./github-project";
import { publishChange } from "../live/bus";

export function githubEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isSandbox(env)) return false;
  const v = env.MESA_GITHUB?.toLowerCase();
  if (v === "on" || v === "1" || v === "true") return true;
  if (v === "off" || v === "0" || v === "false") return false;
  return !env.MESA_DB;
}

const TICK_MS = 5_000;
const PULL_EVERY_MS = 120_000;
const ENSURE_RETRY_MS = 10 * 60_000;

export interface SyncReport {
  ingest?: TickResult;
  project?: { url: string | null; created?: boolean; push?: PushResult; pull?: PullResult; error?: string };
}

export class GithubWorker {
  private ingest: IngestState;
  private project: ProjectSettings | null;
  private nextPullAt = 0;
  private nextEnsureAt = 0;
  private busy: Promise<SyncReport> | null = null;

  constructor(
    private r: Repos,
    private gh: GhRunner = runGh,
    private login: string = GH_USER,
  ) {
    this.ingest = initialIngestState(r.sources.get("github"));
    this.project = readProjectSettings(r.db);
  }

  /** One pass. Concurrent callers share the pass in flight (POST /api/github/sync during a tick). */
  run(o: { force?: boolean; now?: Date } = {}): Promise<SyncReport> {
    if (this.busy) return this.busy;
    this.busy = this.pass(o).finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async pass(o: { force?: boolean; now?: Date }): Promise<SyncReport> {
    const now = o.now ?? new Date();
    const out: SyncReport = {};
    out.ingest = await ingestTick(this.r, this.gh, this.ingest, { now, force: o.force, login: this.login });
    out.project = await this.syncProject(now, Boolean(o.force));
    return out;
  }

  private async syncProject(now: Date, force: boolean): Promise<NonNullable<SyncReport["project"]>> {
    const t = now.getTime();
    const res: NonNullable<SyncReport["project"]> = { url: this.project?.url ?? null };
    try {
      if (!this.project) {
        if (!force && t < this.nextEnsureAt) return res;
        this.nextEnsureAt = t + ENSURE_RETRY_MS;
        const e = await ensureProject(this.r.db, this.gh, this.login);
        this.project = e.project;
        res.created = e.created;
        res.url = e.project.url;
      }
      const hasPending = this.r.tasks.pendingSync().some((x) => !x.isSample);
      if (hasPending) res.push = await pushPending(this.r, this.gh, this.project, () => now);
      if (force || t >= this.nextPullAt) {
        this.nextPullAt = t + PULL_EVERY_MS;
        res.pull = await pullProject(this.r, this.gh, this.project, () => now);
      }
      if (hasPending || res.pull) this.health("ok", "", now);
    } catch (err) {
      const e = err instanceof GhError ? err : new GhError("other", String(err));
      res.error = e.message;
      // The rail reads "GitHub Project · sin permiso" for a token without the project scope.
      this.health(e.kind === "scope" || e.kind === "auth" || e.kind === "missing" ? "down" : "degraded", healthNote(e, now), now, e.message);
      if (e.kind === "rate_limit") this.nextPullAt = t + 15 * 60_000;
    }
    return res;
  }

  private health(health: "ok" | "degraded" | "down", note: string, now: Date, lastError: string | null = null) {
    const prev = this.r.sources.get("github_project");
    this.r.sources.set(
      "github_project",
      {
        health,
        note,
        lastChecked: now.toISOString(),
        errorCount: health === "ok" ? 0 : prev.errorCount + 1,
        lastError,
        watermark: this.project?.url ?? prev.watermark,
      },
      now,
    );
    if (prev.health !== health || prev.note !== note) publishChange({ entityType: "source", entityId: "github_project", kind: "health" });
  }
}

const g = globalThis as unknown as { __mesaGithub?: { worker: GithubWorker; timer: NodeJS.Timeout | null } };

/** The app's worker over the shared repositories. */
export function githubWorker(): GithubWorker {
  g.__mesaGithub ??= { worker: new GithubWorker(repos()), timer: null };
  return g.__mesaGithub.worker;
}

/** Start the loop (idempotent across hot reloads). */
export function startGithubWorker(): void {
  if (!githubEnabled()) return;
  const worker = githubWorker();
  const state = g.__mesaGithub!;
  if (state.timer) return;
  const tick = () => void worker.run().catch((err) => console.error("[mesa] github sync failed", err));
  state.timer = setInterval(tick, TICK_MS);
  state.timer.unref();
  console.info(`[mesa] github worker on (${GH_USER}); notifications every X-Poll-Interval, Project sync every ${TICK_MS / 1000} s`);
  tick();
}
