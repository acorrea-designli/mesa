import { describe, expect, it } from "vitest";
import type { CachedPr } from "./projects-cache";
import type { ProjectConfig } from "./projects-config";
import type { BoardItem } from "./projects-gh";
import {
  buildProjectView,
  defaultStation,
  indexBoard,
  isTeToca,
  matchIssue,
  prKey,
  referencesIn,
  SIN_ESTADO,
  SIN_ISSUE,
  stationOrder,
  TREN,
  youTag,
  type MesaLink,
  type MesaReview,
} from "./projects-join";

const ME = "acorrea-designli";

const DRE: ProjectConfig = {
  key: "dre",
  name: "DRE-RMS-backlog",
  board: { owner: "7-Arrow", number: 2, ownerType: "organization" },
  boardUrl: "https://github.com/orgs/7-Arrow/projects/2",
  statusOrder: ["Blocked", "To-do", "In Development", "In QA", "Done"],
  repos: ["7-Arrow/dre-backend", "7-Arrow/dre-frontend", "7-Arrow/dre-infra"],
  issueRepo: "7-Arrow/dre-backlog",
  issueKeys: ["\\bGHI-(\\d+)\\b"],
};
const PROSPEC = { issueRepo: "designli/prospec-backlog", issueKeys: ["^(\\d+)-", "\\(#(\\d+)\\)"] };

const issue = (n: number, status: string | null, over: Partial<BoardItem> = {}): BoardItem => ({
  itemId: `I${n}`,
  contentType: "Issue",
  repo: "7-Arrow/dre-backlog",
  number: n,
  title: `Issue ${n}`,
  url: `https://github.com/7-Arrow/dre-backlog/issues/${n}`,
  state: "OPEN",
  status,
  linkedPrs: [],
  ...over,
});

const pr = (repo: string, n: number, over: Partial<CachedPr> = {}): CachedPr => ({
  repo: `7-Arrow/${repo}`,
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/7-Arrow/${repo}/pull/${n}`,
  author: "dev1",
  draft: false,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-12T10:00:00Z",
  headSha: `sha${n}`,
  headRef: `fix/${n}`,
  baseRef: "develop",
  body: "",
  requested: [],
  mergeable: "MERGEABLE",
  checks: { state: "pass", total: 3, failed: 0, pending: 0 },
  reviewDecision: null,
  myReview: null,
  closingIssues: [],
  detailHead: `sha${n}`,
  detailUpdatedAt: "2026-11-12T10:00:00Z",
  detailAt: "2026-11-13T10:00:00Z",
  seenAt: "2026-11-13T10:00:00Z",
  ...over,
});

const review = (over: Partial<MesaReview> = {}): MesaReview => ({ id: "rv_1", state: "open", headSha: "", blockers: 0, findings: 0, ...over });
const link = (over: Partial<MesaLink> = {}): MesaLink => ({ review: null, tickets: [], requested: false, ...over });

describe("references", () => {
  it("reads issue URLs, owner/repo#n and the project's issue keys; a bare #n means nothing", () => {
    expect(referencesIn("fix(GHI-484): x, see 7-Arrow/dre-frontend#608 and https://github.com/7-Arrow/dre-backlog/issues/472 and #12", DRE)).toEqual([
      "7-arrow/dre-backlog#472",
      "7-arrow/dre-frontend#608",
      "7-arrow/dre-backlog#484",
    ]);
    expect(referencesIn("219-team-queue-availability", PROSPEC, { keysOnly: true })).toEqual(["designli/prospec-backlog#219"]);
    expect(referencesIn("feat: manager assign (#219)", PROSPEC)).toEqual(["designli/prospec-backlog#219"]);
    expect(referencesIn("nothing #12 here", PROSPEC)).toEqual([]);
  });
});

describe("PR -> board issue", () => {
  const items = [
    issue(484, "In QA", { linkedPrs: ["https://github.com/7-Arrow/dre-frontend/pull/610"] }),
    issue(472, "In Development"),
    issue(468, "To-do"),
    { ...issue(123, "Done"), contentType: "PullRequest" as const, repo: "7-Arrow/dre-frontend", url: "https://github.com/7-Arrow/dre-frontend/pull/123" },
  ];
  const idx = indexBoard(items);
  const m = (p: CachedPr) => {
    const r = matchIssue(p, idx, DRE);
    return r ? [r.item.number, r.via] : null;
  };

  it("in order: the PR as a board item, Linked pull requests, closes, then title, branch and body", () => {
    expect(m(pr("dre-frontend", 123))).toEqual([123, "board"]);
    expect(m(pr("dre-frontend", 610, { title: "fix(GHI-472): other" }))).toEqual([484, "linked"]);
    expect(m(pr("dre-backend", 490, { closingIssues: ["7-Arrow/dre-backlog#472"], title: "fix(GHI-468)" }))).toEqual([472, "closes"]);
    expect(m(pr("dre-backend", 484, { title: "chore(GHI-468): drop", body: "see 7-Arrow/dre-backlog#472" }))).toEqual([468, "reference"]);
    expect(m(pr("dre-backend", 491, { headRef: "feat/GHI-472-x" }))).toEqual([472, "reference"]);
    expect(m(pr("dre-backend", 492, { body: "Part of 7-Arrow/dre-backlog#484." }))).toEqual([484, "reference"]);
  });

  it("a body naming several board issues (a release PR) or none on the board leaves the PR without issue", () => {
    expect(m(pr("dre-backend", 477, { title: "Release 9 November 2026 (v1.15.0)", headRef: "release/v1.15.0", body: "7-Arrow/dre-backlog#472 7-Arrow/dre-backlog#468" }))).toBeNull();
    expect(m(pr("dre-backend", 439, { body: "fixes #187 and 7-Arrow/dre-backlog#999" }))).toBeNull();
    // An issue key that is not on the board is not a match either.
    expect(m(pr("dre-backend", 440, { title: "feat(GHI-1000): x" }))).toBeNull();
  });
});

describe("te toca and Tu review en Mesa", () => {
  const base = { mine: false, draft: false, releaseTrain: false, requested: true, myGithubReview: null, mesa: null };
  it("his own PR, or a request with no review of his yet on GitHub or in Mesa", () => {
    expect(isTeToca(base)).toBe(true);
    expect(isTeToca({ ...base, requested: false })).toBe(false);
    expect(isTeToca({ ...base, myGithubReview: "COMMENTED" })).toBe(false);
    expect(isTeToca({ ...base, mesa: review() })).toBe(false);
    expect(isTeToca({ ...base, mesa: review({ state: "closed" }) })).toBe(true);
    expect(isTeToca({ ...base, requested: false, mine: true, draft: true })).toBe(true);
    expect(isTeToca({ ...base, draft: true })).toBe(false);
    expect(isTeToca({ ...base, releaseTrain: true })).toBe(false);
  });

  it("tags in the list's order: Tuya, bloqueante, Aprobaste, en revisión, Sin tu review", () => {
    expect(youTag({ ...base, mine: true, mesa: review({ blockers: 1 }) })).toBe("tuya");
    expect(youTag({ ...base, mesa: review({ blockers: 2, state: "approved" }) })).toBe("bloqueante");
    expect(youTag({ ...base, mesa: review({ state: "approved" }) })).toBe("aprobaste");
    expect(youTag({ ...base, mesa: review() })).toBe("en-revision");
    expect(youTag({ ...base, myGithubReview: "APPROVED" })).toBe("aprobaste");
    expect(youTag(base)).toBe("sin-review");
    expect(youTag({ ...base, requested: false })).toBeNull();
  });
});

describe("stations", () => {
  it("board order: the configured order, then the board's options, then Status values only items carry", () => {
    expect(stationOrder({ statusOrder: ["B", "A"] }, { statusOptions: ["A", "C", "b"] }, [issue(1, "D"), issue(2, "c")])).toEqual(["B", "A", "C", "D"]);
  });

  it("the default is where most is his, else the most PRs; ties go to board order", () => {
    const s = (key: string, prs: number, teToca: number) => ({ key, prs, teToca });
    expect(defaultStation([s("To-do", 3, 0), s("In QA", 5, 1), s("Done", 1, 1), s(SIN_ISSUE, 9, 0)])).toBe("In QA");
    expect(defaultStation([s("To-do", 3, 0), s("In QA", 5, 0), s(SIN_ISSUE, 9, 0)])).toBe(SIN_ISSUE);
    expect(defaultStation([s("To-do", 2, 0), s("In QA", 2, 0)])).toBe("To-do");
    expect(defaultStation([s("To-do", 0, 0), s(SIN_ISSUE, 0, 0)])).toBe("To-do");
    expect(defaultStation([])).toBeNull();
  });
});

describe("buildProjectView", () => {
  const items = [
    issue(484, "In QA", { title: "Dispositions" }),
    issue(472, "In Development"),
    issue(16, null),
    issue(300, "Done", { state: "CLOSED" }),
    { ...issue(1, null), contentType: "DraftIssue" as const, repo: null, number: null },
  ];
  const prs = [
    pr("dre-backend", 490, { title: "feat(GHI-484): backend", requested: [ME] }),
    pr("dre-frontend", 610, { title: "feat(GHI-484): frontend", author: ME }),
    pr("dre-frontend", 608, { title: "fix(GHI-484): fixes", draft: true, mergeable: "CONFLICTING" }),
    pr("dre-backend", 481, { title: "fix(GHI-472): only a Super Admin", requested: [ME] }),
    pr("dre-backend", 452, { title: "fix(seeders): never create accounts" }),
    pr("dre-frontend", 2, { title: "Create staging PR", headRef: "develop", baseRef: "staging" }),
    pr("dre-backend", 20, { title: "fix(GHI-16): rotate" }),
    { ...pr("other-repo", 1), repo: "7-Arrow/other-repo" },
  ];
  const mesa = new Map([
    [prKey("7-Arrow/dre-backend", 481), link({ review: review({ state: "approved", blockers: 1, headSha: "old" }), tickets: [{ ref: "t137", title: "Review 481", status: "waiting_andres", updatedAt: "x" }] })],
  ]);
  const v = buildProjectView({
    project: DRE,
    board: { project: "dre", owner: "7-Arrow", number: 2, title: "DRE-RMS-backlog", url: "https://github.com/orgs/7-Arrow/projects/2", statusOptions: ["Blocked", "To-do", "In Development", "In QA", "Done", "Approved"], itemCount: 5, readAt: "2026-11-13T19:30:00Z" },
    items,
    prs,
    mesa,
    login: ME,
    repoReads: [
      { repo: "7-Arrow/dre-backend", etag: null, readAt: "2026-11-13T19:38:00Z", prCount: 4, truncated: false },
      { repo: "7-Arrow/dre-frontend", etag: null, readAt: "2026-11-13T19:36:00Z", prCount: 3, truncated: false },
    ],
  });
  const byKey = (k: string) => v.prs.find((x) => x.key === k)!;

  it("hangs PRs from their issue's station, the rest on Sin issue and the release train apart", () => {
    expect(v.prs.map((x) => [x.number, x.station])).toEqual([
      [20, SIN_ESTADO],
      [481, "In Development"],
      [490, "In QA"],
      [608, "In QA"],
      [610, "In QA"],
      [452, SIN_ISSUE],
      [2, TREN],
    ]);
    expect(v.train.prs).toEqual(["7-arrow/dre-frontend#2"]);
    expect(byKey("7-arrow/dre-frontend#2").releaseTrain).toBe(true);
    expect(v.prs.some((x) => x.repo === "7-Arrow/other-repo")).toBe(false);
  });

  it("an issue with PRs in two repos is an interchange", () => {
    const gh484 = v.issues.find((i) => i.number === 484)!;
    expect(gh484).toMatchObject({ station: "In QA", interchange: true, repos: ["7-Arrow/dre-backend", "7-Arrow/dre-frontend"], prs: ["7-arrow/dre-backend#490", "7-arrow/dre-frontend#608", "7-arrow/dre-frontend#610"] });
    expect(v.issues.find((i) => i.number === 472)!.interchange).toBe(false);
  });

  it("joins Mesa: review state, blocker, a moved head, the ticket chip, te toca", () => {
    expect(byKey("7-arrow/dre-backend#481")).toMatchObject({ blocker: true, you: "bloqueante", teToca: false, tickets: [{ ref: "t137" }], mesa: { state: "approved", headMoved: true } });
    expect(byKey("7-arrow/dre-backend#490")).toMatchObject({ teToca: true, you: "sin-review", mesa: null, tickets: [] });
    expect(byKey("7-arrow/dre-frontend#610")).toMatchObject({ mine: true, teToca: true, you: "tuya" });
    expect(byKey("7-arrow/dre-frontend#608")).toMatchObject({ draft: true, conflicts: true, teToca: false });
  });

  it("stations carry counts in band order, Sin estado first and Sin issue last; the default is where most is his", () => {
    expect(v.stations.map((s) => [s.key, s.items, s.issues, s.prs, s.teToca, s.blockers, s.quiet])).toEqual([
      [SIN_ESTADO, 1, 1, 1, 0, 0, false],
      ["Blocked", 0, 0, 0, 0, 0, true],
      ["To-do", 0, 0, 0, 0, 0, true],
      ["In Development", 1, 1, 1, 0, 1, false],
      ["In QA", 1, 1, 3, 2, 0, false],
      ["Done", 0, 0, 0, 0, 0, true],
      ["Approved", 0, 0, 0, 0, 0, true],
      [SIN_ISSUE, 0, 0, 1, 0, 0, false],
    ]);
    expect(v.defaultStation).toBe("In QA");
    expect(v.counts).toEqual({ prs: 7, teToca: 2, blockers: 1, drafts: 1, sinIssue: 1, train: 1 });
  });

  it("lines per configured repo, the oldest read time, and what is missing", () => {
    expect(v.lines.map((l) => [l.label, l.prs.length, l.quiet])).toEqual([
      ["dre-backend", 4, false],
      ["dre-frontend", 3, false],
      ["dre-infra", 0, true],
    ]);
    expect(v.readAt).toEqual({ prs: "2026-11-13T19:36:00Z", board: "2026-11-13T19:30:00Z" });
    expect(v.partial).toEqual({ unreadRepos: ["7-Arrow/dre-infra"], truncatedRepos: [], noBoard: false });
  });

  it("a project with no cache yet is an empty view, not an error", () => {
    const empty = buildProjectView({ project: DRE, board: null, items: [], prs: [], mesa: new Map(), login: ME, repoReads: [] });
    expect(empty.prs).toEqual([]);
    expect(empty.partial.noBoard).toBe(true);
    expect(empty.readAt).toEqual({ prs: null, board: null });
    expect(empty.defaultStation).toBe("Blocked");
    expect(empty.boardUrl).toBe(DRE.boardUrl);
  });
});
