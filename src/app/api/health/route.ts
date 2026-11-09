import { json, route } from "@/lib/api/http";
import { mesaEnv } from "@/lib/env";
import { buildInfo } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * GET /api/health -> { ok, now, env, version } (env: live | sandbox, so a session can tell which board answered;
 * version: { sha, startedAt }, the build this process runs, so an open tab can tell it is out of date. No secrets.)
 */
export const GET = route(() => json({ ok: true, now: new Date().toISOString(), env: mesaEnv(), version: buildInfo() }));
