// API tests for /api/ignored-projects and the soft reject in /api/items/upsert, with the
// route handlers running over an in-memory database.
import { beforeEach, describe, expect, it } from "vitest";
import { DELETE } from "@/app/api/ignored-projects/[id]/route";
import { GET, POST } from "@/app/api/ignored-projects/route";
import { POST as UPSERT } from "@/app/api/items/upsert/route";
import { openDb } from "../db/sqlite";
import { subscribeChanges, type LiveChange } from "../live/bus";
import { createRepos, type Repos } from "../repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
});

const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://local${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("/api/ignored-projects", () => {
  it("adds, lists with hidden counts, and removes; every write is published live", async () => {
    const seen: LiveChange[] = [];
    const off = subscribeChanges((c) => seen.push(c));
    r.items.create({ source: "github", externalId: "pr:designli/prospec-admin#1", kind: "pr_review", title: "#1", project: "prospec-admin" });

    const add = await POST(req("POST", "/api/ignored-projects", { source: "github", project: "designli/prospec-admin", label: "prospec-admin" }), ctx());
    expect(add.status).toBe(201);
    const { ignored } = (await add.json()) as { ignored: { id: string } };
    expect((await POST(req("POST", "/api/ignored-projects", { source: "github", project: "designli/prospec-admin" }), ctx())).status).toBe(200);

    const list = (await (await GET(req("GET", "/api/ignored-projects"), ctx())).json()) as unknown[];
    expect(list).toEqual([expect.objectContaining({ id: ignored.id, source: "github", project: "designli/prospec-admin", label: "prospec-admin", hidden: { items: 1, tasks: 0 } })]);

    const del = await DELETE(req("DELETE", `/api/ignored-projects/${ignored.id}`), ctx({ id: ignored.id }));
    expect(del.status).toBe(200);
    expect(r.ignored.list()).toEqual([]);
    expect((await DELETE(req("DELETE", `/api/ignored-projects/${ignored.id}`), ctx({ id: ignored.id }))).status).toBe(404);

    off();
    expect(seen.filter((c) => c.entityType === "ignored_project").map((c) => c.kind)).toEqual(["created", "created", "deleted"]);
  });

  it("validates the body", async () => {
    expect((await POST(req("POST", "/api/ignored-projects", { source: "jira", project: "x" }), ctx())).status).toBe(400);
    expect((await POST(req("POST", "/api/ignored-projects", { source: "github", project: "  " }), ctx())).status).toBe(400);
    expect((await POST(req("POST", "/api/ignored-projects", { source: "*", project: "freightmate" }), ctx())).status).toBe(201);
  });
});

describe("POST /api/items/upsert", () => {
  const input = { source: "slack", externalId: "C0DEPLOY:1730640000.0001", kind: "message", title: "Matt · confirm env var", project: "#deploys" };

  it("rejects an ignored project's item softly and stores nothing", async () => {
    r.ignored.add({ source: "slack", project: "C0DEPLOY", label: "#deploys" });
    const res = await UPSERT(req("POST", "/api/items/upsert", input), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true, created: false });
    expect(r.items.list()).toEqual([]);
  });

  it("stores it as usual when the project is not ignored", async () => {
    const res = await UPSERT(req("POST", "/api/items/upsert", input), ctx());
    expect(res.status).toBe(201);
    expect(r.items.list()).toHaveLength(1);
  });
});
