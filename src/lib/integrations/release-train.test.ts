import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { isReleaseTrainPr, syncReviewRequests } from "./github-ingest";
import { fakeGh, http, path, type Handler } from "./test/fake-gh";

const LONG = ["develop", "staging", "main", "master", "production", "prod"];
const rel = (title: string, headRef = "develop", baseRef = "staging") => isReleaseTrainPr({ title, headRef, baseRef });

describe("isReleaseTrainPr", () => {
  it("matches the release title in any case and with surrounding spaces", () => {
    for (const t of ["Create staging PR", "create staging pr", "CREATE STAGING PR", "  Create   staging   PR  ", "Create prod PR", "Create production PR", "\tCreate Production Pr\n"]) {
      expect(rel(t), t).toBe(true);
    }
  });

  it("accepts every long-lived branch name on both sides", () => {
    for (const head of LONG) for (const base of LONG) expect(rel("Create staging PR", head, base), `${head} -> ${base}`).toBe(true);
  });

  it("rejects a feature head branch or a feature base branch with a matching title", () => {
    expect(rel("Create staging PR", "feat/login", "staging")).toBe(false);
    expect(rel("Create staging PR", "develop", "release/1.2")).toBe(false);
    expect(rel("Create staging PR", "developer", "staging")).toBe(false);
    expect(rel("Create staging PR", "Develop", "staging")).toBe(false);
  });

  it("rejects unknown branches (not proven)", () => {
    expect(isReleaseTrainPr({ title: "Create staging PR", headRef: null, baseRef: "staging" })).toBe(false);
    expect(isReleaseTrainPr({ title: "Create staging PR", headRef: "develop", baseRef: undefined })).toBe(false);
    expect(isReleaseTrainPr({ title: "Create staging PR", headRef: "", baseRef: "" })).toBe(false);
  });

  it("rejects long-lived branches with an ordinary or near-miss title", () => {
    for (const t of ["Fix login", "Create staging PR for X", "Create staging", "Create dev PR", "Create stagingPR", "Create staging PR!", "Re: Create staging PR", ""]) {
      expect(rel(t), t).toBe(false);
    }
  });
});

describe("syncReviewRequests skips release-train PRs", () => {
  const T0 = new Date("2026-11-09T15:00:00Z");
  const at = (ms: number) => new Date(T0.getTime() + ms);
  const issue = (repo: string, n: number, title: string) => ({
    number: n,
    title,
    html_url: `https://github.com/${repo}/pull/${n}`,
    repository_url: `https://api.github.com/repos/${repo}`,
    draft: false,
    updated_at: "2026-11-09T14:00:00Z",
    user: { login: "github-actions[bot]" },
  });

  let r: Repos;
  let search: unknown[];
  let branches: Record<number, { head: string; base: string }>;
  let pullStatus: Record<number, number>;
  const searchHandler: Handler = (a) => (path(a)?.startsWith("search/issues") ? http(200, {}, { total_count: search.length, incomplete_results: false, items: search }) : undefined);
  const detailHandler: Handler = (a) => {
    const p = path(a) ?? "";
    const m = /^repos\/.+\/pulls\/(\d+)$/.exec(p);
    if (m) {
      const n = Number(m[1]);
      const status = pullStatus[n] ?? 200;
      if (status === 403) return http(403, { "X-RateLimit-Remaining": "0" }, { message: "API rate limit exceeded" });
      if (status >= 400) return http(status, {}, { message: "boom" });
      const b = branches[n] ?? { head: "feat/x", base: "develop" };
      return http(200, {}, { additions: 1, deletions: 2, head: { sha: "abc", ref: b.head }, base: { ref: b.base } });
    }
    if (/^repos\/.+\/pulls\/\d+\/reviews/.test(p)) return http(200, {}, []);
    return undefined;
  };
  const pullReads = (gh: ReturnType<typeof fakeGh>, n: number) => gh.calls.filter((c) => new RegExp(`pulls/${n}$`).test(path(c.args) ?? "")).length;

  beforeEach(() => {
    r = createRepos(openDb(":memory:"));
    search = [];
    branches = {};
    pullStatus = {};
  });

  it("never upserts a release PR, counts it, and reads branches only for matching titles", async () => {
    search = [issue("acme/api", 2, "Create staging PR"), issue("acme/api", 3, "Fix login"), issue("acme/api", 4, "Create staging PR for X")];
    branches = { 2: { head: "develop", base: "staging" } };
    const gh = fakeGh(searchHandler, detailHandler);
    const res = await syncReviewRequests(r, gh.run, "me", T0);
    expect(res).toMatchObject({ requests: 3, created: 2, skippedRelease: 1 });
    expect(r.items.list({ source: "github" }).map((i) => i.externalId).sort()).toEqual(["pr:acme/api#3", "pr:acme/api#4"]);
    // PR 2 is read once (title match), ordinary PRs once for their detail: never an extra call.
    expect(pullReads(gh, 2)).toBe(1);
    expect(pullReads(gh, 3)).toBe(1);
    expect(pullReads(gh, 4)).toBe(1);
  });

  it("keeps a release-titled PR from a feature branch (not a release PR)", async () => {
    search = [issue("acme/api", 5, "Create staging PR")];
    branches = { 5: { head: "feat/x", base: "staging" } };
    const res = await syncReviewRequests(r, fakeGh(searchHandler, detailHandler).run, "me", T0);
    expect(res).toMatchObject({ created: 1, skippedRelease: 0 });
    expect(r.items.list({ source: "github" })).toHaveLength(1);
  });

  it("does not skip a title match whose pulls read fails; a rate limit still throws", async () => {
    search = [issue("acme/api", 2, "Create staging PR")];
    branches = { 2: { head: "develop", base: "staging" } };
    pullStatus = { 2: 500 };
    const res = await syncReviewRequests(r, fakeGh(searchHandler, detailHandler).run, "me", T0);
    expect(res).toMatchObject({ created: 1, skippedRelease: 0 });

    pullStatus = { 2: 403 };
    await expect(syncReviewRequests(r, fakeGh(searchHandler, detailHandler).run, "me", at(1000))).rejects.toThrow(/rate limit/i);
  });

  it("moves an item created before the filter to Hecho, and never refreshes it, on a complete search", async () => {
    // First sync with the PR looking ordinary (branches unreadable), so the item exists.
    search = [issue("acme/api", 2, "Create staging PR")];
    pullStatus = { 2: 500 };
    await syncReviewRequests(r, fakeGh(searchHandler, detailHandler).run, "me", T0);
    const before = r.items.list({ source: "github" });
    expect(before).toHaveLength(1);
    expect(before[0]!.station).not.toBe("done");

    // Branches readable now, same updated_at (the fresh shortcut would have kept it): the release check wins.
    pullStatus = {};
    branches = { 2: { head: "develop", base: "staging" } };
    const res = await syncReviewRequests(r, fakeGh(searchHandler, detailHandler).run, "me", at(1000));
    expect(res).toMatchObject({ created: 0, updated: 0, skippedRelease: 1, done: 1 });
    expect(r.items.list({ source: "github" })[0]).toMatchObject({ station: "done", waitOn: "none" });

    // Later syncs neither refresh nor recreate it.
    const again = await syncReviewRequests(r, fakeGh(searchHandler, detailHandler).run, "me", at(2000));
    expect(again).toMatchObject({ created: 0, updated: 0, skippedRelease: 1, done: 0 });
    expect(r.items.list({ source: "github" })).toHaveLength(1);
  });
});
