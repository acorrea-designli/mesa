import { body, json, query, route } from "@/lib/api/http";
import { usageInput } from "@/lib/api/schemas";
import { pointOf, usageView } from "@/lib/domain/usage";
import { tokenSummary } from "@/lib/integrations/transcripts";

export const dynamic = "force-dynamic";

/**
 * GET /api/usage[?tokens=1][&history=1] -> { now, view, tokens, history }
 * `view` is the latest statusLine snapshot as the rail shows it (% remaining per window, reset time, age, stale).
 * `tokens` is the tokens spent today and this week by role and model, read incrementally from the Claude Code
 * transcripts; it is null unless asked for (`tokens=1`) or when there is no transcripts folder.
 * `history` is the plan % over time (usage.history, [{ t, fiveHourUsed, sevenDayUsed }], oldest first), the series
 * the /uso charts draw; [] unless asked for (`history=1`: it is up to a few thousand points, the rail never needs it).
 *
 * POST /api/usage { sessionId, model, capturedAt?, fiveHour?, sevenDay? } -> { saved }
 * Called by scripts/statusline.mjs. The newest capture wins (`saved: false` when an older one arrives); a saved one
 * also appends a history point (at most one per 5 min). Plumbing:
 * it never emits a live frame (QUIET in src/lib/live/bus.ts). Mesa never calls Anthropic and reads no credential.
 */
export const GET = route((req, r) => {
  const now = new Date();
  const q = query(req);
  return json({
    now: now.toISOString(),
    view: usageView(r.usage.snapshot(), now),
    tokens: q.get("tokens") === "1" ? tokenSummary(r.db, now) : null,
    history: q.get("history") === "1" ? r.usage.history() : [],
  });
});

export const POST = route(async (req, r) => {
  const i = await body(req, usageInput);
  const snap = {
    capturedAt: i.capturedAt ?? new Date().toISOString(),
    sessionId: i.sessionId,
    model: i.model,
    fiveHour: i.fiveHour ?? null,
    sevenDay: i.sevenDay ?? null,
  };
  const saved = r.usage.saveSnapshot(snap);
  const point = saved ? pointOf(snap) : null;
  if (point) r.usage.appendHistory(point);
  return json({ saved });
});
