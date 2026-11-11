// t107: PRs and Slack messages about PRs reach Claude on their own (repo/intake.ts, github-ingest auto-dispatch).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as PR_NOTICE } from "@/app/api/items/[id]/pr-notice/route";
import { POST as UPSERT } from "@/app/api/items/upsert/route";
import { openDb } from "../db/sqlite";
import { syncReviewRequests } from "../integrations/github-ingest";
import { fakeGh, http, path, type Handler } from "../integrations/test/fake-gh";
import { eventsAfter } from "../wake/wake";
import { createRepos, type Repos } from ".";
import type { ItemInput } from "./items";
import { autoDispatchEnabled, parsePrRef, prCardTitle } from "./intake";

const T0 = new Date("2026-11-11T15:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const LOGIN = "acorrea-designli";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;

const pr = (repo: string, n: number, extra: Record<string, unknown> = {}) => ({
  number: n,
  title: `PR ${n}`,
  html_url: `https://github.com/${repo}/pull/${n}`,
  repository_url: `https://api.github.com/repos/${repo}`,
  draft: false,
  updated_at: "2026-11-11T14:00:00Z",
  user: { login: "sebas" },
  ...extra,
});

let search: unknown[] = [];
const searchH: Handler = (a) =>
  path(a)?.startsWith("search/issues") ? http(200, {}, { total_count: search.length, incomplete_results: false, items: search }) : undefined;
const detailH: Handler = (a) => {
  const p = path(a) ?? "";
  if (/^repos\/.+\/pulls\/\d+$/.test(p)) {
    const release = /pulls\/99$/.test(p);
    return http(200, {}, { additions: 10, deletions: 2, head: { sha: "h1", ref: release ? "develop" : "feat/x" }, base: { ref: "staging" } });
  }
  if (/^repos\/.+\/pulls\/\d+\/reviews/.test(p)) return http(200, {}, []);
  return undefined;
};
const sync = (now: Date, autoDispatch = true) => syncReviewRequests(r, fakeGh(searchH, detailH).run, LOGIN, now, { autoDispatch });

const wakes = (kind?: string) => eventsAfter(r.db, "lead", 0, 1000).filter((e) => !kind || e.kind === kind);
const reviewTickets = () => r.tickets.list().filter((t) => t.title.startsWith("Review "));

const slack = (ts: string, meta: Record<string, unknown>, o: Partial<ItemInput> = {}): ItemInput => ({
  source: "slack",
  externalId: `D0SEBAS:${ts}`,
  kind: "message",
  title: "Sebastián · ¿puedes revisar?",
  excerpt: "¿por qué cambiaste el timeout?",
  project: "Sebastián",
  url: `https://designli.slack.com/archives/D0SEBAS/p${ts.replace(".", "")}`,
  waitOn: "you",
  meta: { channel: "Sebastián", ...meta },
  ...o,
});

const upsertRoute = async (input: ItemInput) => {
  const res = await UPSERT(new Request("http://local/api/items/upsert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }), {
    params: Promise.resolve({}),
  });
  return { status: res.status, body: (await res.json()) as { item: { id: string; station: string; waitOn: string; meta: Record<string, unknown> }; intake?: Record<string, unknown> } };
};

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  search = [];
});

describe("criterion 1: a new review request dispatches itself", () => {
  it("gets its card and a review ticket with ticket.created; a second sync creates nothing", async () => {
    search = [pr("acme/api", 7)];
    const out = await sync(T0);
    expect(out.intake).toMatchObject({ created: ["t1"], reused: [], batchId: null });
    const [t] = reviewTickets();
    expect(t).toMatchObject({ direction: "andres_asks", status: "waiting_claude", ownerSession: "lead" });
    expect(t!.title).toBe("Review acme/api#7 · sebas: PR 7");
    const card = r.tasks.get(t!.taskId!);
    expect(card.title).toBe("acme/api#7 · sebas: PR 7");
    expect(card.items?.map((i) => i.url)).toEqual(["https://github.com/acme/api/pull/7"]);
    expect(wakes("ticket.created").map((w) => w.payload)).toEqual([{ ref: "t1", ticketRef: "t1", taskId: card.id, kind: "review" }]);

    search = [pr("acme/api", 7, { updated_at: "2026-11-11T15:30:00Z" })];
    await sync(at(10));
    await sync(at(20));
    expect(r.tickets.list()).toHaveLength(1);
    expect(r.tasks.list()).toHaveLength(1);
    expect(wakes()).toHaveLength(1);
  });

  it("2+ new requests in one sync wake the lead once with ticket.batch (origin github)", async () => {
    search = [pr("acme/api", 7), pr("acme/web", 8)];
    const out = await sync(T0);
    expect(out.intake!.created).toHaveLength(2);
    expect(wakes("ticket.created")).toHaveLength(0);
    const [b] = wakes("ticket.batch");
    expect(b!.payload).toMatchObject({ batchId: out.intake!.batchId, origin: "github" });
    expect((b!.payload.tickets as { title: string; kind: string }[]).map((x) => [x.title, x.kind])).toEqual([
      ["Review acme/api#7 · sebas: PR 7", "review"],
      ["Review acme/web#8 · sebas: PR 8", "review"],
    ]);
  });

  it("keeps the gate: drafts, ignored projects, skipped items and release-train PRs never dispatch", async () => {
    r.ignored.add({ source: "github", project: "acme/secret" });
    search = [pr("acme/api", 1, { draft: true }), pr("acme/secret", 2), pr("acme/api", 99, { title: "Create staging PR" }), pr("acme/api", 3)];
    await sync(T0);
    expect(reviewTickets().map((t) => t.title)).toEqual(["Review acme/api#3 · sebas: PR 3"]);

    // Skipped: he pressed Saltar on a request that came back; it stays done and gets no ticket.
    const skippedItem = r.items.upsert({ source: "github", externalId: "pr:acme/api#4", kind: "pr_review", title: "#4 · PR 4", url: "https://github.com/acme/api/pull/4", meta: { repo: "acme/api", pr: 4, updatedAt: "x" } }).item;
    r.items.skip(skippedItem.id);
    search = [pr("acme/api", 3), pr("acme/api", 4, { updated_at: "2026-11-11T16:00:00Z" })];
    await sync(at(5));
    expect(reviewTickets()).toHaveLength(1);
  });

  it("never dispatches a sample item", () => {
    const s = r.items.upsert({ source: "github", externalId: "pr:acme/api#5", kind: "pr_review", title: "#5", url: "https://github.com/acme/api/pull/5", isSample: true, meta: { repo: "acme/api", pr: 5 } }).item;
    expect(r.intake.reviewItems([s.id], T0)).toEqual({ created: [], reused: [], reopened: [], batchId: null });
    expect(r.tickets.list()).toHaveLength(0);
  });
});

describe("criterion 2: one PR, one ticket", () => {
  it("a re-request on a closed review ticket reopens that ticket; never a second one", async () => {
    search = [pr("acme/api", 7)];
    await sync(T0);
    const t = reviewTickets()[0]!;
    r.tickets.transition(t.ref, { type: "claim" }, "lead", at(1));
    r.tickets.transition(t.ref, { type: "close", by: "claude" }, undefined, at(2));
    // He reviewed: the request disappears, the item goes to Hecho.
    search = [];
    await sync(at(3));
    expect(r.items.list({ source: "github" })[0]!.station).toBe("done");
    // Re-requested after a push: the PR moved.
    search = [pr("acme/api", 7, { updated_at: "2026-11-11T16:00:00Z" })];
    const out = await sync(at(60));
    expect(out.intake).toMatchObject({ created: [], reused: [t.ref], reopened: [t.ref] });
    expect(r.tickets.list()).toHaveLength(1);
    expect(r.tickets.get(t.ref).status).toBe("waiting_claude");
    expect(wakes("ticket.reopened").map((w) => w.payload)).toEqual([{ ref: t.ref, repo: "acme/api", pr: 7, reason: "review re-requested" }]);
  });

  it("a done item whose PR did not move (its card closed with the ticket) does not reopen the ticket", async () => {
    search = [pr("acme/api", 7)];
    await sync(T0);
    const t = reviewTickets()[0]!;
    r.tickets.transition(t.ref, { type: "claim" }, "lead", at(1));
    r.tickets.transition(t.ref, { type: "close", by: "claude" }, undefined, at(2));
    expect(r.items.list({ source: "github" })[0]!.station).toBe("done"); // the card took it to Hecho
    await sync(at(10));
    expect(r.tickets.get(t.ref).status).toBe("closed");
    expect(wakes("ticket.reopened")).toHaveLength(0);
  });

  it("matches by the review row first: a PR reviewed from a hand-made ticket reuses it", async () => {
    const own = r.tickets.create({ direction: "andres_asks", title: "haz review de api#7", ownerSession: "lead" }, T0);
    r.reviews.open(own.ref, { repo: "acme/api", pr: 7, sha: "h0" }, T0);
    search = [pr("acme/api", 7)];
    const out = await sync(at(1));
    expect(out.intake).toMatchObject({ created: [], reused: [own.ref] });
    expect(r.tickets.list()).toHaveLength(1);
  });

  it("then by the card's item address: a card holding the PR keeps its ticket", async () => {
    const link = r.items.upsert({ source: "slack", externalId: "C1:1.1", kind: "message", title: "Ana · mira esto", url: "https://github.com/Acme/API/pull/7/files" }).item;
    const card = r.tasks.create({ title: "api#7", source: "slack", itemIds: [link.id] }, T0);
    const d = r.dispatch.dispatch(card.id, {}, T0);
    search = [pr("acme/api", 7)];
    const out = await sync(at(1));
    expect(out.intake).toMatchObject({ created: [], reused: [d.ticket.ref] });
    expect(r.tickets.list()).toHaveLength(1);
    // The PR item joins that card.
    expect(r.items.list({ source: "github" })[0]!.taskId).toBe(card.id);
  });
});

describe("criterion 3: one switch, no back-fill", () => {
  it("autoDispatch off: the item is ingested as before, no card, no ticket, no wake", async () => {
    search = [pr("acme/api", 7)];
    const out = await sync(T0, false);
    expect(out.created).toBe(1);
    expect(out.intake).toBeUndefined();
    expect(r.tasks.list()).toHaveLength(0);
    expect(r.tickets.list()).toHaveLength(0);
    expect(wakes()).toHaveLength(0);
  });

  it("items already in Hoy at deploy time are not back-filled, even when their PR moves", async () => {
    search = [pr("acme/api", 7)];
    await sync(T0, false); // before the deploy
    search = [pr("acme/api", 7, { updated_at: "2026-11-11T16:00:00Z" })];
    const out = await sync(at(10), true);
    expect(out.updated).toBe(1);
    expect(out.intake).toBeUndefined();
    expect(r.tickets.list()).toHaveLength(0);
  });

  it("reads config/sweep.json autoDispatch (default on), and MESA_AUTO_DISPATCH overrides it", () => {
    const dir = mkdtempSync(join(tmpdir(), "mesa-intake-"));
    const cfg = join(dir, "sweep.json");
    writeFileSync(cfg, JSON.stringify({ autoDispatch: false }));
    expect(autoDispatchEnabled({}, cfg)).toBe(false);
    expect(autoDispatchEnabled({ MESA_AUTO_DISPATCH: "on" }, cfg)).toBe(true);
    writeFileSync(cfg, JSON.stringify({}));
    expect(autoDispatchEnabled({}, cfg)).toBe(true);
    expect(autoDispatchEnabled({ MESA_AUTO_DISPATCH: "off" }, cfg)).toBe(false);
    expect(autoDispatchEnabled({}, join(dir, "missing.json"))).toBe(true);
    // The repo's own config ships it on.
    expect(autoDispatchEnabled({})).toBe(true);
  });

  it("a Slack PR message is a plain item when the switch is off", () => {
    const out = r.intake.upsertItem(slack("1.1", { pr: "acme/api#7" }), { enabled: false }, T0);
    expect(out.intake).toBeUndefined();
    expect(r.tickets.list()).toHaveLength(0);
    expect(out.item.meta.ticketRef).toBeUndefined();
  });
});

describe("criterion 5: a Slack message about a PR joins the PR's ticket", () => {
  it("links to the existing PR ticket (meta.ticketRef) and leaves a line with who and the link", async () => {
    search = [pr("acme/api", 7)];
    await sync(T0);
    const t = reviewTickets()[0]!;
    const out = r.intake.upsertItem(slack("1.1", { pr: "acme/api#7" }), { enabled: true }, at(1));
    expect(out.intake).toMatchObject({ ticketRef: t.ref, ticketCreated: false, repeated: false });
    expect(out.item.meta).toMatchObject({ ticketRef: t.ref, prTicketId: t.id });
    const line = r.tickets.detail(t.ref).messages.at(-1)!;
    expect(line.author).toBe("claude");
    expect(line.body).toContain("Sebastián");
    expect(line.body).toContain(out.item.url!);
    expect(r.tickets.list()).toHaveLength(1);
  });

  it("a PR with nothing yet gets its item, card and review ticket under the same key, and the GitHub request lands on them", async () => {
    const out = r.intake.upsertItem(slack("1.1", { pr: "https://github.com/Acme/Api/pull/7" }), { enabled: true }, T0);
    expect(out.intake).toMatchObject({ ticketCreated: true });
    const t = reviewTickets()[0]!;
    expect(t.title).toBe("Review acme/api#7");
    expect(wakes("ticket.created").map((w) => w.payload.kind)).toEqual(["review"]);
    expect(wakes("ticket.batch")).toHaveLength(0);
    const prItem = r.items.list({ source: "github" })[0]!;
    expect(prItem).toMatchObject({ externalId: "pr:acme/api#7", kind: "pr_review", taskId: t.taskId });

    // GitHub's casing differs from the Slack link: still the same item, card and ticket.
    search = [pr("Acme/Api", 7)];
    const s = await sync(at(5));
    expect(s.created).toBe(0);
    expect(r.items.list({ source: "github" })).toHaveLength(1);
    expect(r.items.get(prItem.id).title).toBe("#7 · PR 7");
    expect(r.tickets.list()).toHaveLength(1);
    expect(wakes("ticket.created")).toHaveLength(1);
  });

  it("does not open a ticket for an ignored repo or a PR he skipped", () => {
    r.ignored.add({ source: "github", project: "acme/secret" });
    r.intake.upsertItem(slack("1.1", { pr: "acme/secret#1" }), { enabled: true }, T0);
    const skipped = r.items.upsert({ source: "github", externalId: "pr:acme/api#2", kind: "pr_review", title: "#2", url: "https://github.com/acme/api/pull/2", meta: { repo: "acme/api", pr: 2 } }).item;
    r.items.skip(skipped.id);
    const out = r.intake.upsertItem(slack("1.2", { pr: "acme/api#2" }), { enabled: true }, T0);
    expect(out.intake).toBeUndefined();
    expect(r.tickets.list()).toHaveLength(0);
  });

  it("parses meta.pr in its forms", () => {
    expect(parsePrRef("acme/api#7")).toEqual({ repo: "acme/api", n: 7 });
    expect(parsePrRef("github.com/Acme/Api/pull/7/checks")).toEqual({ repo: "acme/api", n: 7 });
    expect(parsePrRef("acme#7")).toBeNull();
    expect(parsePrRef(7)).toBeNull();
    expect(prCardTitle({ repo: "acme/api", n: 7 })).toBe("acme/api#7");
  });
});

describe("criteria 4 and 7: Mesa does not judge; the writer on the PR ticket does", () => {
  it("meta.intent is ignored: even a 'notice' tag gets a neutral line, ONE ticket.pr_message wake, and stays in Hoy", async () => {
    search = [pr("acme/api", 7)];
    await sync(T0);
    const t = reviewTickets()[0]!;
    const before = wakes().length;
    const out = r.intake.upsertItem(slack("1700000000.000200", { pr: "acme/api#7", intent: "notice", threadTs: "1700000000.000100" }), { enabled: true }, at(1));
    expect(out.item).toMatchObject({ station: "inbox", waitOn: "you" });
    expect(out.item.meta.prIntake).toMatchObject({ verdict: null, reopened: false, ticketCreated: false });
    expect(wakes().slice(before).map((w) => w.kind)).toEqual(["ticket.pr_message"]);
    const line = r.tickets.detail(t.ref).messages.at(-1)!;
    expect(wakes("ticket.pr_message")[0]!.payload).toEqual({
      ref: t.ref,
      ticketRef: t.ref,
      messageId: line.id,
      itemId: out.item.id,
      repo: "acme/api",
      pr: 7,
      who: "Sebastián",
      url: out.item.url,
      channelId: "D0SEBAS",
      ts: "1700000000.000200",
      threadTs: "1700000000.000100",
    });
    expect(line.body).toMatch(/^Mensaje en Slack de Sebastián sobre api#7: /);
    expect(r.tickets.get(t.ref).status).toBe("waiting_claude"); // the line does not change it
  });

  it("a question ends in a salida to the same thread: sent settles the item, another thread does not", async () => {
    search = [pr("acme/api", 7)];
    await sync(T0);
    const t = reviewTickets()[0]!;
    const out = r.intake.upsertItem(slack("1700000000.000200", { pr: "acme/api#7", threadTs: "1700000000.000100" }), { enabled: true }, at(1));
    const dest = { kind: "slack_thread" as const, workspace: "designli", channel: "Sebastián", channelId: "D0SEBAS", postAs: "Andrés" };
    // A reply to another thread leaves it alone.
    const other = r.salidas.create({ source: "slack", destination: { ...dest, threadTs: "1.0" }, body: "otra", ticketId: t.id }, at(2));
    r.salidas.transition(other.id, { type: "deny" }, at(3));
    expect(r.items.get(out.item.id).station).toBe("inbox");
    // Its own reply: approved, released, sent -> the item leaves Hoy.
    const s = r.salidas.create({ source: "slack", destination: { ...dest, threadTs: "1700000000.000100" }, body: "porque…", ticketId: t.id }, at(4));
    r.salidas.transition(s.id, { type: "approve", version: 1, mode: "send" }, at(5));
    expect(r.items.get(out.item.id).station).toBe("inbox");
    r.salidas.transition(s.id, { type: "release" }, at(6));
    r.salidas.transition(s.id, { type: "sent" }, at(6));
    expect(r.items.get(out.item.id)).toMatchObject({ station: "done", waitOn: "none" });
  });

  it("a denied reply also settles it", () => {
    const out = r.intake.upsertItem(slack("1.1", { pr: "acme/api#7" }), { enabled: true }, T0);
    const t = r.tickets.get(String(out.item.meta.ticketRef));
    const s = r.salidas.create({ source: "slack", destination: { kind: "slack_thread", workspace: "designli", channel: "x", postAs: "Andrés" }, body: "b", ticketId: t.id }, at(1));
    r.salidas.transition(s.id, { type: "deny" }, at(2));
    expect(r.items.get(out.item.id).station).toBe("done");
  });

  it("a message on a closed PR ticket reopens it quietly: the only wake is ticket.pr_message", async () => {
    search = [pr("acme/api", 7)];
    await sync(T0);
    const t = reviewTickets()[0]!;
    r.tickets.transition(t.ref, { type: "claim" }, "lead", at(1));
    r.tickets.transition(t.ref, { type: "close", by: "claude" }, undefined, at(2));
    const before = wakes().length;
    const out = r.intake.upsertItem(slack("1.1", { pr: "acme/api#7" }), { enabled: true }, at(3));
    expect(r.tickets.get(t.ref).status).toBe("waiting_claude");
    expect(out.item.meta.prIntake).toMatchObject({ reopened: true, verdict: null });
    expect(wakes().slice(before).map((w) => w.kind)).toEqual(["ticket.pr_message"]);
  });
});

describe("criterion 6: the writer's notice verdict (mesa item pr-notice)", () => {
  const notice = async (id: string) => {
    const res = await PR_NOTICE(new Request(`http://local/api/items/${id}/pr-notice`, { method: "POST" }), { params: Promise.resolve({ id }) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("goes to Hecho with waitOn none, leaves one informational line, no salida and no wake; a repeat is a no-op", async () => {
    search = [pr("acme/api", 7)];
    await sync(T0);
    const t = reviewTickets()[0]!;
    const out = r.intake.upsertItem(slack("1.1", { pr: "acme/api#7" }, { title: "Sebastián · te dejé la PR", excerpt: undefined }), { enabled: true }, at(1));
    const lines = r.tickets.detail(t.ref).messages.length;
    const n = wakes().length;
    const v = r.intake.prNotice(out.item.id, at(2));
    expect(v).toMatchObject({ ticketRef: t.ref, repeated: false });
    expect(v.item).toMatchObject({ station: "done", waitOn: "none" });
    expect(v.item.meta.prIntake).toMatchObject({ verdict: "notice", verdictAt: at(2).toISOString() });
    expect(r.tickets.detail(t.ref).messages.at(-1)!.body).toMatch(/^Aviso en Slack de Sebastián sobre api#7, sin respuesta: te dejé la PR/);
    expect(r.tickets.detail(t.ref).messages.length).toBe(lines + 1);
    expect(r.tickets.get(t.ref).status).toBe("waiting_claude");
    expect(r.salidas.list()).toHaveLength(0);
    expect(wakes().length).toBe(n);

    const again = r.intake.prNotice(out.item.id, at(3));
    expect(again.repeated).toBe(true);
    expect(r.tickets.detail(t.ref).messages.length).toBe(lines + 1);
    expect(r.items.get(out.item.id).meta.prIntake).toMatchObject({ verdictAt: at(2).toISOString() });
  });

  it("through POST /api/items/:id/pr-notice: 200, 200 repeated, 409 for an item that is not a linked PR message, 404 for none", async () => {
    const out = r.intake.upsertItem(slack("1.1", { pr: "acme/api#7" }), { enabled: true }, T0);
    const a = await notice(out.item.id);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ repeated: false, ticketRef: out.item.meta.ticketRef, item: { station: "done", waitOn: "none" } });
    expect((await notice(out.item.id)).body).toMatchObject({ repeated: true });
    const plain = r.items.upsert(slack("2.2", {})).item;
    expect((await notice(plain.id)).status).toBe(409);
    expect((await notice("it_missing")).status).toBe(404);
  });

  it("closes again, quietly, a ticket that this message reopened, unless something else is pending on it", async () => {
    search = [pr("acme/api", 7)];
    await sync(T0);
    const t = reviewTickets()[0]!;
    r.tickets.transition(t.ref, { type: "claim" }, "lead", at(1));
    r.tickets.transition(t.ref, { type: "close", by: "claude" }, undefined, at(2));
    const a = r.intake.upsertItem(slack("1.1", { pr: "acme/api#7" }), { enabled: true }, at(3));
    const n = wakes().length;
    r.intake.prNotice(a.item.id, at(4));
    expect(r.tickets.get(t.ref).status).toBe("closed");
    expect(wakes().length).toBe(n);

    // Reopened again by a second message, while a third (same ticket, no verdict yet) still waits: it stays open.
    const b = r.intake.upsertItem(slack("1.2", { pr: "acme/api#7" }), { enabled: true }, at(5));
    const c = r.intake.upsertItem(slack("1.3", { pr: "acme/api#7" }), { enabled: true }, at(6));
    expect(b.item.meta.prIntake).toMatchObject({ reopened: true });
    expect(c.item.meta.prIntake).toMatchObject({ reopened: false });
    r.intake.prNotice(b.item.id, at(7));
    expect(r.tickets.get(t.ref).status).not.toBe("closed");
    // A reply to the third one settles it; the notice is already in Hecho and stays as it is.
    const s = r.salidas.create({ source: "slack", destination: { kind: "slack_thread", workspace: "designli", channel: "x", channelId: "D0SEBAS", threadTs: "1.3", postAs: "Andrés" }, body: "b", ticketId: t.id }, at(8));
    r.salidas.transition(s.id, { type: "deny" }, at(9));
    expect(r.items.get(c.item.id)).toMatchObject({ station: "done", waitOn: "none" });
    expect(r.items.get(b.item.id).meta.prIntake).toMatchObject({ verdict: "notice" });
  });

  it("does not close a reopened ticket while one of its salidas is in flight", async () => {
    search = [pr("acme/api", 7)];
    await sync(T0);
    const t = reviewTickets()[0]!;
    r.tickets.transition(t.ref, { type: "claim" }, "lead", at(1));
    r.tickets.transition(t.ref, { type: "close", by: "claude" }, undefined, at(2));
    const a = r.intake.upsertItem(slack("1.1", { pr: "acme/api#7" }), { enabled: true }, at(3));
    r.salidas.create({ source: "slack", destination: { kind: "slack_thread", workspace: "designli", channel: "x", channelId: "D0OTRO", threadTs: "9.9", postAs: "Andrés" }, body: "b", ticketId: t.id }, at(4));
    r.intake.prNotice(a.item.id, at(5));
    expect(r.tickets.get(t.ref).status).not.toBe("closed");
  });
});

describe("criterion 8: re-reading the same message changes nothing", () => {
  it("no second line, wake, ticket or card; the link and a notice's Hecho stand", () => {
    const input = slack("1.1", { pr: "acme/api#7" });
    const first = r.intake.upsertItem(input, { enabled: true }, T0);
    const lines = r.tickets.detail(String(first.item.meta.ticketRef)).messages.length;
    const n = wakes().length;
    for (const k of [1, 2]) {
      const again = r.intake.upsertItem({ ...input, excerpt: `editado ${k}` }, { enabled: true }, at(k));
      expect(again.intake).toMatchObject({ repeated: true, ticketRef: first.item.meta.ticketRef });
      expect(again.item.excerpt).toBe(`editado ${k}`);
      expect(again.item.meta.ticketRef).toBe(first.item.meta.ticketRef);
    }
    expect(r.tickets.detail(String(first.item.meta.ticketRef)).messages.length).toBe(lines);
    expect(wakes().length).toBe(n);
    expect(r.tickets.list()).toHaveLength(1);
    expect(r.tasks.list()).toHaveLength(1);

    r.intake.prNotice(first.item.id, at(3));
    const again = r.intake.upsertItem(input, { enabled: true }, at(4)); // the sweeper sends waitOn "you" again
    expect(again.item).toMatchObject({ station: "done", waitOn: "none" });
    expect(again.item.meta.prIntake).toMatchObject({ verdict: "notice" });
    expect(wakes().length).toBe(n);
  });

  it("through POST /api/items/upsert: 201 then 200, one ticket, one pr_message", async () => {
    const input = slack("1.1", { pr: "acme/api#7" });
    const a = await upsertRoute(input);
    const b = await upsertRoute(input);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(a.body.intake).toEqual({ ticketRef: a.body.item.meta.ticketRef, ticketCreated: true, repeated: false });
    expect(b.body.intake).toMatchObject({ repeated: true });
    expect(r.tickets.list()).toHaveLength(1);
    expect(wakes("ticket.pr_message")).toHaveLength(1);
  });
});
