import { json, route } from "@/lib/api/http";

export const dynamic = "force-dynamic";

import type { SourcesPayload } from "@/lib/domain/types";

/**
 * GET /api/sources -> { sources: { slack: SourceState, basecamp: SourceState, ... }, lastInteractionAt }
 * Sweep state and health keyed by source (slack and basecamp always present, with defaults),
 * plus the last UI action by Andrés, which snaps the sweep cadence back to 60 s.
 */
export const GET = route((_req, r) => {
  const sources: SourcesPayload["sources"] = { slack: r.sources.get("slack"), basecamp: r.sources.get("basecamp") };
  for (const s of r.sources.list()) sources[s.source] = s;
  const payload: SourcesPayload = { sources, lastInteractionAt: r.lastInteractionAt() };
  return json(payload);
});
