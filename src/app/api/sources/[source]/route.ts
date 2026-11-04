import { body, json, route } from "@/lib/api/http";
import { healthSource, sourcePatch } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

type P = { source: string };

/** GET /api/sources/:source -> { source: SourceState } (defaults if never reported) */
export const GET = route<P>((_req, r, p) => json({ source: r.sources.get(healthSource.parse(p.source)) }));

/**
 * PATCH /api/sources/:source { health?, note?, watermark?, lastCheckedAt?, lastNewAt?, backoffUntil?, cadenceS? }
 * -> { source, resumed }. Leaving "down" resumes salidas queued for this source.
 */
export const PATCH = route<P>(async (req, r, p) => {
  const out = r.sources.set(healthSource.parse(p.source), await body(req, sourcePatch));
  return json(out);
});
