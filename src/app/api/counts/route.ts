import { json, route } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/** GET /api/counts -> Counts (rail, station band) */
export const GET = route((_req, r) => json(r.counts()));
