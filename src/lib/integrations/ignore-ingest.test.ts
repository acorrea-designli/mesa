// Ingest and Project sync skip ignored projects (gh mocked like github-ingest.test.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { syncReviewRequests } from "./github-ingest";
import { pushPending, type ProjectSettings } from "./github-project";
import { fakeGh, http, ok, path, type Handler } from "./test/fake-gh";

const T0 = new Date("2026-11-03T15:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

const pr = (repo: string, n: number) => ({
  number: n,
  title: `PR ${n}`,
  html_url: `https://github.com/${repo}/pull/${n}`,
  repository_url: `https://api.github.com/repos/${repo}`,
  draft: false,
  updated_at: "2026-11-03T14:00:00Z",
  user: { login: "dev1" },
});

let search: unknown[] = [];
const searchHandler: Handler = (a) =>
  path(a)?.startsWith("search/issues") ? http(200, {}, { total_count: search.length, incomplete_results: false, items: search }) : undefined;
const detailHandler: Handler = (a) => {
  const p = path(a) ?? "";
  if (/^repos\/.+\/pulls\/\d+$/.test(p)) return http(200, {}, { additions: 1, deletions: 1, head: { sha: "abc" } });
  if (/^repos\/.+\/pulls\/\d+\/reviews/.test(p)) return http(200, {}, []);
  return undefined;
};

let r: Repos;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  search = [pr("designli/prospec-admin", 212), pr("designli/scout", 3)];
});

describe("review-request ingest skips ignored projects", () => {
  it("never upserts a request of an ignored repo and fetches no details for it", async () => {
    r.ignored.add({ source: "github", project: "designli/prospec-admin" });
    const gh = fakeGh(searchHandler, detailHandler);
    const res = await syncReviewRequests(r, gh.run, "acorrea-designli", T0);
    expect(res).toMatchObject({ requests: 2, created: 1, skippedIgnored: 1 });
    expect(r.items.list().map((i) => i.externalId)).toEqual(["pr:designli/scout#3"]);
    expect(gh.calls.some((c) => (path(c.args) ?? "").includes("prospec-admin"))).toBe(false);
  });

  it("a '*' row on the bare repo name also skips it", async () => {
    r.ignored.add({ source: "*", project: "prospec-admin" });
    const res = await syncReviewRequests(r, fakeGh(searchHandler, detailHandler).run, "x", T0);
    expect(res.skippedIgnored).toBe(1);
  });

  it("leaves existing items of an ignored repo alone (not moved to Hecho), so un-ignoring brings them back", async () => {
    const gh = fakeGh(searchHandler, detailHandler);
    await syncReviewRequests(r, gh.run, "x", T0);
    const ig = r.ignored.add({ source: "github", project: "designli/prospec-admin" });
    expect(r.items.list({ ignored: "exclude" }).map((i) => i.externalId)).toEqual(["pr:designli/scout#3"]);

    // Still requested, and even if it were not: the ignored item keeps its station.
    search = [pr("designli/scout", 3)];
    const res = await syncReviewRequests(r, gh.run, "x", at(1000));
    expect(res.done).toBe(0);
    const kept = r.items.list({ ignored: "only" })[0]!;
    expect(kept).toMatchObject({ externalId: "pr:designli/prospec-admin#212", station: "inbox" });

    r.ignored.remove(ig.ignored.id);
    expect(r.items.list({ ignored: "exclude" })).toHaveLength(2);
    // The next sync treats it normally again: gone from the search, so it moves to Hecho.
    expect((await syncReviewRequests(r, gh.run, "x", at(2000))).done).toBe(1);
  });
});

describe("GitHub Project push skips ignored projects", () => {
  const P: ProjectSettings = { id: "PVT_1", number: 3, url: "u", owner: "acorrea-designli", statusFieldId: "F1", statusOptions: { Inbox: "o1", Todo: "o2", "In Progress": "o3", Waiting: "o4", Done: "o5" } };
  const is = (...head: string[]) => (a: string[]) => head.every((h, i) => a[i] === h);

  it("does not push a pending task of an ignored project, and pushes it once un-ignored", async () => {
    const { item } = r.items.upsert({ source: "github", externalId: "pr:designli/prospec-admin#212", kind: "pr_review", title: "#212", project: "prospec-admin" });
    const t = r.tasks.create({ title: "Review 212", source: "github", project: "prospec-admin", itemIds: [item.id] });
    const other = r.tasks.create({ title: "Deploy", source: "slack", project: "C1" });
    const ig = r.ignored.add({ source: "github", project: "designli/prospec-admin" });
    const gh = fakeGh(
      (a) => (is("project", "item-create")(a) ? ok({ id: "PVTI_x" }) : undefined),
      (a) => (is("project", "item-add")(a) ? ok({ id: "PVTI_pr" }) : undefined),
      (a) => (is("project", "item-edit")(a) ? ok({}) : undefined),
    );
    expect(await pushPending(r, gh.run, P)).toMatchObject({ pushed: 1 });
    expect(r.tasks.get(other.id).syncState).toBe("synced");
    expect(r.tasks.get(t.id).syncState).toBe("pending");

    r.ignored.remove(ig.ignored.id);
    expect(await pushPending(r, gh.run, P)).toMatchObject({ pushed: 1 });
    expect(r.tasks.get(t.id).syncState).toBe("synced");
  });
});
