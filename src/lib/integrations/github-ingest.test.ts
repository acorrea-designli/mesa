import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { ingestTick, initialIngestState, prExcerpt, syncReviewRequests, type IngestState } from "./github-ingest";
import { fakeGh, header, http, path, type Handler } from "./test/fake-gh";

const T0 = new Date("2026-11-03T15:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const LM1 = "Tue, 03 Nov 2026 14:00:00 GMT";
const LM2 = "Tue, 03 Nov 2026 15:00:30 GMT";

const pr = (repo: string, n: number, extra: Record<string, unknown> = {}) => ({
  number: n,
  title: `PR ${n}`,
  html_url: `https://github.com/${repo}/pull/${n}`,
  repository_url: `https://api.github.com/repos/${repo}`,
  draft: false,
  updated_at: "2026-11-03T14:00:00Z",
  user: { login: "dev1" },
  ...extra,
});

let search: unknown[] = [];
const searchHandler: Handler = (a) =>
  path(a)?.startsWith("search/issues") ? http(200, {}, { total_count: search.length, incomplete_results: false, items: search }) : undefined;
const detailHandler: Handler = (a) => {
  const p = path(a) ?? "";
  if (/^repos\/.+\/pulls\/\d+$/.test(p)) return http(200, {}, { additions: 120, deletions: 34, head: { sha: "abc" } });
  if (/^repos\/.+\/pulls\/\d+\/reviews/.test(p)) return http(200, {}, [{ state: "COMMENTED", commit_id: "old", user: { login: "acorrea-designli" } }]);
  return undefined;
};

describe("GitHub ingest", () => {
  let r: Repos;
  let st: IngestState;
  beforeEach(() => {
    r = createRepos(openDb(":memory:"));
    st = initialIngestState(r.sources.get("github"));
    search = [pr("acme/api", 7), pr("acme/web", 9, { draft: true })];
  });

  it("polls conditionally and never faster than X-Poll-Interval", async () => {
    const notif: Handler = (a) => {
      if (path(a)?.startsWith("/notifications")) {
        return header(a, "If-Modified-Since") === LM2 ? http(304, { "X-Poll-Interval": "90" }) : http(200, { "X-Poll-Interval": "90", "Last-Modified": LM2 }, [{ id: "1" }]);
      }
      return undefined;
    };
    const gh = fakeGh(notif, searchHandler, detailHandler);
    st.lastModified = LM1;

    const first = await ingestTick(r, gh.run, st, { now: T0, login: "acorrea-designli" });
    expect(first.notifications).toMatchObject({ status: 200, changed: true, pollIntervalS: 90, lastModified: LM2 });
    expect(header(gh.calls[0]!.args, "If-Modified-Since")).toBe(LM1);
    expect(first.reviews).toMatchObject({ requests: 2, created: 1, skippedDrafts: 1 });

    // 60 s later: interval is 90 s, nothing is called.
    const n = gh.calls.length;
    expect((await ingestTick(r, gh.run, st, { now: at(60_000), login: "acorrea-designli" })).polled).toBe(false);
    expect(gh.calls.length).toBe(n);

    // 90 s later: conditional request answered 304; no review sync (not due, not changed).
    const third = await ingestTick(r, gh.run, st, { now: at(90_000), login: "acorrea-designli" });
    expect(third.notifications).toMatchObject({ status: 304, changed: false });
    expect(third.reviews).toBeUndefined();
    expect(r.sources.get("github")).toMatchObject({ health: "ok", watermark: LM2, cadenceS: 90 });
  });

  it("enforces a 60 s floor even if GitHub suggests less", async () => {
    const gh = fakeGh((a) => (path(a)?.startsWith("/notifications") ? http(304, { "X-Poll-Interval": "10" }) : undefined), searchHandler, detailHandler);
    await ingestTick(r, gh.run, st, { now: T0, login: "x" });
    expect(st.nextPollAt - T0.getTime()).toBe(60_000);
  });

  it("upserts review requests without duplicates and moves removed ones to Hecho", async () => {
    const gh = fakeGh(searchHandler, detailHandler);
    await syncReviewRequests(r, gh.run, "acorrea-designli", T0);
    await syncReviewRequests(r, gh.run, "acorrea-designli", at(1000));
    const items = r.items.list({ source: "github" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      externalId: "pr:acme/api#7",
      kind: "pr_review",
      need: "approve_pr",
      project: "api",
      title: "#7 · PR 7",
      meta: expect.objectContaining({ repo: "acme/api", pr: 7 }),
      station: "inbox",
      excerpt: "+120 −34 · comentaste · commits nuevos",
      url: "https://github.com/acme/api/pull/7",
    });
    // Unchanged PR (same updated_at): the second sync fetched no details.
    expect(gh.calls.filter((c) => /pulls\/7$/.test(path(c.args) ?? "")).length).toBe(1);

    search = [];
    const res = await syncReviewRequests(r, gh.run, "acorrea-designli", at(2000));
    expect(res.done).toBe(1);
    expect(r.items.list({ source: "github" })[0]).toMatchObject({ station: "done", waitOn: "none" });

    // Re-requested later: back to the inbox.
    search = [pr("acme/api", 7, { updated_at: "2026-11-03T16:00:00Z" })];
    await syncReviewRequests(r, gh.run, "acorrea-designli", at(3000));
    expect(r.items.list({ source: "github" })[0]!.station).toBe("inbox");
  });

  it("a skipped PR stays done with no detail fetch; a non-skipped done PR still comes back", async () => {
    search = [pr("acme/api", 7), pr("acme/api", 8)];
    const gh = fakeGh(searchHandler, detailHandler);
    await syncReviewRequests(r, gh.run, "acorrea-designli", T0);
    const seven = r.items.list({ source: "github" }).find((i) => i.externalId === "pr:acme/api#7")!;
    const eight = r.items.list({ source: "github" }).find((i) => i.externalId === "pr:acme/api#8")!;
    r.items.skip(seven.id, at(500));
    r.items.update(eight.id, { station: "done", waitOn: "none" }, at(500));

    // Both PRs changed and are still requested.
    search = [pr("acme/api", 7, { updated_at: "2026-11-03T16:00:00Z" }), pr("acme/api", 8, { updated_at: "2026-11-03T16:00:00Z" })];
    const before = gh.calls.length;
    const res = await syncReviewRequests(r, gh.run, "acorrea-designli", at(1000));
    expect(r.items.get(seven.id)).toMatchObject({ station: "done", waitOn: "none", skippedAt: at(500).toISOString() });
    expect(r.items.get(eight.id)).toMatchObject({ station: "inbox", waitOn: "you" });
    expect(res).toMatchObject({ created: 0, updated: 1, done: 0 });
    const fetched = gh.calls.slice(before).filter((c) => /pulls\/\d+/.test(path(c.args) ?? ""));
    expect(fetched.every((c) => /pulls\/8/.test(path(c.args) ?? ""))).toBe(true);
    expect(fetched.length).toBeGreaterThan(0);

    // A complete search without it does not touch a skipped item either.
    search = [];
    await syncReviewRequests(r, gh.run, "acorrea-designli", at(2000));
    expect(r.items.get(seven.id)).toMatchObject({ station: "done", skippedAt: at(500).toISOString() });
  });

  it("does not trust absences from an incomplete search", async () => {
    const gh = fakeGh(searchHandler, detailHandler);
    await syncReviewRequests(r, gh.run, "x", T0);
    const partial = fakeGh((a) => (path(a)?.startsWith("search/issues") ? http(200, {}, { total_count: 5, incomplete_results: true, items: [] }) : undefined));
    expect((await syncReviewRequests(r, partial.run, "x", at(1000))).done).toBe(0);
  });

  it("reports a rate limit as degraded 'límite de API' and backs off until the reset", async () => {
    const reset = Math.floor(at(10 * 60_000).getTime() / 1000);
    const gh = fakeGh((a) =>
      path(a)?.startsWith("/notifications") ? http(403, { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(reset) }, { message: "API rate limit exceeded" }) : undefined,
    );
    const res = await ingestTick(r, gh.run, st, { now: T0, login: "x" });
    expect(res.error).toMatch(/rate limit/);
    const s = r.sources.get("github");
    expect(s.health).toBe("degraded");
    expect(s.note).toMatch(/^límite de API · /);
    expect(s.errorCount).toBe(1);
    expect(st.nextPollAt).toBe(reset * 1000);
  });

  it("formats excerpts", () => {
    expect(prExcerpt({ additions: 3, deletions: 0, myReview: null, myReviewHead: null, head: "a" })).toBe("+3 −0 · sin revisar");
    expect(prExcerpt({ additions: 1, deletions: 2, myReview: "APPROVED", myReviewHead: "a", head: "a" })).toBe("+1 −2 · aprobado antes");
  });
});

describe("a new push reopens a closed review ticket (the poll path)", () => {
  let r: Repos;
  let st: IngestState;
  let ref: string;
  let head: string;
  let pusher: { login?: string; type?: string } | null;
  let prState: string;
  const pullsHandler: Handler = (a) => {
    const p = path(a) ?? "";
    if (p === "repos/acme/api/pulls/7") return http(200, {}, { state: prState, head: { sha: head }, user: { login: "dev1" } });
    if (p.startsWith("repos/acme/api/commits/")) return http(200, {}, { author: pusher, committer: { login: "web-flow" } });
    return undefined;
  };
  const notif: Handler = (a) => (path(a)?.startsWith("/notifications") ? http(200, { "Last-Modified": LM2 }, []) : undefined);
  const noSearch: Handler = (a) => (path(a)?.startsWith("search/issues") ? http(200, {}, { total_count: 0, incomplete_results: false, items: [] }) : undefined);
  const tick = (gh: ReturnType<typeof fakeGh>, ms: number) => ingestTick(r, gh.run, st, { now: at(ms), force: true, login: "acorrea-designli" });
  const wakes = () => r.db.prepare("SELECT payload FROM wake_events WHERE kind = 'ticket.reopened'").all() as { payload: string }[];

  beforeEach(() => {
    r = createRepos(openDb(":memory:"));
    st = initialIngestState(r.sources.get("github"));
    ref = r.tickets.create({ direction: "andres_asks", title: "Revisa PR 7", ownerSession: "lead" }, T0).ref;
    r.reviews.open(ref, { repo: "acme/api", pr: 7, sha: "old1" }, T0);
    r.tickets.transition(ref, { type: "close", by: "claude" }, undefined, at(1000));
    head = "new2";
    pusher = { login: "dev1", type: "User" };
    prState = "open";
  });

  it("reopens the closed ticket when the author pushes, once per head across polls", async () => {
    const gh = fakeGh(notif, noSearch, pullsHandler);
    const first = await tick(gh, 60_000);
    expect(first.heads).toEqual({ checked: 1, reopened: 1, ignored: 0 });
    expect(r.tickets.get(ref).status).toBe("waiting_claude");
    expect(JSON.parse(wakes()[0]!.payload)).toMatchObject({ ref, repo: "acme/api", pr: 7, oldHead: "old1", newHead: "new2" });
    // reopened ticket: not watched any more, nothing is fetched or reopened again
    const calls = gh.calls.length;
    expect((await tick(gh, 120_000)).heads).toEqual({ checked: 0, reopened: 0, ignored: 0 });
    expect(gh.calls.length - calls).toBe(2);
    // closed again at the same head: no second reopen, and the commit is not fetched again
    r.tickets.transition(ref, { type: "close", by: "claude" }, undefined, at(130_000));
    expect((await tick(gh, 180_000)).heads).toEqual({ checked: 1, reopened: 0, ignored: 0 });
    expect(wakes()).toHaveLength(1);
    expect(gh.calls.filter((c) => path(c.args)?.includes("/commits/"))).toHaveLength(1);
  });

  it("does not reopen for a push by Andrés himself or by a bot, nor for the reviewed head or a closed PR", async () => {
    const gh = fakeGh(notif, noSearch, pullsHandler);
    pusher = { login: "acorrea-designli", type: "User" };
    expect((await tick(gh, 60_000)).heads).toEqual({ checked: 1, reopened: 0, ignored: 1 });
    head = "new3";
    pusher = { login: "dependabot[bot]", type: "Bot" };
    expect((await tick(gh, 120_000)).heads).toEqual({ checked: 1, reopened: 0, ignored: 1 });
    head = "old1";
    expect((await tick(gh, 180_000)).heads?.reopened).toBe(0);
    head = "new4";
    prState = "closed";
    expect((await tick(gh, 240_000)).heads?.reopened).toBe(0);
    expect(r.tickets.get(ref).status).toBe("closed");
    expect(wakes()).toHaveLength(0);
  });

  it("a PR that cannot be read is skipped; a rate limit stops the pass and backs off", async () => {
    const gh = fakeGh(notif, noSearch, (a) => (path(a) === "repos/acme/api/pulls/7" ? http(404, {}, { message: "Not Found" }) : undefined));
    expect((await tick(gh, 60_000)).heads).toEqual({ checked: 0, reopened: 0, ignored: 0 });
    const limited = fakeGh(notif, noSearch, (a) => (path(a) === "repos/acme/api/pulls/7" ? http(403, { "X-RateLimit-Remaining": "0" }, { message: "API rate limit exceeded" }) : undefined));
    const res = await tick(limited, 120_000);
    expect(res.error).toMatch(/rate limit/);
    expect(r.tickets.get(ref).status).toBe("closed");
  });
});
