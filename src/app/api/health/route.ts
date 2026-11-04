import { json, route } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/** GET /api/health -> { ok, now } */
export const GET = route(() => json({ ok: true, now: new Date().toISOString() }));
