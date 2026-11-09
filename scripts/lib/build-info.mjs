// The build the board is about to run: short git sha + start time, handed to Next as MESA_BUILD_SHA / MESA_STARTED_AT
// (src/lib/version.ts reads them, GET /api/health serves them). A merge changes the sha, a restart changes the time.
import { spawnSync } from "node:child_process";

/** `git rev-parse --short HEAD` in `repo`, or "" when git or the repo is missing. */
export function gitShortSha(repo, spawn = spawnSync) {
  try {
    const r = spawn("git", ["-C", repo, "rev-parse", "--short=7", "HEAD"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    const sha = (r.stdout ?? "").trim();
    return r.status === 0 && /^[0-9a-f]{4,40}$/i.test(sha) ? sha : "";
  } catch {
    return "";
  }
}

/** The env to add for Next. An explicit MESA_BUILD_SHA / MESA_STARTED_AT in `env` wins (tests, CI). */
export function buildEnv(env, repo, now = new Date(), spawn = spawnSync) {
  return { MESA_BUILD_SHA: env.MESA_BUILD_SHA?.trim() || gitShortSha(repo, spawn), MESA_STARTED_AT: env.MESA_STARTED_AT?.trim() || now.toISOString() };
}
