// The Stream Deck GitHub key (t93), server side. Two read-only things:
//  1. The deck's own state file, ~/.claude-work/gh-watch-state.json, written every 3 min by the gh-watch task. It is
//     owned by that script: Mesa only reads it (and never pr-monitor-state.json), and a missing or unreadable file
//     is "sin dato", never an error. Same pattern as pr-monitor.ts.
//  2. The panel's verdict per counted PR, computed on open only: at most one fetchPrDetail per PR, plus what Mesa
//     already has (item, review, findings). The number itself costs no GitHub call.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { NotFoundError } from "../db/util";
import { deckPrView, type DeckFacts, type DeckGithub, type DeckItem, type DeckMesa, type DeckPrView } from "../domain/deck";
import type { Repos } from "../repo";
import { GhError, type GhRunner } from "./gh";
import { fetchPrDetail, isReleaseTrainPr, prExternalId } from "./github-ingest";

export const GH_WATCH_STATE = process.env.MESA_GH_WATCH_STATE ?? join(homedir(), ".claude-work", "gh-watch-state.json");

/** The parsed state file, or null when it is missing or is not JSON. Never throws. */
export function readGhWatchState(path = GH_WATCH_STATE): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const POOL = 3;

/** Mesa's side of one PR: the item (any station), the review ticket and its open findings. */
function mesaFacts(r: Repos, repo: string, num: number, itemsByExt: Map<string, { skippedAt: string | null }>): Pick<DeckFacts, "ignored" | "skipped" | "mesa"> {
  const ext = prExternalId(repo, num);
  const item = itemsByExt.get(ext);
  const ignored = r.ignored.isItemIgnored({ source: "github", externalId: ext, project: repo.split("/")[1] ?? repo });
  let mesa: DeckMesa = { hasItem: Boolean(item), ticketRef: null, reviewHead: "", openFindings: 0 };
  try {
    const rv = r.reviews.byPr(repo, num);
    const ticketRef = rv.ticketId ? r.tickets.get(rv.ticketId).ref : null;
    mesa = { hasItem: Boolean(item), ticketRef, reviewHead: rv.headSha, openFindings: rv.findings.filter((f) => f.state === "open").length };
  } catch (err) {
    if (!(err instanceof NotFoundError) && (err as Error)?.name !== "NotFoundError") throw err;
  }
  return { ignored, skipped: Boolean(item?.skippedAt), mesa };
}

/**
 * One verdict per counted item. `gh` null means GitHub is off here (sandbox, scratch DB): the rules that need GitHub
 * read "sin dato". A rate limit stops further reads and the remaining PRs read "sin dato"; any other failure is that PR only.
 * Items Mesa alone can decide (ignored project, skipped item) are not read at all.
 */
export async function deckVerdicts(r: Repos, gh: GhRunner | null, login: string, items: DeckItem[]): Promise<DeckPrView[]> {
  const itemsByExt = new Map(r.items.list({ source: "github", includeSamples: false }).map((i) => [i.externalId, i]));
  let limited = false;
  const one = async (it: DeckItem): Promise<DeckPrView> => {
    if (it.num === null) {
      const ignored = r.ignored.isItemIgnored({ source: "github", externalId: `repo:${it.repo}`, project: it.repo.split("/")[1] ?? it.repo });
      return deckPrView(it, { login, ignored, skipped: false, github: null, mesa: { hasItem: false, ticketRef: null, reviewHead: "", openFindings: 0 } });
    }
    const m = mesaFacts(r, it.repo, it.num, itemsByExt);
    let github: DeckGithub;
    if (m.ignored || m.skipped) github = { status: "none", why: "off" }; // decided by Mesa alone, never read
    else if (!gh) github = { status: "none", why: "off" };
    else if (limited) github = { status: "none", why: "rate_limit" };
    else {
      try {
        const d = await fetchPrDetail(gh, it.repo, it.num, login);
        github = {
          status: "ok",
          head: d.head,
          draft: Boolean(d.draft),
          author: d.author ?? "",
          releaseTrain: isReleaseTrainPr({ title: it.title, headRef: d.headRef, baseRef: d.baseRef }),
          myReview: d.myReview,
          myReviewHead: d.myReviewHead,
        };
      } catch (err) {
        const rate = err instanceof GhError && err.kind === "rate_limit";
        if (rate) limited = true;
        github = { status: "none", why: rate ? "rate_limit" : "error" };
      }
    }
    return deckPrView(it, { login, github, ...m });
  };
  const out: DeckPrView[] = [];
  for (let i = 0; i < items.length; i += POOL) out.push(...(await Promise.all(items.slice(i, i + POOL).map(one))));
  return out;
}
