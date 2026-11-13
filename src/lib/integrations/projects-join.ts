// The /proyectos view model (t152), as pure functions over the cache and the Mesa side. No I/O here: projects-view.ts
// reads SQLite and calls these.
//  - PR -> board issue (and its Status): the PR is itself a board item; else an issue whose "Linked pull requests" holds
//    it; else an issue the PR closes; else a reference in the title, then the branch, then the body (the body only when
//    it names exactly one board issue). No match -> "Sin issue".
//  - PR -> Mesa: its review (state, open blockers) and its tickets (reviews.ticket_id, ticket_refs, tickets.item_id).
//  - te toca = his own PR, or a review requested from him with no review of his yet (on GitHub or in Mesa).
//  - release train = isReleaseTrainPr (github-ingest.ts); an issue with PRs in 2+ repos = interchange.
//  - default station = the one where most is his, else the one with the most PRs.
import { isReleaseTrainPr } from "./github-ingest";
import type { ProjectConfig } from "./projects-config";
import type { BoardItem } from "./projects-gh";
import type { CachedBoard, CachedPr, RepoRead } from "./projects-cache";

// ---------- inputs from Mesa ----------

export interface MesaReview {
  id: string;
  state: "open" | "approving" | "approved" | "closed";
  headSha: string;
  blockers: number; // open blocker findings
  findings: number; // open findings of any label
}

export interface TicketChip {
  ref: string;
  title: string;
  status: string;
  updatedAt: string;
}

export interface MesaLink {
  review: MesaReview | null;
  tickets: TicketChip[];
  /** An open Mesa review request (item pr_review not in Hecho): GitHub asked him, teams included. */
  requested: boolean;
}

export type MesaLinks = Map<string, MesaLink>;

/** "owner/repo#n", lower case: the key every map here uses. */
export const prKey = (repo: string, n: number) => `${repo}#${n}`.toLowerCase();

// ---------- outputs ----------

export const SIN_ESTADO = "sin-estado";
export const SIN_ISSUE = "sin-issue";
export const TREN = "tren";

export type IssueMatch = "board" | "linked" | "closes" | "reference";

/** What "Tu review en Mesa" says, in the order the list checks it. */
export type YouTag = "tuya" | "bloqueante" | "aprobaste" | "en-revision" | "sin-review" | null;

export interface PrView {
  key: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  headRef: string;
  baseRef: string;
  /** null until the detail read. */
  conflicts: boolean | null;
  checks: CachedPr["checks"];
  reviewDecision: CachedPr["reviewDecision"];
  /** His latest review on GitHub. */
  myGithubReview: string | null;
  mine: boolean;
  requested: boolean;
  teToca: boolean;
  releaseTrain: boolean;
  /** The board issue (or PR item) it hangs from; null = Sin issue. */
  issue: string | null;
  issueMatch: IssueMatch | null;
  /** Station key: a Status name, SIN_ESTADO, SIN_ISSUE or TREN. */
  station: string;
  mesa: (MesaReview & { headMoved: boolean }) | null;
  blocker: boolean;
  you: YouTag;
  tickets: TicketChip[];
}

export interface IssueView {
  key: string;
  type: "Issue" | "PullRequest";
  repo: string;
  number: number;
  title: string;
  url: string | null;
  state: string | null;
  status: string | null;
  station: string;
  prs: string[];
  repos: string[];
  interchange: boolean;
}

export interface StationView {
  key: string;
  name: string;
  kind: "status" | "sin-estado" | "sin-issue";
  /** Board issues in this Status (open ones), PRs or not. */
  items: number;
  /** Issues here with at least one open PR. */
  issues: number;
  prs: number;
  teToca: number;
  blockers: number;
  quiet: boolean;
}

export interface LineView {
  repo: string;
  label: string;
  prs: string[];
  quiet: boolean;
}

export interface ProjectView {
  key: string;
  name: string;
  boardUrl: string;
  boardTitle: string;
  readAt: { prs: string | null; board: string | null };
  partial: { unreadRepos: string[]; truncatedRepos: string[]; noBoard: boolean };
  stations: StationView[];
  defaultStation: string | null;
  train: { prs: string[] };
  lines: LineView[];
  issues: IssueView[];
  prs: PrView[];
  counts: { prs: number; teToca: number; blockers: number; drafts: number; sinIssue: number; train: number };
}

// ---------- references ----------

const URL_REF = /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)/gi;
const REPO_REF = /(?<![\w./-])([\w.-]+\/[\w.-]+)#(\d+)\b/g;

/** Board-issue keys a text names: issue URLs, owner/repo#n, and the project's issue keys (GHI-484 -> issueRepo#484). */
export function referencesIn(text: string, p: Pick<ProjectConfig, "issueRepo" | "issueKeys">, o: { keysOnly?: boolean } = {}): string[] {
  const out: string[] = [];
  const push = (k: string) => {
    if (!out.includes(k)) out.push(k);
  };
  if (!o.keysOnly) {
    for (const m of text.matchAll(URL_REF)) push(prKey(m[1]!, Number(m[2])));
    for (const m of text.matchAll(REPO_REF)) push(prKey(m[1]!, Number(m[2])));
  }
  if (p.issueRepo) {
    for (const k of p.issueKeys) {
      let re: RegExp;
      try {
        re = new RegExp(k, "g");
      } catch {
        continue;
      }
      for (const m of text.matchAll(re)) if (m[1] && /^\d+$/.test(m[1])) push(prKey(p.issueRepo, Number(m[1])));
    }
  }
  return out;
}

export interface BoardIndex {
  /** Board items by their content ("owner/repo#n", lower case). */
  byContent: Map<string, BoardItem>;
  /** Issue items by the URL of a PR in their Linked pull requests (lower case). */
  byLinkedPr: Map<string, BoardItem[]>;
}

export function indexBoard(items: BoardItem[]): BoardIndex {
  const byContent = new Map<string, BoardItem>();
  const byLinkedPr = new Map<string, BoardItem[]>();
  for (const it of items) {
    if (it.repo && it.number != null && it.contentType !== "DraftIssue") byContent.set(prKey(it.repo, it.number), it);
    for (const u of it.linkedPrs) {
      const k = u.toLowerCase().replace(/\/+$/, "");
      byLinkedPr.set(k, [...(byLinkedPr.get(k) ?? []), it]);
    }
  }
  return { byContent, byLinkedPr };
}

const issueOnly = (it: BoardItem | undefined) => (it && it.contentType === "Issue" ? it : undefined);

/** The board item a PR hangs from, and how it was found. */
export function matchIssue(
  pr: Pick<CachedPr, "repo" | "number" | "url" | "title" | "headRef" | "body" | "closingIssues">,
  idx: BoardIndex,
  p: Pick<ProjectConfig, "issueRepo" | "issueKeys">,
): { item: BoardItem; via: IssueMatch } | null {
  const self = idx.byContent.get(prKey(pr.repo, pr.number));
  if (self && self.contentType === "PullRequest") return { item: self, via: "board" };
  const linked = idx.byLinkedPr.get(pr.url.toLowerCase().replace(/\/+$/, ""))?.find((i) => i.contentType === "Issue");
  if (linked) return { item: linked, via: "linked" };
  for (const c of pr.closingIssues) {
    const it = issueOnly(idx.byContent.get(c.toLowerCase()));
    if (it) return { item: it, via: "closes" };
  }
  const onBoard = (keys: string[]) => keys.map((k) => issueOnly(idx.byContent.get(k))).filter((x): x is BoardItem => !!x);
  const inTitle = onBoard(referencesIn(pr.title, p));
  if (inTitle.length) return { item: inTitle[0]!, via: "reference" };
  const inBranch = onBoard(referencesIn(pr.headRef, p, { keysOnly: true }));
  if (inBranch.length) return { item: inBranch[0]!, via: "reference" };
  const inBody = onBoard(referencesIn(pr.body, p));
  if (inBody.length === 1) return { item: inBody[0]!, via: "reference" };
  return null;
}

// ---------- the per-PR join ----------

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function youTag(pr: { mine: boolean; mesa: MesaReview | null; myGithubReview: string | null; requested: boolean }): YouTag {
  if (pr.mine) return "tuya";
  if (pr.mesa && pr.mesa.state !== "closed") {
    if (pr.mesa.blockers > 0) return "bloqueante";
    if (pr.mesa.state === "approved" || pr.mesa.state === "approving") return "aprobaste";
    return "en-revision";
  }
  if (pr.myGithubReview === "APPROVED") return "aprobaste";
  return pr.requested && !pr.myGithubReview ? "sin-review" : null;
}

/**
 * te toca: his own PR, or a review requested from him (directly on GitHub, or a team request Mesa holds as an open
 * review item) with no review of his yet, neither on GitHub nor in Mesa. Release-train PRs ask for no review, and
 * somebody else's draft is not ready for one.
 */
export function isTeToca(pr: { mine: boolean; draft: boolean; releaseTrain: boolean; requested: boolean; myGithubReview: string | null; mesa: MesaReview | null }): boolean {
  if (pr.mine) return true;
  if (pr.releaseTrain || pr.draft) return false;
  const hisReview = !!pr.myGithubReview || (!!pr.mesa && pr.mesa.state !== "closed");
  return pr.requested && !hisReview;
}

export function joinPr(pr: CachedPr, idx: BoardIndex, p: ProjectConfig, mesa: MesaLink | undefined, login: string): PrView {
  const releaseTrain = isReleaseTrainPr({ title: pr.title, headRef: pr.headRef, baseRef: pr.baseRef });
  const match = releaseTrain ? null : matchIssue(pr, idx, p);
  const mine = !!login && same(pr.author, login);
  const requested = pr.requested.some((u) => same(u, login)) || !!mesa?.requested;
  const review = mesa?.review ?? null;
  const base = { mine, draft: pr.draft, releaseTrain, requested, myGithubReview: pr.myReview, mesa: review };
  const station = releaseTrain ? TREN : match ? (match.item.status ?? SIN_ESTADO) : SIN_ISSUE;
  return {
    key: prKey(pr.repo, pr.number),
    repo: pr.repo,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.author,
    draft: pr.draft,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    headRef: pr.headRef,
    baseRef: pr.baseRef,
    conflicts: pr.mergeable === "CONFLICTING" ? true : pr.mergeable === "MERGEABLE" ? false : null,
    checks: pr.checks,
    reviewDecision: pr.reviewDecision,
    myGithubReview: pr.myReview,
    mine,
    requested,
    teToca: isTeToca(base),
    releaseTrain,
    issue: match ? prKey(match.item.repo!, match.item.number!) : null,
    issueMatch: match?.via ?? null,
    station,
    mesa: review ? { ...review, headMoved: !!review.headSha && !!pr.headSha && review.headSha !== pr.headSha } : null,
    blocker: !!review && review.state !== "closed" && review.blockers > 0,
    you: youTag(base),
    tickets: mesa?.tickets ?? [],
  };
}

// ---------- stations ----------

/** Board order: the configured statusOrder, then the board's own options, then any Status only items carry. */
export function stationOrder(p: Pick<ProjectConfig, "statusOrder">, board: Pick<CachedBoard, "statusOptions"> | null, items: BoardItem[]): string[] {
  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    if (s && !out.some((x) => same(x, s))) out.push(s);
  };
  p.statusOrder.forEach(add);
  board?.statusOptions.forEach(add);
  items.forEach((i) => add(i.status));
  return out;
}

/** The station the list opens on: most "te toca", else most PRs; ties go to board order (Sin issue last). */
export function defaultStation(stations: Pick<StationView, "key" | "prs" | "teToca">[]): string | null {
  const pick = (by: (s: Pick<StationView, "prs" | "teToca">) => number) =>
    stations.reduce<(typeof stations)[number] | null>((best, s) => (by(s) > 0 && (!best || by(s) > by(best)) ? s : best), null);
  return (pick((s) => s.teToca) ?? pick((s) => s.prs) ?? stations.find((s) => s.key !== SIN_ISSUE) ?? null)?.key ?? null;
}

/** The oldest of the read times: "Leído de GitHub · hace N min" never claims more freshness than the stalest repo. */
const oldest = (xs: (string | null | undefined)[]): string | null => xs.filter((x): x is string => !!x).sort()[0] ?? null;

export interface JoinInput {
  project: ProjectConfig;
  board: CachedBoard | null;
  items: BoardItem[];
  prs: CachedPr[];
  mesa: MesaLinks;
  login: string;
  repoReads: RepoRead[];
}

export function buildProjectView(i: JoinInput): ProjectView {
  const { project: p } = i;
  const idx = indexBoard(i.items);
  const repos = new Set(p.repos.map((r) => r.toLowerCase()));
  const prs = i.prs.filter((x) => repos.has(x.repo.toLowerCase())).map((x) => joinPr(x, idx, p, i.mesa.get(prKey(x.repo, x.number)), i.login));

  // Issues with PRs, keyed by their content.
  const issues = new Map<string, IssueView>();
  for (const pr of prs) {
    if (!pr.issue) continue;
    const it = idx.byContent.get(pr.issue)!;
    const iv =
      issues.get(pr.issue) ??
      ({
        key: pr.issue,
        type: it.contentType === "PullRequest" ? "PullRequest" : "Issue",
        repo: it.repo!,
        number: it.number!,
        title: it.title,
        url: it.url,
        state: it.state,
        status: it.status,
        station: it.status ?? SIN_ESTADO,
        prs: [],
        repos: [],
        interchange: false,
      } satisfies IssueView);
    iv.prs.push(pr.key);
    if (!iv.repos.some((r) => same(r, pr.repo))) iv.repos.push(pr.repo);
    iv.interchange = iv.repos.length > 1;
    issues.set(pr.issue, iv);
  }

  const order = stationOrder(p, i.board, i.items);
  const statusOf = (s: string | null) => (s ? (order.find((x) => same(x, s)) ?? s) : SIN_ESTADO);
  for (const pr of prs) if (pr.station !== SIN_ISSUE && pr.station !== TREN) pr.station = statusOf(pr.station === SIN_ESTADO ? null : pr.station);
  for (const iv of issues.values()) iv.station = statusOf(iv.status);

  const openItems = i.items.filter((x) => x.contentType !== "DraftIssue" && x.state !== "CLOSED" && x.state !== "MERGED");
  const station = (key: string, name: string, kind: StationView["kind"]): StationView => {
    const here = prs.filter((x) => x.station === key);
    const items = kind === "sin-issue" ? 0 : openItems.filter((x) => statusOf(x.status) === key).length;
    return {
      key,
      name,
      kind,
      items,
      issues: [...issues.values()].filter((x) => x.station === key).length,
      prs: here.length,
      teToca: here.filter((x) => x.teToca).length,
      blockers: here.filter((x) => x.blocker).length,
      quiet: here.length === 0,
    };
  };
  const stations: StationView[] = [];
  if (i.items.some((x) => x.contentType !== "DraftIssue" && !x.status) || prs.some((x) => x.station === SIN_ESTADO)) stations.push(station(SIN_ESTADO, "Sin estado", "sin-estado"));
  for (const s of order) stations.push(station(s, s, "status"));
  stations.push(station(SIN_ISSUE, "Sin issue", "sin-issue"));

  // Rows in band order: station, then issue, then repo order, then number.
  const rank = new Map(stations.map((s, n) => [s.key, n]));
  const repoRank = new Map(p.repos.map((r, n) => [r.toLowerCase(), n]));
  const sortPrs = (a: PrView, b: PrView) =>
    (rank.get(a.station) ?? 999) - (rank.get(b.station) ?? 999) ||
    (a.issue ?? "~").localeCompare(b.issue ?? "~") ||
    (repoRank.get(a.repo.toLowerCase()) ?? 99) - (repoRank.get(b.repo.toLowerCase()) ?? 99) ||
    a.number - b.number;
  prs.sort(sortPrs);
  const at = new Map(prs.map((x, n) => [x.key, n]));
  for (const iv of issues.values()) iv.prs.sort((a, b) => at.get(a)! - at.get(b)!);

  const reads = new Map(i.repoReads.map((r) => [r.repo.toLowerCase(), r]));
  return {
    key: p.key,
    name: p.name,
    boardUrl: i.board?.url || p.boardUrl,
    boardTitle: i.board?.title ?? "",
    readAt: { prs: oldest(p.repos.map((r) => reads.get(r.toLowerCase())?.readAt)), board: i.board?.readAt ?? null },
    partial: {
      unreadRepos: p.repos.filter((r) => !reads.has(r.toLowerCase())),
      truncatedRepos: p.repos.filter((r) => reads.get(r.toLowerCase())?.truncated),
      noBoard: !i.board,
    },
    stations,
    defaultStation: defaultStation(stations),
    train: { prs: prs.filter((x) => x.station === TREN).map((x) => x.key) },
    lines: p.repos.map((repo) => {
      const mine = prs.filter((x) => same(x.repo, repo)).map((x) => x.key);
      return { repo, label: repo.split("/")[1] ?? repo, prs: mine, quiet: mine.length === 0 };
    }),
    issues: [...issues.values()].sort((a, b) => (rank.get(a.station) ?? 999) - (rank.get(b.station) ?? 999) || a.number - b.number),
    prs,
    counts: {
      prs: prs.length,
      teToca: prs.filter((x) => x.teToca).length,
      blockers: prs.filter((x) => x.blocker).length,
      drafts: prs.filter((x) => x.draft).length,
      sinIssue: prs.filter((x) => x.station === SIN_ISSUE).length,
      train: prs.filter((x) => x.station === TREN).length,
    },
  };
}
