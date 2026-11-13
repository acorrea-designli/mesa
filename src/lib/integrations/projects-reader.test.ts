import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import type { GhResult } from "./gh";
import { fakeGh, header, http, ok, path } from "./test/fake-gh";
import { parseProjects } from "./projects-config";
import { projectsCache } from "./projects-cache";
import { isReadDocument } from "./projects-gh";
import { BUDGET, ProjectsReader, needsDetail } from "./projects-reader";

const ME = "acorrea-designli";
const T0 = new Date("2026-11-13T15:00:00.000Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

const config = () => ({
  projects: parseProjects({
    projects: {
      dre: {
        name: "DRE",
        board: { owner: "7-Arrow", number: 2 },
        statusOrder: ["To-do", "In QA"],
        repos: ["7-Arrow/dre-backend", "7-Arrow/dre-frontend"],
        issueRepo: "7-Arrow/dre-backlog",
        issueKeys: ["\\bGHI-(\\d+)\\b"],
      },
    },
  }),
  error: null,
});

interface Pull {
  number: number;
  title: string;
  updated_at: string;
  head: { sha: string; ref: string };
}

/** A small GitHub: two repos' open PRs (with ETags), their details and one board. Every call is recorded. */
function fakeGithub() {
  const pulls: Record<string, Pull[]> = {
    "7-Arrow/dre-backend": [{ number: 490, title: "feat(GHI-484): backend", updated_at: "2026-11-13T10:00:00Z", head: { sha: "a1", ref: "feat/GHI-484" } }],
    "7-Arrow/dre-frontend": [{ number: 610, title: "feat(GHI-484): frontend", updated_at: "2026-11-13T10:00:00Z", head: { sha: "b1", ref: "feat/GHI-484" } }],
  };
  const checks: Record<number, string> = { 490: "SUCCESS", 610: "SUCCESS" };
  const etag = (repo: string) => `W/"${pulls[repo]!.map((p) => `${p.number}:${p.updated_at}`).join(",")}"`;
  let fail: GhResult | null = null;
  const handler = (args: string[], input?: string): GhResult | undefined => {
    if (fail) return fail;
    const p = path(args);
    const m = p ? /^repos\/([^/]+\/[^/]+)\/pulls\?/.exec(p) : null;
    if (m) {
      const repo = m[1]!;
      if (header(args, "If-None-Match") === etag(repo)) return http(304, { etag: etag(repo) });
      return http(
        200,
        { etag: etag(repo) },
        pulls[repo]!.map((x) => ({ ...x, html_url: `https://github.com/${repo}/pull/${x.number}`, created_at: "2026-11-01T10:00:00Z", user: { login: "dev1" }, base: { ref: "develop" }, requested_reviewers: [{ login: ME }], body: "" })),
      );
    }
    if (args[1] === "graphql") {
      const q = JSON.parse(input!).query as string;
      const rate = { cost: 1, remaining: 4000, resetAt: "2026-11-13T16:00:00Z" };
      if (q.includes("projectV2")) {
        return ok({
          data: {
            rateLimit: rate,
            owner: {
              projectV2: {
                title: "DRE",
                url: "https://github.com/orgs/7-Arrow/projects/2",
                field: { options: [{ name: "To-do" }, { name: "In QA" }] },
                items: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [{ id: "I484", status: { name: "In QA" }, linked: null, content: { __typename: "Issue", number: 484, title: "Dispositions", url: "u", issueState: "OPEN", repository: { nameWithOwner: "7-Arrow/dre-backlog" } } }],
                },
              },
            },
          },
        });
      }
      const data: Record<string, unknown> = { rateLimit: rate };
      let r = 0;
      for (const block of q.split(/\br\d+: repository/).slice(1)) {
        const nodes: Record<string, unknown> = {};
        for (const mm of block.matchAll(/p(\d+): pullRequest/g)) {
          const n = Number(mm[1]);
          const pull = Object.values(pulls).flat().find((x) => x.number === n)!;
          nodes[`p${n}`] = {
            number: n,
            headRefOid: pull.head.sha,
            mergeable: "MERGEABLE",
            reviewDecision: "REVIEW_REQUIRED",
            latestReviews: { nodes: [] },
            closingIssuesReferences: { nodes: [] },
            commits: { nodes: [{ commit: { statusCheckRollup: { state: checks[n], contexts: { totalCount: 2, checkRunCountsByState: [{ state: checks[n] === "PENDING" ? "IN_PROGRESS" : "SUCCESS", count: 2 }] } } } }] },
          };
        }
        data[`r${r++}`] = nodes;
      }
      return ok({ data });
    }
    return undefined;
  };
  const gh = fakeGh(handler);
  return {
    gh,
    pulls,
    checks,
    failWith: (r: GhResult | null) => {
      fail = r;
    },
    restCalls: () => gh.calls.filter((c) => c.args[0] === "api" && c.args[1] !== "graphql"),
    gqlCalls: () => gh.calls.filter((c) => c.args[1] === "graphql").map((c) => JSON.parse(c.input!).query as string),
  };
}

let r: Repos;
const saved = { ...BUDGET };
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
});
afterEach(() => Object.assign(BUDGET, saved));

describe("ProjectsReader", () => {
  it("first pass: lists, details and the board land in the cache, every call a read, health ok", async () => {
    const f = fakeGithub();
    const reader = new ProjectsReader(r, f.gh.run, ME, config);
    const tick = await reader.run({ now: T0 });
    expect(tick).toMatchObject({ ran: true, repos: { read: 2, notModified: 0, changed: 2 }, details: { prs: 2, points: 1 }, boards: { read: 1, points: 1, partial: [] } });
    expect(tick.spend).toEqual({ rest: 2, points: 2 });
    const cache = projectsCache(r.db);
    expect(cache.prs().map((p) => [p.repo, p.number, p.checks?.state, p.mergeable, p.detailHead])).toEqual([
      ["7-Arrow/dre-backend", 490, "pass", "MERGEABLE", "a1"],
      ["7-Arrow/dre-frontend", 610, "pass", "MERGEABLE", "b1"],
    ]);
    expect(cache.boardItems("dre").map((i) => [i.number, i.status])).toEqual([[484, "In QA"]]);
    expect(f.gqlCalls()).toHaveLength(2); // one batched detail query for both repos, one board page
    expect(r.sources.get("github_projects")).toMatchObject({ health: "ok", lastChecked: T0.toISOString(), cadenceS: 120 });
    // Read-only toward the client: only GETs (no method, no fields, no body) and GraphQL queries.
    for (const c of f.gh.calls) {
      expect(c.args[0]).toBe("api");
      expect(c.args.some((a) => /^(-X|--method|-f|-F|--field|--raw-field)/.test(a))).toBe(false);
      if (c.args[1] === "graphql") expect(isReadDocument(JSON.parse(c.input!).query)).toBe(true);
      else expect(c.input).toBeUndefined();
    }
  });

  it("an unchanged list is a free 304, details are not read again, and the board waits for its 10 min", async () => {
    const f = fakeGithub();
    const reader = new ProjectsReader(r, f.gh.run, ME, config);
    await reader.run({ now: T0 });
    expect((await reader.run({ now: at(1) })).skipped).toBe("not_due");
    const second = await reader.run({ now: at(2) });
    expect(second).toMatchObject({ repos: { read: 2, notModified: 2, changed: 0 } });
    expect(second.details).toBeUndefined();
    expect(second.boards).toBeUndefined();
    expect(second.spend).toEqual({ rest: 2, points: 2 }); // nothing added
    expect(f.restCalls().slice(2).every((c) => header(c.args, "If-None-Match"))).toBe(true);
    expect(projectsCache(r.db).repoRead("7-Arrow/dre-backend")!.readAt).toBe(at(2).toISOString());
    const third = await reader.run({ now: at(10) });
    expect(third.boards).toMatchObject({ read: 1 });
  });

  it("re-reads the detail of a PR whose updated_at moved, and only that one", async () => {
    const f = fakeGithub();
    const reader = new ProjectsReader(r, f.gh.run, ME, config);
    await reader.run({ now: T0 });
    f.pulls["7-Arrow/dre-frontend"]![0] = { ...f.pulls["7-Arrow/dre-frontend"]![0]!, updated_at: "2026-11-13T15:01:00Z", head: { sha: "b2", ref: "feat/GHI-484" } };
    const t = await reader.run({ now: at(2) });
    expect(t).toMatchObject({ repos: { notModified: 1, changed: 1 }, details: { prs: 1 } });
    const q = f.gqlCalls().at(-1)!;
    expect(q).toContain("p610: pullRequest");
    expect(q).not.toContain("p490");
    expect(projectsCache(r.db).prs().find((p) => p.number === 610)!.detailHead).toBe("b2");
  });

  it("keeps re-reading a PR while its checks run, without any change to the PR", async () => {
    const f = fakeGithub();
    f.checks[490] = "PENDING";
    const reader = new ProjectsReader(r, f.gh.run, ME, config);
    await reader.run({ now: T0 });
    const pr490 = () => projectsCache(r.db).prs().find((p) => p.number === 490)!;
    expect(pr490().checks).toMatchObject({ state: "pending", pending: 2 });
    f.checks[490] = "SUCCESS";
    const t = await reader.run({ now: at(2) });
    expect(t.details).toMatchObject({ prs: 1 });
    expect(pr490().checks!.state).toBe("pass");
    expect((await reader.run({ now: at(4) })).details).toBeUndefined();
  });

  it("needsDetail: never read, moved, settling, or older than 30 min", () => {
    const base = { headSha: "a", updatedAt: "u", detailHead: "a", detailUpdatedAt: "u", detailAt: T0.toISOString(), mergeable: "MERGEABLE", checks: { state: "pass", total: 1, failed: 0, pending: 0 } } as never;
    const p = (over: object) => ({ ...(base as object), ...over }) as Parameters<typeof needsDetail>[0];
    expect(needsDetail(p({}), at(5))).toBe(false);
    expect(needsDetail(p({ detailAt: null }), at(5))).toBe(true);
    expect(needsDetail(p({ headSha: "b" }), at(5))).toBe(true);
    expect(needsDetail(p({ updatedAt: "v" }), at(5))).toBe(true);
    expect(needsDetail(p({ mergeable: "UNKNOWN" }), at(5))).toBe(true);
    expect(needsDetail(p({ checks: { state: "pending", total: 1, failed: 0, pending: 1 } }), at(5))).toBe(true);
    expect(needsDetail(p({}), at(31))).toBe(true);
  });

  it("a rate limit keeps the last good read, marks the rail row degraded until the reset and waits", async () => {
    const f = fakeGithub();
    const reader = new ProjectsReader(r, f.gh.run, ME, config);
    await reader.run({ now: T0 });
    f.failWith(http(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Date.parse("2026-11-13T16:00:00Z") / 1000) }, { message: "API rate limit exceeded" }));
    const t = await reader.run({ now: at(2) });
    expect(t.error).toMatch(/rate limit/i);
    const row = r.sources.get("github_projects");
    expect(row).toMatchObject({ health: "degraded", errorCount: 1, backoffUntil: "2026-11-13T16:00:00.000Z" });
    expect(row.note).toMatch(/^límite de API · /);
    expect(projectsCache(r.db).prs()).toHaveLength(2); // the cache is untouched
    const calls = f.gh.calls.length;
    expect((await reader.run({ now: at(30) })).skipped).toBe("backoff");
    expect(f.gh.calls.length).toBe(calls);
    f.failWith(null);
    await reader.run({ now: at(61) });
    expect(r.sources.get("github_projects")).toMatchObject({ health: "ok", errorCount: 0, note: "", backoffUntil: null });
  });

  it("gh without a session is down; other errors back off and go down after three", async () => {
    const f = fakeGithub();
    f.failWith({ code: 1, stdout: "", stderr: "gh auth login required: not logged in" });
    await new ProjectsReader(r, f.gh.run, ME, config).run({ now: T0 });
    expect(r.sources.get("github_projects")).toMatchObject({ health: "down", note: "gh sin sesión" });

    const r2 = createRepos(openDb(":memory:"));
    const g2 = fakeGithub();
    g2.failWith({ code: 1, stdout: "", stderr: "connection reset" });
    const reader = new ProjectsReader(r2, g2.gh.run, ME, config);
    await reader.run({ now: T0 });
    expect(r2.sources.get("github_projects")).toMatchObject({ health: "degraded", note: "sin conexión", errorCount: 1 });
    await reader.run({ now: at(1) });
    await reader.run({ now: at(3) });
    expect(r2.sources.get("github_projects")).toMatchObject({ health: "down", errorCount: 3 });
  });

  it("stays inside its hourly budget: past the REST or GraphQL cap it skips work, the cache stays", async () => {
    BUDGET.restPerHour = 1;
    BUDGET.graphqlPointsPerHour = 0;
    const f = fakeGithub();
    const t = await new ProjectsReader(r, f.gh.run, ME, config).run({ now: T0 });
    expect(t.repos).toMatchObject({ read: 1 });
    expect(t.budget).toEqual(["rest", "graphql", "board"]);
    expect(f.gqlCalls()).toHaveLength(0);
    expect(r.sources.get("github_projects").health).toBe("ok");
  });

  it("does nothing without a project map", async () => {
    const f = fakeGithub();
    const t = await new ProjectsReader(r, f.gh.run, ME, () => ({ projects: [], error: "missing" })).run({ now: T0 });
    expect(t).toMatchObject({ ran: false, skipped: "no_config" });
    expect(f.gh.calls).toHaveLength(0);
  });

  it("drops the cache of a repo that left the config", async () => {
    const f = fakeGithub();
    await new ProjectsReader(r, f.gh.run, ME, config).run({ now: T0 });
    const one = () => {
      const c = config();
      c.projects[0]!.repos = ["7-Arrow/dre-backend"];
      return c;
    };
    await new ProjectsReader(r, f.gh.run, ME, one).run({ now: at(2) });
    expect(projectsCache(r.db).prs().map((p) => p.number)).toEqual([490]);
    expect(projectsCache(r.db).repoReads().map((x) => x.repo)).toEqual(["7-Arrow/dre-backend"]);
  });
});
