import { json, route } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/** GET /api/sources -> { sources: SourceState[] } (sweep state + health; feeds the rail notice) */
export const GET = route((_req, r) => json({ sources: r.sources.list() }));
