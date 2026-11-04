import { json, route } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/** GET /api/chips -> LearnedChip[] (top 4; [] on cold start) */
export const GET = route((_req, r) => json(r.chips.top()));
