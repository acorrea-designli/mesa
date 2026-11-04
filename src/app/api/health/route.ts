import { json, route } from "@/lib/api/http";
import { mesaEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** GET /api/health -> { ok, now, env } (env: live | sandbox, so a session can tell which board answered) */
export const GET = route(() => json({ ok: true, now: new Date().toISOString(), env: mesaEnv() }));
