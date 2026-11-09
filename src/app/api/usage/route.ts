import { body, json, query, route } from "@/lib/api/http";
import { usageInput } from "@/lib/api/schemas";
import { usageView } from "@/lib/domain/usage";
import { tokenSummary } from "@/lib/integrations/transcripts";

export const dynamic = "force-dynamic";

/**
 * GET /api/usage[?tokens=1] -> { view, tokens }
 * `view` is the latest statusLine snapshot as the rail shows it (% remaining per window, reset time, age, stale).
 * `tokens` is the tokens spent today and this week by role and model, read incrementally from the Claude Code
 * transcripts; it is null unless asked for (`tokens=1`) or when there is no transcripts folder.
 *
 * POST /api/usage { sessionId, model, capturedAt?, fiveHour?, sevenDay? } -> { saved }
 * Called by scripts/statusline.mjs. The newest capture wins (`saved: false` when an older one arrives). Plumbing:
 * it never emits a live frame (QUIET in src/lib/live/bus.ts). Mesa never calls Anthropic and reads no credential.
 */
export const GET = route((req, r) => {
  const now = new Date();
  const withTokens = query(req).get("tokens") === "1";
  return json({ view: usageView(r.usage.snapshot(), now), tokens: withTokens ? tokenSummary(r.db, now) : null });
});

export const POST = route(async (req, r) => {
  const i = await body(req, usageInput);
  const saved = r.usage.saveSnapshot({
    capturedAt: i.capturedAt ?? new Date().toISOString(),
    sessionId: i.sessionId,
    model: i.model,
    fiveHour: i.fiveHour ?? null,
    sevenDay: i.sevenDay ?? null,
  });
  return json({ saved });
});
