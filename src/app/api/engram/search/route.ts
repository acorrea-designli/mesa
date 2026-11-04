import { json, query, route } from "@/lib/api/http";
import { searchEngram } from "@/lib/integrations/engram";

export const dynamic = "force-dynamic";

/**
 * GET /api/engram/search?q=&project=&limit=5 -> { status: "connected" | "offline", observations: EngramObservation[] }
 * Read only, through the engram CLI. Titles and types only. Always 200: a failure is status "offline".
 */
export const GET = route(async (req) => {
  const q = query(req);
  const limit = Number(q.get("limit") ?? 5) || 5;
  return json(await searchEngram(q.get("q") ?? "", { project: q.get("project"), limit }));
});
