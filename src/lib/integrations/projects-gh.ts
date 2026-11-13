// The read-only GitHub reads of /proyectos (t152): the open PRs of each configured repo, their details, and the items
// of each client board. Every call goes through guardReadOnlyGh, which refuses anything but a read before gh runs: no
// item added, edited or moved, no review, no comment, no label, no GraphQL mutation (t10 rule: Mesa never writes to a client's repo
// or Project). Mesa's own "Mesa" Project (github-project.ts) is a different module with its own guard.
//
// Cost (GitHub's documented GraphQL formula: one request per connection, multiplied by the parent's first/last, summed,
// divided by 100, at least 1 point; every query also reads rateLimit { cost } so the reader records what it really spent):
//  - open PRs: REST `GET repos/<r>/pulls?state=open&per_page=100` with If-None-Match. An unchanged list is a 304,
//    which GitHub does not count against the REST limit.
//  - PR details: ONE GraphQL query for every PR that needs it, across repos (aliases), 4 connections per PR
//    (latestReviews, closingIssuesReferences, commits(last:1), contexts) -> 1 point up to 25 PRs, 2 up to 50.
//  - board: `items(first:100)` + `pullRequests(first:10)` of the Linked pull requests field = 101 requests -> 1 point
//    per page of 100 items. `gh project item-list` reads every field of every item and measured 202 points per board
//    read (2026-11-13, both boards), so it is not used.
import { GhError, ghApi, ghGraphql, type GhRunner } from "./gh";
import type { ProjectConfig } from "./projects-config";

// ---------- guard ----------

/** gh subcommands that only read. `gh api` is checked separately (GET or a GraphQL query, nothing else). */
const READ_ONLY: Record<string, Set<string>> = {
  project: new Set(["item-list", "view", "field-list", "list"]),
};

const API_VALUE_FLAGS = new Set(["-H", "--header", "-X", "--method", "-q", "--jq", "-t", "--template", "--hostname", "--cache", "-p", "--preview", "--input", "-f", "-F", "--field", "--raw-field"]);
const FIELD_FLAG = /^(-f|-F|--field|--raw-field)(=|$)|^-[fF]./;

function apiMethod(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-X" || a === "--method") return (args[i + 1] ?? "").toUpperCase();
    if (a.startsWith("--method=")) return a.slice(9).toUpperCase();
    if (/^-X./.test(a)) return a.slice(2).toUpperCase();
  }
  return null;
}

function apiPath(args: string[]): string | null {
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (API_VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    return a;
  }
  return null;
}

/** The GraphQL documents in a JSON stdin body ({query} or a batch); null when it is not that shape. */
function documents(input: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }
  const bodies = Array.isArray(parsed) ? parsed : [parsed];
  const docs: string[] = [];
  for (const b of bodies) {
    const q = b && typeof b === "object" && !Array.isArray(b) ? (b as { query?: unknown }).query : undefined;
    if (typeof q !== "string") return null;
    docs.push(q);
  }
  return docs;
}

/** True when a GraphQL document has no mutation or subscription (strings and comments do not count). */
export function isReadDocument(doc: string): boolean {
  const code = doc
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/#[^\n]*/g, "");
  return !/\b(mutation|subscription)\b/.test(code);
}

const refuse = (what: string): never => {
  throw new GhError("other", `Mesa only reads client GitHub repos and Projects: ${what} is refused`);
};

/**
 * The runner every /proyectos call goes through. Lets through only:
 *  - `gh api <path>` as a GET (no -X/--method other than GET, no -f/-F fields, no body), and
 *  - `gh api graphql --input -` whose stdin is JSON with query documents only (no mutation, no subscription), and
 *  - `gh project item-list | view | field-list | list`.
 * Everything else (any other project subcommand, pr review, pr comment, issue edit, label, a POST, a mutation, ...)
 * throws before gh runs.
 */
export function guardReadOnlyGh(gh: GhRunner): GhRunner {
  return async (args, opts) => {
    const [cmd, sub] = args;
    if (cmd === "api") {
      const method = apiMethod(args);
      if (method !== null && method !== "GET") refuse(`gh api -X ${method || "?"}`);
      if (args.some((a) => FIELD_FLAG.test(a))) refuse("a gh api field (-f/-F, which makes it a POST)");
      if (apiPath(args) === "graphql") {
        const docs = opts?.input === undefined || !args.includes("--input") ? null : documents(opts.input);
        if (!docs || !docs.length) refuse("a GraphQL call without a JSON query body");
        for (const d of docs!) if (!isReadDocument(d)) refuse("a GraphQL mutation or subscription");
        return gh(args, opts);
      }
      if (args.includes("--input") || opts?.input !== undefined) refuse("a request body");
      return gh(args, opts);
    }
    if (cmd && sub && READ_ONLY[cmd]?.has(sub)) return gh(args, opts);
    return refuse(`gh ${[cmd, sub].filter(Boolean).join(" ") || "(nothing)"}`);
  };
}

// ---------- open PRs (REST, conditional) ----------

export interface OpenPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  body: string;
  requested: string[];
}

interface RestPull {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  created_at: string;
  updated_at: string;
  body?: string | null;
  user?: { login?: string } | null;
  head?: { sha?: string; ref?: string };
  base?: { ref?: string };
  requested_reviewers?: ({ login?: string } | null)[];
}

export const PAGE = 100;
export const BODY_MAX = 8000;

export interface OpenPrsRead {
  /** 304: unchanged since `etag` (no PRs in the answer, free). */
  notModified: boolean;
  etag: string | null;
  prs: OpenPr[];
  truncated: boolean;
}

export async function listOpenPrs(gh: GhRunner, repo: string, etag: string | null): Promise<OpenPrsRead> {
  const res = await ghApi(gh, `repos/${repo}/pulls?state=open&per_page=${PAGE}`, etag ? { "If-None-Match": etag } : {});
  if (res.status === 304) return { notModified: true, etag, prs: [], truncated: false };
  let list: RestPull[];
  try {
    list = JSON.parse(res.body) as RestPull[];
  } catch {
    throw new GhError("other", `GitHub returned invalid JSON for ${repo} pulls`);
  }
  if (!Array.isArray(list)) throw new GhError("other", `GitHub returned no PR list for ${repo}`);
  return {
    notModified: false,
    etag: res.headers["etag"] ?? null,
    truncated: list.length >= PAGE,
    prs: list.map((p) => ({
      repo,
      number: p.number,
      title: p.title,
      url: p.html_url,
      author: p.user?.login ?? "",
      draft: Boolean(p.draft),
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      headSha: p.head?.sha ?? "",
      headRef: p.head?.ref ?? "",
      baseRef: p.base?.ref ?? "",
      body: (p.body ?? "").slice(0, BODY_MAX),
      requested: (p.requested_reviewers ?? []).map((u) => u?.login ?? "").filter(Boolean),
    })),
  };
}

// ---------- PR details (one GraphQL query) ----------

export type ChecksState = "pass" | "fail" | "pending" | "none";

export interface PrDetail {
  repo: string;
  number: number;
  headSha: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
  checks: { state: ChecksState; total: number; failed: number; pending: number };
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  /** The login's latest review on GitHub (APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED), or null. */
  myReview: string | null;
  /** "owner/repo#n" of the issues this PR closes. */
  closingIssues: string[];
}

interface Count {
  state: string;
  count: number;
}
interface GqlRollup {
  state?: string | null;
  contexts?: { totalCount?: number; checkRunCountsByState?: Count[] | null; statusContextCountsByState?: Count[] | null } | null;
}
interface GqlPr {
  number: number;
  headRefOid: string;
  mergeable: PrDetail["mergeable"];
  reviewDecision: PrDetail["reviewDecision"];
  latestReviews?: { nodes?: ({ state: string; author?: { login?: string } | null } | null)[] } | null;
  closingIssuesReferences?: { nodes?: ({ number: number; repository: { nameWithOwner: string } } | null)[] } | null;
  commits?: { nodes?: ({ commit?: { statusCheckRollup?: GqlRollup | null } | null } | null)[] } | null;
}
export interface RateInfo {
  cost: number;
  remaining: number;
  resetAt: string;
}

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
const PENDING = new Set(["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "EXPECTED", "REQUESTED"]);

/** Checks of the head commit as the list shows them: pasan / fallan N de M / corriendo / none. */
export function checksSummary(rollup: GqlRollup | null | undefined): PrDetail["checks"] {
  const counts = [...(rollup?.contexts?.checkRunCountsByState ?? []), ...(rollup?.contexts?.statusContextCountsByState ?? [])];
  const total = rollup?.contexts?.totalCount ?? counts.reduce((n, c) => n + c.count, 0);
  if (!rollup || total === 0) return { state: "none", total: 0, failed: 0, pending: 0 };
  const failed = counts.filter((c) => FAILED.has(c.state)).reduce((n, c) => n + c.count, 0);
  const pending = counts.filter((c) => PENDING.has(c.state)).reduce((n, c) => n + c.count, 0);
  const st = (rollup.state ?? "").toUpperCase();
  const state: ChecksState = failed > 0 || st === "FAILURE" || st === "ERROR" ? "fail" : pending > 0 || st === "PENDING" || st === "EXPECTED" ? "pending" : "pass";
  return { state, total, failed, pending };
}

const PR_FIELDS = `number headRefOid mergeable reviewDecision
      latestReviews(first: 20) { nodes { state author { login } } }
      closingIssuesReferences(first: 10) { nodes { number repository { nameWithOwner } } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 1) { totalCount checkRunCountsByState { state count } statusContextCountsByState { state count } } } } } }`;

/** At most this many PRs per query: 4 connections each, so 50 PRs = 200 requests = 2 points. */
export const DETAIL_BATCH = 50;

/** The query for a batch: one aliased repository per repo, one aliased pullRequest per PR. Names come from the validated config. */
export function detailQuery(prs: { repo: string; number: number }[]): string {
  const byRepo = new Map<string, number[]>();
  for (const p of prs) byRepo.set(p.repo, [...(byRepo.get(p.repo) ?? []), p.number]);
  const parts = [...byRepo.entries()].map(([repo, ns], i) => {
    const [owner, name] = repo.split("/");
    if (!/^[A-Za-z0-9_.-]+$/.test(owner ?? "") || !/^[A-Za-z0-9_.-]+$/.test(name ?? "")) throw new GhError("other", `invalid repo name ${repo}`);
    const pulls = ns.map((n) => `p${Math.trunc(n)}: pullRequest(number: ${Math.trunc(n)}) { ${PR_FIELDS} }`).join("\n    ");
    return `r${i}: repository(owner: "${owner}", name: "${name}") {\n    ${pulls}\n  }`;
  });
  return `query {\n  rateLimit { cost remaining resetAt }\n  ${parts.join("\n  ")}\n}`;
}

export function toDetail(repo: string, p: GqlPr, login: string): PrDetail {
  const reviews = (p.latestReviews?.nodes ?? []).filter((r): r is NonNullable<typeof r> => !!r);
  const mine = reviews.filter((r) => r.author?.login?.toLowerCase() === login.toLowerCase() && r.state !== "PENDING").at(-1);
  return {
    repo,
    number: p.number,
    headSha: p.headRefOid,
    mergeable: p.mergeable ?? null,
    checks: checksSummary(p.commits?.nodes?.[0]?.commit?.statusCheckRollup),
    reviewDecision: p.reviewDecision ?? null,
    myReview: mine?.state ?? null,
    closingIssues: (p.closingIssuesReferences?.nodes ?? []).filter((n): n is NonNullable<typeof n> => !!n).map((n) => `${n.repository.nameWithOwner}#${n.number}`),
  };
}

/** Details of the given PRs, batched DETAIL_BATCH per query. A PR GitHub no longer has is simply absent. */
export async function fetchPrDetails(gh: GhRunner, prs: { repo: string; number: number }[], login: string): Promise<{ details: PrDetail[]; rate: RateInfo | null; points: number; queries: number }> {
  const details: PrDetail[] = [];
  let rate: RateInfo | null = null;
  let points = 0;
  let queries = 0;
  for (let i = 0; i < prs.length; i += DETAIL_BATCH) {
    const batch = prs.slice(i, i + DETAIL_BATCH);
    const data = await ghGraphql<Record<string, unknown> & { rateLimit?: RateInfo }>(gh, detailQuery(batch), {});
    queries++;
    if (data.rateLimit) {
      rate = data.rateLimit;
      points += data.rateLimit.cost;
    }
    const repos = [...new Set(batch.map((p) => p.repo))];
    repos.forEach((repo, k) => {
      const node = data[`r${k}`] as Record<string, GqlPr | null> | null | undefined;
      for (const [alias, pr] of Object.entries(node ?? {})) if (alias.startsWith("p") && pr) details.push(toDetail(repo, pr, login));
    });
  }
  return { details, rate, points, queries };
}

// ---------- board items (GraphQL, paginated) ----------

export interface BoardItem {
  itemId: string;
  contentType: "Issue" | "PullRequest" | "DraftIssue";
  repo: string | null;
  number: number | null;
  title: string;
  url: string | null;
  state: string | null;
  status: string | null;
  linkedPrs: string[];
}

export interface BoardRead {
  title: string;
  url: string;
  statusOptions: string[];
  items: BoardItem[];
  points: number;
  pages: number;
  rate: RateInfo | null;
}

const BOARD_QUERY = (ownerType: "organization" | "user") => `query($owner: String!, $number: Int!, $after: String) {
  rateLimit { cost remaining resetAt }
  owner: ${ownerType}(login: $owner) {
    projectV2(number: $number) {
      title url
      field(name: "Status") { ... on ProjectV2SingleSelectField { options { name } } }
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isArchived
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          linked: fieldValueByName(name: "Linked pull requests") { ... on ProjectV2ItemFieldPullRequestValue { pullRequests(first: 10) { nodes { url } } } }
          content {
            __typename
            ... on Issue { number title url issueState: state repository { nameWithOwner } }
            ... on PullRequest { number title url prState: state repository { nameWithOwner } }
            ... on DraftIssue { title }
          }
        }
      }
    }
  }
}`;

interface GqlItem {
  id: string;
  isArchived?: boolean;
  status?: { name?: string } | null;
  linked?: { pullRequests?: { nodes?: ({ url: string } | null)[] } } | null;
  // Issue.state and PullRequest.state have different enum types, so GraphQL needs them under two aliases.
  content?: { __typename: string; number?: number; title?: string; url?: string; issueState?: string; prState?: string; repository?: { nameWithOwner: string } } | null;
}
interface GqlBoard {
  rateLimit?: RateInfo;
  owner?: {
    projectV2?: {
      title: string;
      url: string;
      field?: { options?: { name: string }[] } | null;
      items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (GqlItem | null)[] };
    } | null;
  } | null;
}

/** A board of 2000 items is 20 pages (20 points); more than that is not read (the screen says the board is partial). */
export const BOARD_MAX_PAGES = 20;

export function toBoardItem(n: GqlItem): BoardItem | null {
  const c = n.content;
  if (!c || n.isArchived) return null;
  const type = c.__typename === "Issue" || c.__typename === "PullRequest" || c.__typename === "DraftIssue" ? c.__typename : null;
  if (!type) return null;
  return {
    itemId: n.id,
    contentType: type,
    repo: c.repository?.nameWithOwner ?? null,
    number: c.number ?? null,
    title: c.title ?? "",
    url: c.url ?? null,
    state: c.issueState ?? c.prState ?? null,
    status: n.status?.name ?? null,
    linkedPrs: (n.linked?.pullRequests?.nodes ?? []).filter((x): x is { url: string } => !!x?.url).map((x) => x.url),
  };
}

export async function fetchBoard(gh: GhRunner, p: Pick<ProjectConfig, "board">): Promise<BoardRead & { complete: boolean }> {
  const out: BoardRead & { complete: boolean } = { title: "", url: "", statusOptions: [], items: [], points: 0, pages: 0, rate: null, complete: false };
  let after: string | null = null;
  for (let page = 0; page < BOARD_MAX_PAGES; page++) {
    const data: GqlBoard = await ghGraphql<GqlBoard>(gh, BOARD_QUERY(p.board.ownerType), { owner: p.board.owner, number: p.board.number, after });
    out.pages++;
    if (data.rateLimit) {
      out.rate = data.rateLimit;
      out.points += data.rateLimit.cost;
    }
    const proj = data.owner?.projectV2;
    if (!proj) throw new GhError("not_found", `GitHub Project ${p.board.owner}/${p.board.number} not found`);
    out.title = proj.title;
    out.url = proj.url;
    out.statusOptions = (proj.field?.options ?? []).map((o) => o.name);
    for (const n of proj.items.nodes) {
      const it = n ? toBoardItem(n) : null;
      if (it) out.items.push(it);
    }
    if (!proj.items.pageInfo.hasNextPage) {
      out.complete = true;
      break;
    }
    after = proj.items.pageInfo.endCursor;
  }
  return out;
}
