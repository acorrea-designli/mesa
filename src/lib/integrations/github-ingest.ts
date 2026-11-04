// GitHub ingest, server side. Two reads with Andrés's gh login:
//  1. GET /notifications, conditional (If-Modified-Since) and never faster than X-Poll-Interval.
//     It is the cheap "did anything change" probe.
//  2. The open PRs where he is a requested reviewer (REST search: GraphQL is shared with
//     pr-monitor and gets rate limited). Each becomes an item (source github, kind pr_review,
//     externalId pr:<owner>/<repo>#<n>); a request that disappears moves its item to Hecho.
// Mesa never writes reviews or comments here: those are salidas the lead sends.
import type { ItemInput } from "../repo/items";
import type { Repos } from "../repo";
import type { Item, SourceState } from "../domain/types";
import { classify, ghApi, GhError, type GhRunner } from "./gh";
import { publishChange } from "../live/bus";

export const MIN_POLL_S = 60;
const REVIEW_REFRESH_MS = 5 * 60_000;

// ---------- notifications ----------

export interface NotificationsPoll {
  status: number; // 200 changed, 304 not modified
  changed: boolean;
  lastModified: string | null;
  pollIntervalS: number;
  count: number;
}

/** One conditional GET /notifications. `since` is the last Last-Modified we saw. */
export async function pollNotifications(gh: GhRunner, lastModified: string | null): Promise<NotificationsPoll> {
  const res = await ghApi(gh, "/notifications?per_page=50", lastModified ? { "If-Modified-Since": lastModified } : {});
  const pollIntervalS = Math.max(MIN_POLL_S, Number(res.headers["x-poll-interval"]) || MIN_POLL_S);
  if (res.status === 304) return { status: 304, changed: false, lastModified, pollIntervalS, count: 0 };
  let count = 0;
  try {
    const list = JSON.parse(res.body) as unknown[];
    count = Array.isArray(list) ? list.length : 0;
  } catch {
    /* body is not needed beyond the count */
  }
  return { status: res.status, changed: true, lastModified: res.headers["last-modified"] ?? lastModified, pollIntervalS, count };
}

// ---------- review requests ----------

export interface ReviewRequest {
  repo: string; // owner/name
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  updatedAt: string;
}

interface SearchIssue {
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
  draft?: boolean;
  updated_at: string;
  user?: { login?: string } | null;
}

/** Open PRs where the gh user is a requested reviewer (directly or through a team). */
export async function fetchReviewRequests(gh: GhRunner): Promise<{ requests: ReviewRequest[]; complete: boolean }> {
  const res = await ghApi(gh, "search/issues?q=" + encodeURIComponent("is:pr is:open review-requested:@me archived:false") + "&per_page=100");
  const data = JSON.parse(res.body) as { total_count: number; incomplete_results: boolean; items: SearchIssue[] };
  const requests = data.items.map((i) => ({
    repo: i.repository_url.replace(/^https:\/\/api\.github\.com\/repos\//, ""),
    number: i.number,
    title: i.title,
    url: i.html_url,
    author: i.user?.login ?? "",
    draft: Boolean(i.draft),
    updatedAt: i.updated_at,
  }));
  return { requests, complete: !data.incomplete_results && data.total_count <= data.items.length };
}

export interface PrDetail {
  additions: number;
  deletions: number;
  head: string;
  /** Andrés's latest review on the PR, if any: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED. */
  myReview: string | null;
  myReviewHead: string | null;
}

export async function fetchPrDetail(gh: GhRunner, repo: string, n: number, login: string): Promise<PrDetail> {
  const pr = JSON.parse((await ghApi(gh, `repos/${repo}/pulls/${n}`)).body) as { additions: number; deletions: number; head: { sha: string } };
  const reviews = JSON.parse((await ghApi(gh, `repos/${repo}/pulls/${n}/reviews?per_page=100`)).body) as {
    state: string;
    commit_id: string;
    user?: { login?: string } | null;
  }[];
  const mine = reviews.filter((r) => r.user?.login === login && r.state !== "PENDING").at(-1);
  return { additions: pr.additions, deletions: pr.deletions, head: pr.head.sha, myReview: mine?.state ?? null, myReviewHead: mine?.commit_id ?? null };
}

export const prExternalId = (repo: string, n: number) => `pr:${repo}#${n}`;

const REVIEW_LABEL: Record<string, string> = {
  APPROVED: "aprobado antes",
  CHANGES_REQUESTED: "pediste cambios",
  COMMENTED: "comentaste",
  DISMISSED: "revisión descartada",
};

/** "+120 −34 · sin revisar" */
export function prExcerpt(d: Pick<PrDetail, "additions" | "deletions" | "myReview" | "myReviewHead" | "head">): string {
  const state = d.myReview ? (REVIEW_LABEL[d.myReview] ?? d.myReview.toLowerCase()) : "sin revisar";
  const moved = d.myReview && d.myReviewHead && d.myReviewHead !== d.head ? " · commits nuevos" : "";
  return `+${d.additions} −${d.deletions} · ${state}${moved}`;
}

export function toItemInput(rr: ReviewRequest, d: PrDetail | null): ItemInput {
  return {
    source: "github",
    externalId: prExternalId(rr.repo, rr.number),
    kind: "pr_review",
    // Hoy shows "<project> · <title>": project is the repo name, the title starts at the number.
    title: `#${rr.number} · ${rr.title}`,
    excerpt: d ? prExcerpt(d) : "",
    project: rr.repo.split("/")[1] ?? rr.repo,
    url: rr.url,
    need: "approve_pr",
    waitOn: "you",
    meta: {
      repo: rr.repo,
      pr: rr.number,
      author: rr.author,
      updatedAt: rr.updatedAt,
      ...(d ? { head: d.head, additions: d.additions, deletions: d.deletions, myReview: d.myReview } : {}),
    },
  };
}

export interface ReviewSyncResult {
  requests: number;
  created: number;
  updated: number;
  done: number;
  skippedDrafts: number;
  /** Requests of ignored projects: never upserted. */
  skippedIgnored: number;
}

/**
 * Upsert one item per open review request and move the ones that disappeared to Hecho.
 * Details (+/−, Andrés's review state) are fetched only when the PR changed since the
 * last sync (meta.updatedAt), so a steady state costs one search call.
 */
export async function syncReviewRequests(r: Repos, gh: GhRunner, login: string, now = new Date()): Promise<ReviewSyncResult> {
  const { requests, complete } = await fetchReviewRequests(gh);
  const ignored = r.ignored.list();
  // Items of ignored projects stay as they are (un-ignoring brings them back): they are
  // neither refreshed nor moved to Hecho here.
  const open = r.items.list({ source: "github", includeSamples: false, ignored: "exclude" }).filter((i) => i.kind === "pr_review");
  const byExt = new Map<string, Item>(open.map((i) => [i.externalId, i]));
  const seen = new Set<string>();
  const out: ReviewSyncResult = { requests: requests.length, created: 0, updated: 0, done: 0, skippedDrafts: 0, skippedIgnored: 0 };

  for (const rr of requests) {
    if (rr.draft) {
      out.skippedDrafts++;
      continue;
    }
    const ext = prExternalId(rr.repo, rr.number);
    if (r.ignored.isItemIgnored({ source: "github", externalId: ext, project: rr.repo.split("/")[1] ?? rr.repo }, ignored)) {
      out.skippedIgnored++;
      continue;
    }
    seen.add(ext);
    const existing = byExt.get(ext);
    const fresh = existing && existing.meta?.updatedAt === rr.updatedAt && existing.station !== "done";
    if (fresh) continue;
    let detail: PrDetail | null = null;
    try {
      detail = await fetchPrDetail(gh, rr.repo, rr.number, login);
    } catch (err) {
      if (err instanceof GhError && err.kind === "rate_limit") throw err;
      // A PR we cannot read in detail still enters with its title.
    }
    const input = toItemInput(rr, detail);
    // A request that came back (re-requested after a push) returns to the inbox.
    if (existing?.station === "done") input.station = "inbox";
    const { item, created } = r.items.upsert(input, now);
    if (created) out.created++;
    else out.updated++;
    publishChange({ entityType: "item", entityId: item.id, kind: created ? "created" : "updated" });
  }

  // Only trust absences when the search returned everything.
  if (complete) {
    for (const it of open) {
      if (seen.has(it.externalId) || it.station === "done") continue;
      r.items.update(it.id, { station: "done", waitOn: "none" }, now);
      out.done++;
      publishChange({ entityType: "item", entityId: it.id, kind: "done" });
    }
  }
  return out;
}

// ---------- the poller ----------

export interface IngestState {
  lastModified: string | null;
  pollIntervalS: number;
  nextPollAt: number;
  nextReviewSyncAt: number;
}

export const initialIngestState = (s: Pick<SourceState, "watermark" | "cadenceS">): IngestState => ({
  lastModified: s.watermark,
  pollIntervalS: Math.max(MIN_POLL_S, s.cadenceS || MIN_POLL_S),
  nextPollAt: 0,
  nextReviewSyncAt: 0,
});

export interface TickResult {
  polled: boolean;
  notifications?: NotificationsPoll;
  reviews?: ReviewSyncResult;
  error?: string;
}

/**
 * One poller step at `now`: polls notifications when due (never before X-Poll-Interval),
 * and syncs review requests when the notifications changed, every 5 min regardless (a
 * removed request does not always notify), or when forced (POST /api/github/sync).
 * Records watermark, cadence and health in source_state.github.
 */
export async function ingestTick(
  r: Repos,
  gh: GhRunner,
  st: IngestState,
  o: { now?: Date; force?: boolean; login: string },
): Promise<TickResult> {
  const now = o.now ?? new Date();
  const t = now.getTime();
  const pollDue = t >= st.nextPollAt;
  if (!pollDue && !o.force) return { polled: false };
  const out: TickResult = { polled: false };
  try {
    let changed = false;
    if (pollDue) {
      const n = await pollNotifications(gh, st.lastModified);
      out.polled = true;
      out.notifications = n;
      st.lastModified = n.lastModified;
      st.pollIntervalS = n.pollIntervalS;
      st.nextPollAt = t + n.pollIntervalS * 1000;
      changed = n.changed;
    }
    let found = 0;
    if (changed || o.force || t >= st.nextReviewSyncAt) {
      out.reviews = await syncReviewRequests(r, gh, o.login, now);
      st.nextReviewSyncAt = t + REVIEW_REFRESH_MS;
      found = out.reviews.created;
    }
    const prev = r.sources.get("github");
    r.sources.set(
      "github",
      {
        health: "ok",
        note: "",
        watermark: st.lastModified,
        lastChecked: now.toISOString(),
        cadenceS: st.pollIntervalS,
        backoffUntil: null,
        errorCount: 0,
        lastError: null,
        ...(found > 0 ? { lastNewAt: now.toISOString() } : {}),
      },
      now,
    );
    if (prev.health !== "ok") publishChange({ entityType: "source", entityId: "github", kind: "health" });
  } catch (err) {
    const e = err instanceof GhError ? err : classify({ code: 1, stdout: "", stderr: String(err) });
    out.error = e.message;
    const prev = r.sources.get("github");
    const errorCount = prev.errorCount + 1;
    const backoffMs = e.kind === "rate_limit" && e.resetAt ? Math.max(Date.parse(e.resetAt) - t, 60_000) : Math.min(30 * 60_000, 60_000 * 2 ** (errorCount - 1));
    st.nextPollAt = t + backoffMs;
    st.nextReviewSyncAt = Math.max(st.nextReviewSyncAt, st.nextPollAt);
    r.sources.set(
      "github",
      {
        health: e.kind === "rate_limit" ? "degraded" : errorCount >= 3 || e.kind === "auth" || e.kind === "missing" ? "down" : "degraded",
        note: healthNote(e, now),
        lastChecked: now.toISOString(),
        backoffUntil: new Date(t + backoffMs).toISOString(),
        errorCount,
        lastError: e.message,
      },
      now,
    );
    publishChange({ entityType: "source", entityId: "github", kind: "health" });
  }
  return out;
}

const hhmm = (d: Date) => d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });

/** The rail note (Spanish UI copy). */
export function healthNote(e: GhError, now: Date): string {
  switch (e.kind) {
    case "rate_limit":
      return `límite de API · ${hhmm(e.resetAt ? new Date(e.resetAt) : now)}`;
    case "auth":
      return "gh sin sesión";
    case "missing":
      return "gh no está instalado";
    case "scope":
      return "sin permiso";
    default:
      return "sin conexión";
  }
}
