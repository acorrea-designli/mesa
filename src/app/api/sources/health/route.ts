import { body, json, route } from "@/lib/api/http";
import { healthInput } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/sources/health -> { health: SourceHealthRow[] } */
export const GET = route((_req, r) => json({ health: r.health.list() }));

/** POST /api/sources/health { source, state, note? } -> { health, resumed } (a source coming back resumes queued salidas) */
export const POST = route(async (req, r) => {
  const h = await body(req, healthInput);
  const { row, resumed } = r.health.set(h.source, h.state, h.note);
  return json({ health: row, resumed });
});
