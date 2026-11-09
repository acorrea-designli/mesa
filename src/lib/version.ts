// The build the server is running: the short git sha and when this process started. scripts/serve.mjs reads the sha
// from git and sets MESA_BUILD_SHA / MESA_STARTED_AT before it starts Next, so the pair changes on every merge (sha)
// and every restart (time). Without them (next start by hand, tests) the sha is "dev" and the start time is when this
// process began. Public on purpose: GET /api/health carries it, and it holds no secret.

export interface BuildInfo {
  sha: string;
  /** ISO 8601 */
  startedAt: string;
}

const SHA = /^[0-9a-f]{4,40}$/i;

/** Pure: env + clock -> BuildInfo. Junk in the env reads as unset. */
export function resolveBuild(env: Record<string, string | undefined>, now: number, uptimeSec: number): BuildInfo {
  const sha = env.MESA_BUILD_SHA?.trim() ?? "";
  const at = env.MESA_STARTED_AT?.trim() ?? "";
  const startedAt = at && Number.isFinite(Date.parse(at)) ? new Date(Date.parse(at)).toISOString() : new Date(Math.round((now - uptimeSec * 1000) / 1000) * 1000).toISOString();
  return { sha: SHA.test(sha) ? sha.toLowerCase().slice(0, 12) : "dev", startedAt };
}

const KEY = "__mesaBuildInfo";

/** Computed once per process (route modules may be loaded more than once, the answer must not drift). */
export function buildInfo(): BuildInfo {
  const g = globalThis as typeof globalThis & { [KEY]?: BuildInfo };
  return (g[KEY] ??= resolveBuild(process.env, Date.now(), process.uptime()));
}
