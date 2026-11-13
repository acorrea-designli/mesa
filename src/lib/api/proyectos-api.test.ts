// GET /api/proyectos (t152): one project's view model and the rail count, from the SQLite cache and Mesa's reviews,
// tickets and review items only. No gh runner exists in this test: a call to GitHub would fail it.
import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/proyectos/route";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { projectsCache } from "../integrations/projects-cache";
import type { OpenPr } from "../integrations/projects-gh";
import { mesaLinks } from "../integrations/projects-view";
import { prKey } from "../integrations/projects-join";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
const T0 = new Date("2026-11-13T15:00:00.000Z");
const get = (qs = "") => GET(new Request(`http://local/api/proyectos${qs}`), { params: Promise.resolve({}) });

const pr = (repo: string, n: number, over: Partial<OpenPr> = {}): OpenPr => ({
  repo,
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/${repo}/pull/${n}`,
  author: "dev1",
  draft: false,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-12T10:00:00Z",
  headSha: `sha${n}`,
  headRef: `fix/${n}`,
  baseRef: "develop",
  body: "",
  requested: [],
  ...over,
});

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" }, T0);
  const c = projectsCache(r.db);
  c.replaceRepo("7-Arrow/dre-backend", [pr("7-Arrow/dre-backend", 490, { title: "feat(GHI-484): backend" }), pr("7-Arrow/dre-backend", 452)], { etag: "e", truncated: false }, T0);
  c.replaceRepo("7-Arrow/dre-frontend", [pr("7-Arrow/dre-frontend", 610, { title: "feat(GHI-484): frontend" })], { etag: "e", truncated: false }, T0);
  c.replaceRepo("designli/prospec-backend", [pr("designli/prospec-backend", 46, { title: "feat: team queue (#219)" })], { etag: "e", truncated: false }, T0);
  c.setDetails([{ repo: "7-Arrow/dre-backend", number: 490, headSha: "sha490", mergeable: "CONFLICTING", checks: { state: "fail", total: 4, failed: 1, pending: 0 }, reviewDecision: "CHANGES_REQUESTED", myReview: null, closingIssues: [] }], T0);
  c.replaceBoard(
    "dre",
    { owner: "7-Arrow", number: 2 },
    {
      title: "DRE-RMS-backlog",
      url: "https://github.com/orgs/7-Arrow/projects/2",
      statusOptions: ["To-do", "In QA"],
      items: [{ itemId: "I484", contentType: "Issue", repo: "7-Arrow/dre-backlog", number: 484, title: "Dispositions", url: "u", state: "OPEN", status: "In QA", linkedPrs: [] }],
    },
    T0,
  );
  // Mesa: a review of #490 with an open blocker, on a ticket; #610 is a review request in Hoy; #452 is linked from a
  // ticket by URL.
  const t1 = r.tickets.create({ direction: "andres_asks", title: "Review dre-backend#490", ownerSession: "lead", project: "dre-backend" }, T0);
  r.reviews.open(t1.ref, { repo: "7-Arrow/dre-backend", pr: 490, sha: "sha490" }, T0);
  r.reviews.upsertFinding(t1.ref, { repo: "7-Arrow/dre-backend", pr: 490, label: "blocker", summary: "breaks the build", sha: "sha490" }, T0);
  r.items.upsert({ source: "github", externalId: "pr:7-Arrow/dre-frontend#610", kind: "pr_review", title: "#610 · x", project: "dre-frontend", need: "approve_pr", waitOn: "you" }, T0);
  const t2 = r.tickets.create({ direction: "andres_asks", title: "Seeders", ownerSession: "lead" }, T0);
  r.db.prepare("INSERT INTO ticket_refs (id, ticket_id, ref_type, target, created_at) VALUES ('rf_1', ?, 'url', 'https://github.com/7-Arrow/dre-backend/pull/452/files', ?)").run(t2.id, T0.toISOString());
});

describe("GET /api/proyectos", () => {
  it("returns the first project's view, the project tabs and the open PR count for the rail", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.projects).toEqual([
      { key: "dre", name: "DRE-RMS-backlog", boardUrl: "https://github.com/orgs/7-Arrow/projects/2", openPrs: 3 },
      { key: "prospec", name: "Prospec", boardUrl: "https://github.com/orgs/designli/projects/45", openPrs: 1 },
    ]);
    expect(d.openPrs).toBe(4);
    expect(d.configError).toBeNull();
    expect(d.view.key).toBe("dre");
    expect(d.view.readAt).toEqual({ prs: T0.toISOString(), board: T0.toISOString() });
    const by = (n: number) => d.view.prs.find((p: { number: number }) => p.number === n);
    expect(by(490)).toMatchObject({ station: "In QA", issue: "7-arrow/dre-backlog#484", conflicts: true, checks: { state: "fail", failed: 1, total: 4 }, reviewDecision: "CHANGES_REQUESTED", blocker: true, you: "bloqueante", mesa: { state: "open", blockers: 1 } });
    expect(by(490).tickets.map((t: { ref: string }) => t.ref)).toHaveLength(1);
    expect(by(610)).toMatchObject({ station: "In QA", requested: true, teToca: true, you: "sin-review", conflicts: null, checks: null });
    expect(by(452)).toMatchObject({ station: "sin-issue", tickets: [{ title: "Seeders" }] });
    expect(d.view.issues[0]).toMatchObject({ number: 484, interchange: true });
    expect(d.view.defaultStation).toBe("In QA");
    expect(d.health).toMatchObject({ source: "github_projects", state: "ok" });
    expect(d.spend).toBeNull(); // no reader runs in tests
  });

  it("serves another project by key, and 404s for an unknown one", async () => {
    const d = await (await get("?proyecto=prospec")).json();
    expect(d.view).toMatchObject({ key: "prospec", partial: { noBoard: true } });
    expect(d.view.prs.map((p: { number: number; station: string }) => [p.number, p.station])).toEqual([[46, "sin-issue"]]);
    expect((await get("?proyecto=nope")).status).toBe(404);
    expect((await get("?proyecto=../x")).status).toBe(400);
  });

  it("shows the reader's Estados B row and the last good read when GitHub is limited", async () => {
    r.sources.set("github_projects", { health: "degraded", note: "límite de API · 11:05", lastChecked: T0.toISOString(), backoffUntil: "2099-01-01T00:00:00.000Z", cadenceS: 120 }, T0);
    const d = await (await get()).json();
    expect(d.health).toMatchObject({ state: "degraded", note: "límite de API · 11:05" });
    expect(d.view.prs).toHaveLength(3);
    expect(d.view.readAt.prs).toBe(T0.toISOString());
  });
});

describe("mesaLinks", () => {
  it("leaves sample rows and PRs outside the asked set alone", () => {
    r.db.prepare("UPDATE reviews SET is_sample = 1").run();
    const links = mesaLinks(r.db, new Set([prKey("7-Arrow/dre-backend", 490), prKey("7-Arrow/dre-frontend", 610)]));
    expect(links.get(prKey("7-Arrow/dre-backend", 490))).toBeUndefined();
    expect(links.get(prKey("7-Arrow/dre-frontend", 610))).toMatchObject({ requested: true, review: null });
    expect(links.has(prKey("7-Arrow/dre-backend", 452))).toBe(false);
  });
});
