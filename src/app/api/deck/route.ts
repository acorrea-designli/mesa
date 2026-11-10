import { json, query, route } from "@/lib/api/http";
import { deckView } from "@/lib/domain/deck";
import { githubEnabled } from "@/lib/integrations/github-worker";
import { deckVerdicts, readGhWatchState } from "@/lib/integrations/deck";
import { GH_USER, runGh } from "@/lib/integrations/gh";

export const dynamic = "force-dynamic";

/**
 * GET /api/deck[?detail=1] -> { now, view, prs }
 * `view` is the Stream Deck GitHub key as the rail shows it: the deck's own number (counts.total of
 * ~/.claude-work/gh-watch-state.json, MESA_GH_WATCH_STATE overrides the path), "stale" after 15 min, "none" ("sin dato")
 * when the file is missing or unreadable. The file is read, never written, and the number costs no GitHub call.
 * `prs` is the panel's list, only with `detail=1`: every counted PR with the deck's reason and Mesa's verdict
 * (draft, own, release train, ignored project, Saltar, approved at the current head by Andrés on GitHub, plus what Mesa
 * already has). It reads GitHub at most once per counted PR (fetchPrDetail) and a rate limit reads "sin dato"; it is
 * never polled. [] without `detail=1`.
 */
export const GET = route(async (req, r) => {
  const now = new Date();
  const view = deckView(readGhWatchState(), now);
  const detail = query(req).get("detail") === "1";
  const prs = detail ? await deckVerdicts(r, githubEnabled() ? runGh : null, GH_USER, view.items) : [];
  return json({ now: now.toISOString(), view: { ...view, items: undefined }, prs });
});
