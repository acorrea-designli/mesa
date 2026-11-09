import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { scanOnce } from "./notifier";
import type { Sender } from "./send";

const NOW = Date.UTC(2026, 10, 9, 15, 0, 0);
const SECRET = "Cancela el mensaje a Matt sobre la tarifa de Freightmate";

let r: Repos;
let sent: string[];
let sender: Sender;
const deps = () => ({ repos: r, sender, looking: { isLooking: () => false } });
const payloads = () => sent.map((b) => JSON.parse(b) as { title: string; url: string; tag: string });

const item = (externalId: string, over: Record<string, unknown> = {}) =>
  r.items.upsert({ source: "github", externalId, kind: "pr_review", title: SECRET, excerpt: "texto privado", project: "designli/scout-api", station: "inbox", waitOn: "you", ...over }, new Date(NOW)).item;

beforeEach(async () => {
  r = createRepos(openDb(":memory:"));
  sent = [];
  sender = async (_sub, body) => {
    sent.push(body);
    return { ok: true };
  };
  r.push.upsert({ endpoint: "https://push.example/phone", p256dh: "k", auth: "a" });
  await scanOnce(deps(), NOW - 10_000); // the baseline: Hoy has been read once
  sent.length = 0;
});

describe("push of what arrives in Hoy (t63)", () => {
  it("one item is 'Nuevo en Hoy · <Source>' under the mesa-hoy tag, with no title, people or text", async () => {
    item("gh:1");
    const res = await scanOnce(deps(), NOW);
    expect(res.shown).toBe(1);
    expect(payloads()).toEqual([{ title: "Nuevo en Hoy · GitHub", url: "/", tag: "mesa-hoy" }]);
    expect(sent[0]).not.toContain("Matt");
    expect(sent[0]).not.toContain("scout-api");
    expect(sent[0]).not.toContain("privado");
  });

  it("several in one scan are one push: '<n> nuevos en Hoy'", async () => {
    item("gh:1");
    item("gh:2");
    item("sl:1", { source: "slack" });
    await scanOnce(deps(), NOW);
    expect(payloads()).toEqual([{ title: "3 nuevos en Hoy", url: "/", tag: "mesa-hoy" }]);
  });

  it("a content refresh of an open item does not push again; done and back does", async () => {
    const it1 = item("gh:1");
    await scanOnce(deps(), NOW);
    sent.length = 0;
    item("gh:1", { title: "otro título" }); // the sweeper refreshes it
    await scanOnce(deps(), NOW + 30_000);
    expect(sent).toHaveLength(0);
    r.items.update(it1.id, { station: "done", waitOn: "none" }, new Date(NOW + 40_000));
    await scanOnce(deps(), NOW + 50_000);
    r.items.update(it1.id, { station: "inbox", waitOn: "you" }, new Date(NOW + 60_000)); // review re-requested
    await scanOnce(deps(), NOW + 70_000);
    expect(payloads().map((p) => p.title)).toEqual(["Nuevo en Hoy · GitHub"]);
  });

  it("skips items waiting on someone else, samples and ignored projects", async () => {
    item("gh:client", { waitOn: "client" });
    item("gh:done", { station: "done", waitOn: "none" });
    item("gh:sample", { isSample: true });
    r.ignored.add({ source: "github", project: "designli/prospec-admin" });
    item("gh:ignored", { project: "designli/prospec-admin" });
    const res = await scanOnce(deps(), NOW);
    expect(res.shown).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("the first scan after this ships is a silent baseline for the items already open", async () => {
    const fresh = createRepos(openDb(":memory:"));
    fresh.push.upsert({ endpoint: "https://push.example/phone", p256dh: "k", auth: "a" });
    fresh.items.upsert({ source: "github", externalId: "gh:old", kind: "pr_review", title: "x", excerpt: "", project: "a/b", station: "inbox", waitOn: "you" }, new Date(NOW));
    // The notifier scanned a minute ago (a normal scan, not a baseline) but never read Hoy: seen has no marker.
    fresh.push.saveScan({}, NOW - 60_000);
    const res = await scanOnce({ repos: fresh, sender, looking: { isLooking: () => false } }, NOW);
    expect(res.shown).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
