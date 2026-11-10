import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { deckView, type DeckItem } from "../domain/deck";
import { createRepos, type Repos } from "../repo";
import { deckVerdicts, readGhWatchState } from "./deck";
import { fakeGh, http, path, type Handler } from "./test/fake-gh";

const NOW = new Date("2026-11-10T11:00:00");
const ME = "acorrea-designli";
const HEAD = "0a58206d1b0c4e6f8a1b2c3d4e5f60718293a4b5";

describe("readGhWatchState", () => {
  it("reads the file, and a missing or invalid one is null, never a throw", () => {
    const dir = mkdtempSync(join(tmpdir(), "mesa-deck-"));
    try {
      writeFileSync(join(dir, "ok.json"), JSON.stringify({ counts: { total: 2 }, polledAt: "2026-11-10T10:55:00" }));
      writeFileSync(join(dir, "bad.json"), "{ not json");
      expect(deckView(readGhWatchState(join(dir, "ok.json")), NOW)).toMatchObject({ state: "fresh", total: 2 });
      expect(readGhWatchState(join(dir, "bad.json"))).toBeNull();
      expect(deckView(readGhWatchState(join(dir, "missing.json")), NOW).state).toBe("none");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const it_ = (num: number, extra: Partial<DeckItem> = {}): DeckItem => ({
  key: `7-Arrow/dre-backend#${num}`,
  repo: "7-Arrow/dre-backend",
  num,
  title: `PR ${num}`,
  author: "dev1",
  url: `https://github.com/7-Arrow/dre-backend/pull/${num}`,
  head: "0a58206",
  reason: "review_requested",
  notificationReason: "",
  type: "",
  ...extra,
});

const detail =
  (reviews: Record<number, unknown[]>, over: Record<string, unknown> = {}): Handler =>
  (a) => {
    const p = path(a) ?? "";
    const m = /^repos\/.+\/pulls\/(\d+)(\/reviews.*)?$/.exec(p);
    if (!m) return undefined;
    if (m[2]) return http(200, {}, reviews[Number(m[1])] ?? []);
    return http(200, {}, { additions: 1, deletions: 1, head: { sha: HEAD, ref: "feat/x" }, base: { ref: "develop" }, draft: false, user: { login: "dev1" }, ...over });
  };

describe("deckVerdicts", () => {
  let r: Repos;
  beforeEach(() => {
    r = createRepos(openDb(":memory:"));
  });

  it("reads GitHub once per counted PR (pull + reviews) and judges by his approve at the current head", async () => {
    const gh = fakeGh(detail({ 439: [{ state: "APPROVED", commit_id: HEAD, user: { login: ME } }], 476: [] }));
    const out = await deckVerdicts(r, gh.run, ME, [it_(439, { reason: "post_approve_push" }), it_(476)]);
    expect(out.map((v) => [v.num, v.verdict])).toEqual([
      [439, "no_interesa"],
      [476, "interesa"],
    ]);
    expect(out[0]!.disagree).toBe("ya aprobaste este head en GitHub; el deck lee un estado viejo del pr-monitor");
    expect(gh.calls.filter((c) => /pulls\/\d+$/.test(path(c.args) ?? "")).length).toBe(2);
  });

  it("adds Mesa's item, review ticket, reviewer head and open findings", async () => {
    r.items.upsert({ source: "github", externalId: "pr:7-Arrow/dre-backend#476", kind: "pr_review", title: "#476 · PR", project: "dre-backend" }, NOW);
    const t = r.tickets.create({ direction: "claude_asks", title: "review", body: "b", ownerSession: "lead" }, NOW);
    r.reviews.open(t.ref, { repo: "7-Arrow/dre-backend", pr: 476, sha: HEAD }, NOW);
    r.reviews.upsertFinding(t.ref, { repo: "7-Arrow/dre-backend", pr: 476, label: "blocker", summary: "x", state: "open" }, NOW);
    const out = await deckVerdicts(r, fakeGh(detail({})).run, ME, [it_(476)]);
    expect(out[0]!.verdict).toBe("interesa");
    expect(out[0]!.mesa).toBe(`Mesa ya la tiene: ticket ${t.ref}, el reviewer vio 0a58206 (el actual), 1 hallazgo abierto`);
  });

  it("a skipped item and an ignored project are decided by Mesa alone: GitHub is never read", async () => {
    const a = r.items.upsert({ source: "github", externalId: "pr:7-Arrow/dre-backend#1", kind: "pr_review", title: "#1", project: "dre-backend" }, NOW).item;
    r.items.skip(a.id, NOW);
    r.ignored.add({ source: "github", project: "7-Arrow/dre-frontend" }, NOW);
    const gh = fakeGh(detail({}));
    const out = await deckVerdicts(r, gh.run, ME, [it_(1), it_(2, { repo: "7-Arrow/dre-frontend", key: "7-Arrow/dre-frontend#2" })]);
    expect(out.map((v) => v.why)).toEqual(["la saltaste en Mesa", "el proyecto está ignorado en Mesa"]);
    expect(gh.calls).toHaveLength(0);
  });

  it("a draft and a release-train PR are discarded from the same read", async () => {
    const rel = await deckVerdicts(r, fakeGh(detail({}, { head: { sha: HEAD, ref: "develop" }, base: { ref: "staging" } })).run, ME, [it_(3, { title: "Create staging PR" })]);
    expect(rel[0]).toMatchObject({ verdict: "no_interesa", why: "es una PR de release train" });
    const draft = await deckVerdicts(r, fakeGh(detail({}, { draft: true })).run, ME, [it_(4)]);
    expect(draft[0]).toMatchObject({ verdict: "no_interesa", why: "es un borrador" });
  });

  it("a rate limit reads sin dato for that PR and the rest, and a plain failure only for its PR", async () => {
    const limited = fakeGh((a) => (path(a) ? http(403, { "X-RateLimit-Remaining": "0" }, { message: "API rate limit exceeded" }) : undefined));
    const out = await deckVerdicts(r, limited.run, ME, [it_(1), it_(2), it_(3), it_(4), it_(5)]);
    expect(out.every((v) => v.verdict === "sin_dato")).toBe(true);
    expect(out[0]!.why).toMatch(/límite/);
    expect(out[4]!.why).toMatch(/límite/);

    const broken = fakeGh(
      (a) => (path(a)?.includes("pulls/9") ? http(500, {}, "boom") : undefined),
      detail({}),
    );
    const mixed = await deckVerdicts(r, broken.run, ME, [it_(9), it_(10)]);
    expect(mixed.map((v) => v.verdict)).toEqual(["sin_dato", "interesa"]);
    expect(mixed[0]!.why).toBe("no se pudo leer la PR en GitHub");
  });

  it("with GitHub off (sandbox, scratch DB) nothing is read and the PR reads sin dato", async () => {
    const out = await deckVerdicts(r, null, ME, [it_(1)]);
    expect(out[0]).toMatchObject({ verdict: "sin_dato" });
    expect(out[0]!.why).toMatch(/apagado/);
  });
});
