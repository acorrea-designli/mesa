import { describe, expect, it } from "vitest";
import { fakeGh, http, ok } from "./test/fake-gh";
import { checksSummary, detailQuery, fetchBoard, fetchPrDetails, guardReadOnlyGh, isReadDocument, listOpenPrs, toBoardItem } from "./projects-gh";

const gql = (query: string, variables: Record<string, unknown> = {}) => ({ input: JSON.stringify({ query, variables }) });

describe("guardReadOnlyGh: client repos and Projects are read, never written (t10 rule)", () => {
  it("refuses every write before gh runs", async () => {
    const gh = fakeGh(() => ok({}));
    const guarded = guardReadOnlyGh(gh.run);
    const writes: [string[], { input?: string }?][] = [
      [["project", "item-add", "2", "--owner", "7-Arrow", "--url", "https://github.com/7-Arrow/dre-backend/pull/490"]],
      [["project", "item-edit", "--id", "PVTI_1", "--field-id", "F", "--single-select-option-id", "O"]],
      [["project", "item-create", "2", "--owner", "7-Arrow", "--title", "x"]],
      [["project", "item-delete", "2", "--owner", "7-Arrow", "--id", "PVTI_1"]],
      [["project", "item-archive", "2", "--owner", "7-Arrow", "--id", "PVTI_1"]],
      [["project", "field-create", "2", "--owner", "7-Arrow", "--name", "x"]],
      [["pr", "review", "490", "-R", "7-Arrow/dre-backend", "--approve"]],
      [["pr", "comment", "490", "-R", "7-Arrow/dre-backend", "--body", "x"]],
      [["pr", "edit", "490", "-R", "7-Arrow/dre-backend", "--add-label", "x"]],
      [["pr", "merge", "490", "-R", "7-Arrow/dre-backend"]],
      [["issue", "comment", "484", "-R", "7-Arrow/dre-backlog", "--body", "x"]],
      [["label", "create", "x", "-R", "7-Arrow/dre-backend"]],
      [["api", "-X", "POST", "repos/7-Arrow/dre-backend/issues/490/comments"]],
      [["api", "--method", "PATCH", "repos/7-Arrow/dre-backend/pulls/490"]],
      [["api", "--method=DELETE", "repos/7-Arrow/dre-backend/issues/490/labels/x"]],
      [["api", "-XPUT", "repos/7-Arrow/dre-backend/pulls/490/merge"]],
      [["api", "repos/7-Arrow/dre-backend/issues/490/comments", "-f", "body=x"]],
      [["api", "repos/7-Arrow/dre-backend/pulls/490/reviews", "-F", "event=APPROVE"]],
      [["api", "repos/7-Arrow/dre-backend/issues/490/labels", "--raw-field=labels[]=x"]],
      [["api", "repos/7-Arrow/dre-backend/issues/490/comments", "--input", "-"], { input: '{"body":"x"}' }],
      [["api", "graphql", "--input", "-"], gql("mutation { addProjectV2ItemById(input: {}) { item { id } } }")],
      [["api", "graphql", "--input", "-"], gql("mutation($id: ID!) { updateProjectV2ItemFieldValue(input: { itemId: $id }) { clientMutationId } }")],
      [["api", "graphql", "--input", "-"], gql("mutation { addComment(input: {}) { clientMutationId } }")],
      [["api", "graphql", "--input", "-"], gql("subscription { x }")],
      [["api", "graphql", "--input", "-"], { input: JSON.stringify([{ query: "{ viewer { login } }" }, { query: "mutation { addPullRequestReview(input: {}) { clientMutationId } }" }]) }],
      [["api", "graphql", "--input", "-"], { input: "mutation { addComment(input: {}) { clientMutationId } }" }],
      [["api", "graphql", "-f", "query=mutation { addComment(input: {}) { clientMutationId } }"]],
      [["api", "graphql", "-f", "query={ viewer { login } }"]],
      [["api", "graphql"]],
      [[]],
    ];
    for (const [args, opts] of writes) await expect(guarded(args, opts), args.join(" ")).rejects.toThrow(/Mesa only reads/);
    expect(gh.calls).toHaveLength(0);
  });

  it("lets the reads through: REST GETs, GraphQL queries and project item-list", async () => {
    const gh = fakeGh(() => ok({}));
    const guarded = guardReadOnlyGh(gh.run);
    await guarded(["api", "-i", "repos/7-Arrow/dre-backend/pulls?state=open&per_page=100", "-H", "If-None-Match: W/\"x\""]);
    await guarded(["api", "-X", "GET", "rate_limit"]);
    await guarded(["api", "graphql", "--input", "-"], gql('query($o: String!) { organization(login: $o) { login } }', { o: "mutation" }));
    // "mutation" inside a string or a comment is not an operation.
    await guarded(["api", "graphql", "--input", "-"], gql('{ search(query: "mutation subscription", type: ISSUE, first: 1) { issueCount } } # no mutation here'));
    await guarded(["project", "item-list", "2", "--owner", "7-Arrow", "--format", "json"]);
    expect(gh.calls).toHaveLength(5);
  });

  it("isReadDocument looks at operations only", () => {
    expect(isReadDocument("query { viewer { login } }")).toBe(true);
    expect(isReadDocument("{ a: repository(owner: \"mutation\", name: \"x\") { id } }")).toBe(true);
    expect(isReadDocument('"""mutation""" query { x }')).toBe(true);
    expect(isReadDocument("mutation{x}")).toBe(false);
    expect(isReadDocument("query { x } mutation M { y }")).toBe(false);
  });
});

describe("open PRs, conditional", () => {
  const pull = (n: number, over: Record<string, unknown> = {}) => ({
    number: n,
    title: `PR ${n}`,
    html_url: `https://github.com/7-Arrow/dre-backend/pull/${n}`,
    draft: false,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-12T10:00:00Z",
    body: "x".repeat(9000),
    user: { login: "dev1" },
    head: { sha: `sha${n}`, ref: `feat/GHI-${n}` },
    base: { ref: "develop" },
    requested_reviewers: [{ login: "acorrea-designli" }, null],
    ...over,
  });

  it("maps the list and keeps the ETag; an If-None-Match 304 returns nothing and costs nothing", async () => {
    const gh = fakeGh((a) => (a.some((x) => x.startsWith("If-None-Match")) ? http(304, { etag: 'W/"e1"' }) : http(200, { etag: 'W/"e1"' }, [pull(490), pull(491, { draft: true, body: null })])));
    const first = await listOpenPrs(gh.run, "7-Arrow/dre-backend", null);
    expect(first).toMatchObject({ notModified: false, etag: 'W/"e1"', truncated: false });
    expect(first.prs[0]).toMatchObject({ repo: "7-Arrow/dre-backend", number: 490, author: "dev1", headSha: "sha490", headRef: "feat/GHI-490", baseRef: "develop", requested: ["acorrea-designli"], draft: false });
    expect(first.prs[0]!.body).toHaveLength(8000);
    expect(first.prs[1]).toMatchObject({ draft: true, body: "" });
    const again = await listOpenPrs(gh.run, "7-Arrow/dre-backend", 'W/"e1"');
    expect(again).toEqual({ notModified: true, etag: 'W/"e1"', prs: [], truncated: false });
    expect(gh.calls[0]!.args.slice(0, 3)).toEqual(["api", "-i", "repos/7-Arrow/dre-backend/pulls?state=open&per_page=100"]);
  });

  it("a full page is marked truncated", async () => {
    const gh = fakeGh(() => http(200, {}, Array.from({ length: 100 }, (_, i) => pull(i + 1))));
    expect((await listOpenPrs(gh.run, "o/r", null)).truncated).toBe(true);
  });
});

describe("PR details, one GraphQL query", () => {
  it("checks read as pass / fail N of M / pending / none", () => {
    expect(checksSummary(null)).toEqual({ state: "none", total: 0, failed: 0, pending: 0 });
    expect(checksSummary({ state: "SUCCESS", contexts: { totalCount: 4, checkRunCountsByState: [{ state: "SUCCESS", count: 3 }, { state: "SKIPPED", count: 1 }] } })).toEqual({ state: "pass", total: 4, failed: 0, pending: 0 });
    expect(checksSummary({ state: "FAILURE", contexts: { totalCount: 4, checkRunCountsByState: [{ state: "SUCCESS", count: 3 }, { state: "FAILURE", count: 1 }] } })).toEqual({ state: "fail", total: 4, failed: 1, pending: 0 });
    expect(checksSummary({ state: "PENDING", contexts: { totalCount: 3, checkRunCountsByState: [{ state: "IN_PROGRESS", count: 2 }], statusContextCountsByState: [{ state: "SUCCESS", count: 1 }] } })).toEqual({ state: "pending", total: 3, failed: 0, pending: 2 });
  });

  it("batches every PR across repos into one query of aliases, and maps the answer", async () => {
    const pr = (n: number, extra: Record<string, unknown> = {}) => ({
      number: n,
      headRefOid: `sha${n}`,
      mergeable: "CONFLICTING",
      reviewDecision: "CHANGES_REQUESTED",
      latestReviews: { nodes: [{ state: "COMMENTED", author: { login: "dev2" } }, { state: "APPROVED", author: { login: "Acorrea-Designli" } }] },
      closingIssuesReferences: { nodes: [{ number: 484, repository: { nameWithOwner: "7-Arrow/dre-backlog" } }] },
      commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE", contexts: { totalCount: 4, checkRunCountsByState: [{ state: "FAILURE", count: 1 }, { state: "SUCCESS", count: 3 }] } } } }] },
      ...extra,
    });
    const gh = fakeGh(() => ok({ data: { rateLimit: { cost: 1, remaining: 4900, resetAt: "2026-11-13T20:00:00Z" }, r0: { p490: pr(490) }, r1: { p610: pr(610, { mergeable: "MERGEABLE", reviewDecision: null, latestReviews: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }) } } }));
    const out = await fetchPrDetails(gh.run, [{ repo: "7-Arrow/dre-backend", number: 490 }, { repo: "7-Arrow/dre-frontend", number: 610 }], "acorrea-designli");
    expect(gh.calls).toHaveLength(1);
    const q = JSON.parse(gh.calls[0]!.input!).query as string;
    expect(q).toContain('r0: repository(owner: "7-Arrow", name: "dre-backend")');
    expect(q).toContain("p610: pullRequest(number: 610)");
    expect(q).toContain("rateLimit { cost remaining resetAt }");
    expect(isReadDocument(q)).toBe(true);
    expect(out.points).toBe(1);
    expect(out.details).toEqual([
      { repo: "7-Arrow/dre-backend", number: 490, headSha: "sha490", mergeable: "CONFLICTING", checks: { state: "fail", total: 4, failed: 1, pending: 0 }, reviewDecision: "CHANGES_REQUESTED", myReview: "APPROVED", closingIssues: ["7-Arrow/dre-backlog#484"] },
      { repo: "7-Arrow/dre-frontend", number: 610, headSha: "sha610", mergeable: "MERGEABLE", checks: { state: "none", total: 0, failed: 0, pending: 0 }, reviewDecision: null, myReview: null, closingIssues: ["7-Arrow/dre-backlog#484"] },
    ]);
  });

  it("refuses a repo name that is not owner/name before it reaches the document", () => {
    expect(() => detailQuery([{ repo: 'o/r") { x } } mutation { y(', number: 1 }])).toThrow(/invalid repo/);
  });
});

describe("board items, paginated GraphQL", () => {
  const node = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    isArchived: false,
    status: { name: "In QA" },
    linked: { pullRequests: { nodes: [{ url: "https://github.com/7-Arrow/dre-frontend/pull/610" }] } },
    content: { __typename: "Issue", number: 484, title: "Disposition screen", url: "https://github.com/7-Arrow/dre-backlog/issues/484", issueState: "OPEN", repository: { nameWithOwner: "7-Arrow/dre-backlog" } },
    ...over,
  });

  it("follows the cursor, keeps the Status options in board order and drops archived and empty items", async () => {
    const page = (nodes: unknown[], next: string | null) =>
      ok({
        data: {
          rateLimit: { cost: 1, remaining: 4800, resetAt: "2026-11-13T20:00:00Z" },
          owner: { projectV2: { title: "DRE-RMS-backlog", url: "https://github.com/orgs/7-Arrow/projects/2", field: { options: [{ name: "Blocked" }, { name: "In QA" }] }, items: { pageInfo: { hasNextPage: !!next, endCursor: next }, nodes } } },
        },
      });
    const gh = fakeGh((_a, input) => (JSON.parse(input!).variables.after ? page([node("I3", { isArchived: true }), node("I4", { content: null })], null) : page([node("I1"), node("I2", { status: null, linked: null, content: { __typename: "DraftIssue", title: "d" } })], "c1")));
    const b = await fetchBoard(gh.run, { board: { owner: "7-Arrow", number: 2, ownerType: "organization" } });
    expect(b).toMatchObject({ title: "DRE-RMS-backlog", statusOptions: ["Blocked", "In QA"], pages: 2, points: 2, complete: true });
    expect(b.items).toEqual([
      { itemId: "I1", contentType: "Issue", repo: "7-Arrow/dre-backlog", number: 484, title: "Disposition screen", url: "https://github.com/7-Arrow/dre-backlog/issues/484", state: "OPEN", status: "In QA", linkedPrs: ["https://github.com/7-Arrow/dre-frontend/pull/610"] },
      { itemId: "I2", contentType: "DraftIssue", repo: null, number: null, title: "d", url: null, state: null, status: null, linkedPrs: [] },
    ]);
    const first = JSON.parse(gh.calls[0]!.input!);
    expect(first.variables).toEqual({ owner: "7-Arrow", number: 2, after: null });
    expect(first.query).toContain("organization(login: $owner)");
    expect(isReadDocument(first.query)).toBe(true);
  });

  it("a board that is not there is an error, not an empty board", async () => {
    const gh = fakeGh(() => ok({ data: { rateLimit: { cost: 1, remaining: 1, resetAt: "x" }, owner: { projectV2: null } } }));
    await expect(fetchBoard(gh.run, { board: { owner: "o", number: 9, ownerType: "user" } })).rejects.toThrow(/not found/);
    expect(JSON.parse(gh.calls[0]!.input!).query).toContain("user(login: $owner)");
  });

  it("toBoardItem ignores unknown content types", () => {
    expect(toBoardItem({ id: "x", content: { __typename: "Redacted" } })).toBeNull();
  });
});
