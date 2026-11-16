import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as HISTORY } from "@/app/api/salidas/history/route";
import { GET } from "@/app/api/salidas/[id]/route";
import { GET as VIEW } from "@/app/api/salidas/[id]/view/route";
import { openDb } from "@/lib/db/sqlite";
import { createRepos } from "@/lib/repo";
import { dayStart } from "@/lib/domain/salida-queue";
import { destinationConfig, loadHistory, loadSalidas, salidaView } from "./read";

const T0 = new Date("2026-11-03T10:00:00.000Z");

describe("salida view carries the destination URL", () => {
  const setup = () => {
    const r = createRepos(openDb(":memory:"));
    const slack = r.salidas.create(
      {
        source: "slack",
        destination: { kind: "slack_thread", workspace: "Designli", channel: "#scout-dev", channelId: "C0SCOUT01", threadTs: "1730640660.118000", postAs: "Andrés" },
        body: "Listo.",
      },
      T0,
    );
    const gh = r.salidas.create({ source: "github", destination: { kind: "github_comment", repo: "designli/scout", pr: 59, postAs: "Andrés" }, body: "LGTM" }, T0);
    return { r, slack, gh };
  };

  it("reads MESA_SLACK_DOMAIN, MESA_BASECAMP_ACCOUNT and MESA_SLACK_TEAM_ID", () => {
    expect(destinationConfig({ MESA_SLACK_DOMAIN: "designli", MESA_BASECAMP_ACCOUNT: "42", MESA_SLACK_TEAM_ID: "T0ABC123" })).toEqual({ slackDomain: "designli", basecampAccount: "42", slackTeamId: "T0ABC123" });
    expect(destinationConfig({})).toEqual({ slackDomain: undefined, basecampAccount: undefined, slackTeamId: undefined });
  });

  it("carries the Abrir conversación links for Slack only, and keeps a draft_created salida in the open list", () => {
    const { r, slack, gh } = setup();
    expect(salidaView(r, slack.id, { slackDomain: "designli", slackTeamId: "T0ABC123" }).conversation).toEqual({
      app: "slack://channel?team=T0ABC123&id=C0SCOUT01&message=1730640660.118000",
      web: "https://designli.slack.com/archives/C0SCOUT01/p1730640660118000",
    });
    expect(salidaView(r, slack.id, {}).conversation).toEqual({ app: null, web: null });
    expect(salidaView(r, gh.id, { slackDomain: "designli", slackTeamId: "T0ABC123" }).conversation).toBeNull();

    r.salidas.transition(slack.id, { type: "approve", version: 1, mode: "draft" }, T0);
    r.salidas.transition(slack.id, { type: "release" }, new Date(T0.getTime() + 25_000));
    r.salidas.transition(slack.id, { type: "drafted" }, new Date(T0.getTime() + 26_000));
    const items = loadSalidas(r, new Date(T0.getTime() + 27_000)).items;
    expect(items.find((s) => s.id === slack.id)).toMatchObject({ status: "draft_created", sendMode: "draft" });
  });

  it("links with the config and shows no link without it", () => {
    const { r, slack, gh } = setup();
    expect(salidaView(r, slack.id, { slackDomain: "designli" }).destinationUrl).toBe("https://designli.slack.com/archives/C0SCOUT01/p1730640660118000");
    expect(salidaView(r, slack.id, {}).destinationUrl).toBeNull();
    expect(salidaView(r, gh.id, {}).destinationUrl).toBe("https://github.com/designli/scout/pull/59");
    expect(loadSalidas(r, T0).items.every((s) => "destinationUrl" in s)).toBe(true);
  });
});

describe("GET /api/salidas/:id exposes destinationUrl", () => {
  afterEach(() => vi.unstubAllEnvs());
  const g = globalThis as unknown as { __mesaRepos?: ReturnType<typeof createRepos> };

  it("carries the URL (config from env) and the permalink after the send", async () => {
    const r = createRepos(openDb(":memory:"));
    g.__mesaRepos = r;
    vi.stubEnv("MESA_SLACK_DOMAIN", "designli");
    const s = r.salidas.create(
      { source: "slack", destination: { kind: "slack_thread", workspace: "Designli", channel: "#scout-dev", channelId: "C0SCOUT01", threadTs: "1730640660.118000", postAs: "Andrés" }, body: "Listo." },
      T0,
    );
    const get = async () => (await (await GET(new Request(`http://local/api/salidas/${s.id}`), { params: Promise.resolve({ id: s.id }) })).json()) as { destinationUrl: string | null };
    expect((await get()).destinationUrl).toBe("https://designli.slack.com/archives/C0SCOUT01/p1730640660118000");
    vi.stubEnv("MESA_SLACK_DOMAIN", "");
    expect((await get()).destinationUrl).toBeNull();
  });
});

// ---------- t204: newest first, the day rule, the Historial ----------

describe("t204 queue strip and Historial", () => {
  const NOW = new Date(2026, 10, 16, 15, 0, 0); // local Monday 16 Nov
  const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
  const dest = { kind: "slack_thread", workspace: "Designli", channel: "#scout-dev", channelId: "C0SCOUT01", threadTs: "1730640660.118000", postAs: "Andrés" } as const;

  const setup = () => {
    const r = createRepos(openDb(":memory:"));
    const mk = (created: Date, body: string, extra: { ticketId?: string } = {}) => r.salidas.create({ source: "slack", destination: dest, body, ...extra }, created);
    const plus = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
    const go = (id: string, d: Date, mode: "draft" | "send" = "send") => {
      r.salidas.transition(id, { type: "approve", version: 1, mode }, d);
      r.salidas.transition(id, { type: "release" }, plus(d, 25));
    };
    const failed = (body: string, created: Date, failedAt: Date) => {
      const s = mk(created, body);
      go(s.id, plus(failedAt, -40));
      r.salidas.transition(s.id, { type: "failed", error: "boom" }, failedAt);
      return s.id;
    };
    const drafted = (body: string, created: Date, when: Date) => {
      const s = mk(created, body);
      go(s.id, plus(when, -40), "draft");
      r.salidas.transition(s.id, { type: "drafted" }, when);
      return s.id;
    };
    const sent = (body: string, created: Date, when: Date) => {
      const s = mk(created, body);
      go(s.id, plus(when, -40));
      r.salidas.transition(s.id, { type: "sent" }, when);
      return s.id;
    };
    return { r, mk, go, plus, failed, drafted, sent };
  };

  it("lists the strip newest first by createdAt, whatever the id or the update order", () => {
    const { r, mk } = setup();
    const a = mk(at(16, 8), "a");
    const b = mk(at(16, 12), "b");
    const c = mk(at(16, 10), "c");
    r.salidas.addVersion(a.id, { body: "a2", author: "claude" }, at(16, 14)); // updated last, still the oldest
    expect(loadSalidas(r, NOW).items.map((s) => s.id)).toEqual([b.id, c.id, a.id]);
  });

  it("applies the day rule: old failed and draft_created out, today failed in, old pending in", () => {
    const { r, mk, go, plus, failed, drafted, sent } = setup();
    const oldPending = mk(at(9, 9), "old pending").id;
    const oldScheduled = mk(at(10, 9), "old scheduled").id;
    r.salidas.transition(oldScheduled, { type: "schedule", at: at(20, 9).toISOString(), version: 1, mode: "send" }, at(10, 9, 5));
    const oldSending = mk(at(10, 11), "old sending").id;
    r.salidas.transition(oldSending, { type: "approve", version: 1, mode: "send" }, at(10, 11, 1));
    const oldQueued = mk(at(11, 9), "old queued").id;
    go(oldQueued, at(11, 9, 5));
    r.salidas.transition(oldQueued, { type: "hold", reason: "lead hold" }, plus(at(11, 9, 5), 30));
    const oldFailed = failed("old failed", at(12, 9), at(12, 9, 30));
    const oldDrafted = drafted("old draft", at(12, 10), at(12, 10, 30));
    const oldSent = sent("old sent", at(15, 9), at(15, 9, 30));
    const oldDenied = mk(at(15, 11), "old denied").id;
    r.salidas.transition(oldDenied, { type: "deny" }, at(15, 11, 5));
    const todayFailed = failed("today failed", at(16, 9), at(16, 9, 30));
    const todayDrafted = drafted("today draft", at(16, 10), at(16, 10, 30));
    const todaySent = sent("today sent", at(16, 11), at(16, 11, 30));
    const failedThisMorning = failed("created yesterday, failed today", at(15, 16), at(16, 8));
    const notProposed = r.salidas.create({ source: "slack", destination: dest, body: "draft", draft: true }, at(16, 12)).id;

    const strip = loadSalidas(r, NOW).items.map((s) => s.id);
    expect(new Set(strip)).toEqual(new Set([oldPending, oldScheduled, oldSending, oldQueued, todayFailed, todayDrafted, todaySent, failedThisMorning]));
    const hist = loadHistory(r, {}, NOW).rows.map((x) => x.id);
    expect(new Set(hist)).toEqual(new Set([oldFailed, oldDrafted, oldSent, oldDenied]));
    // nothing is in both, nothing is lost (a salida Claude has not proposed yet is in neither)
    expect(strip.filter((id) => hist.includes(id))).toEqual([]);
    expect(strip.length + hist.length + 1).toBe(r.salidas.list().length);
    expect([...strip, ...hist]).not.toContain(notProposed);
  });

  it("clears day by day: the same salidas move to the history when the day changes", () => {
    const { r, failed, drafted } = setup();
    const f = failed("f", at(16, 9), at(16, 9, 30));
    const d = drafted("d", at(16, 10), at(16, 10, 30));
    expect(loadSalidas(r, NOW).items.map((s) => s.id).sort()).toEqual([f, d].sort());
    expect(loadHistory(r, {}, NOW).rows).toEqual([]);
    const tomorrow = new Date(2026, 10, 17, 0, 0, 1);
    expect(loadSalidas(r, tomorrow).items).toEqual([]);
    expect(loadHistory(r, {}, tomorrow).rows.map((x) => x.id)).toEqual([d, f]);
  });

  it("a failed one retried from the history is pending and back in the strip", () => {
    const { r, failed } = setup();
    const f = failed("f", at(12, 9), at(12, 9, 30));
    expect(loadHistory(r, {}, NOW).rows.map((x) => x.id)).toEqual([f]);
    r.salidas.transition(f, { type: "retry" }, at(16, 13));
    expect(loadSalidas(r, NOW).items.find((s) => s.id === f)).toMatchObject({ status: "pending" });
    expect(loadHistory(r, {}, NOW).rows).toEqual([]);
  });

  it("the history rows carry the list fields and the ticket ref, and read no ticket history", () => {
    const { r, mk, plus } = setup();
    const t = r.tickets.create({ direction: "andres_asks", title: "Pedido", ownerSession: "lead" }, at(11, 8));
    const s = mk(at(12, 9), "Primera línea\nsegunda", { ticketId: t.id });
    r.salidas.transition(s.id, { type: "deny" }, plus(at(12, 9), 60));
    const detail = vi.spyOn(r.tickets, "detail");
    const page = loadHistory(r, {}, NOW);
    expect(detail).not.toHaveBeenCalled();
    expect(page.next).toBeNull();
    expect(page.rows[0]).toMatchObject({ id: s.id, source: "slack", status: "denied", ticketRef: t.ref, body: "Primera línea\nsegunda", destination: { kind: "slack_thread", channel: "#scout-dev" } });
    expect(page.rows[0]).not.toHaveProperty("history");
    expect(page.rows[0]).not.toHaveProperty("versions");
  });

  it("pages the history newest first by last update, with a stable cursor (ties included)", () => {
    const { r, mk } = setup();
    for (let i = 0; i < 7; i++) {
      const s = mk(at(10, 8, i), `m${i}`);
      // rows 3 and 4 share their last update to the millisecond
      r.salidas.transition(s.id, { type: "deny" }, at(11, 9, i === 4 ? 3 : i));
    }
    const all = r.salidas.history({ day: dayStart(NOW), limit: 100 }).rows;
    expect(all).toHaveLength(7);
    for (let i = 1; i < all.length; i++) expect(all[i - 1]!.updatedAt >= all[i]!.updatedAt).toBe(true);

    const p1 = loadHistory(r, { limit: 3 }, NOW);
    expect(p1.rows).toHaveLength(3);
    expect(p1.next).not.toBeNull();
    const p2 = loadHistory(r, { limit: 3, cursor: p1.next }, NOW);
    expect(p2.rows).toHaveLength(3);
    const p3 = loadHistory(r, { limit: 3, cursor: p2.next }, NOW);
    expect(p3.rows).toHaveLength(1);
    expect(p3.next).toBeNull();
    expect([...p1.rows, ...p2.rows, ...p3.rows].map((x) => x.id)).toEqual(all.map((x) => x.id));
  });

  it("defaults to 50 rows a page", () => {
    const { r, mk } = setup();
    for (let i = 0; i < 52; i++) {
      const s = mk(at(10, 8, i % 60), `m${i}`);
      r.salidas.transition(s.id, { type: "deny" }, at(11, 9, i % 60));
    }
    const p = loadHistory(r, {}, NOW);
    expect(p.rows).toHaveLength(50);
    expect(loadHistory(r, { cursor: p.next }, NOW).rows).toHaveLength(2);
  });

  it("opens a ?s= salida that is not in the strip as focus, never falls back silently", () => {
    const { r, mk, failed } = setup();
    const inStrip = mk(at(16, 9), "today").id;
    const old = failed("old", at(12, 9), at(12, 9, 30));
    expect(loadSalidas(r, NOW, old)).toMatchObject({ focus: { id: old, status: "failed" }, missing: null });
    expect(loadSalidas(r, NOW, old).items.map((s) => s.id)).toEqual([inStrip]);
    expect(loadSalidas(r, NOW, inStrip)).toMatchObject({ focus: null, missing: null });
    expect(loadSalidas(r, NOW, "sa_nope")).toMatchObject({ focus: null, missing: "sa_nope" });
    expect(loadSalidas(r, NOW)).toMatchObject({ focus: null, missing: null });
  });
});

describe("GET /api/salidas/history", () => {
  const g = globalThis as unknown as { __mesaRepos?: ReturnType<typeof createRepos> };

  it("answers a page with its cursor, and /view the card data for a row", async () => {
    const r = createRepos(openDb(":memory:"));
    g.__mesaRepos = r;
    const dest = { kind: "slack_thread", workspace: "Designli", channel: "#scout-dev", channelId: "C0SCOUT01", threadTs: "1730640660.118000", postAs: "Andrés" } as const;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = r.salidas.create({ source: "slack", destination: dest, body: `m${i}` }, new Date(2020, 0, 1, 8, i));
      r.salidas.transition(s.id, { type: "deny" }, new Date(2020, 0, 1, 9, i));
      ids.push(s.id);
    }
    const page = async (qs: string) => (await (await HISTORY(new Request(`http://local/api/salidas/history${qs}`), { params: Promise.resolve({}) })).json()) as { rows: { id: string }[]; next: string | null };
    const p1 = await page("?limit=2");
    expect(p1.rows.map((x) => x.id)).toEqual([ids[2], ids[1]]);
    const p2 = await page(`?limit=2&cursor=${encodeURIComponent(p1.next ?? "")}`);
    expect(p2.rows.map((x) => x.id)).toEqual([ids[0]]);
    expect(p2.next).toBeNull();
    expect((await page("?limit=abc")).rows).toHaveLength(3);

    const res = await VIEW(new Request(`http://local/api/salidas/${ids[0]}/view`), { params: Promise.resolve({ id: ids[0]! }) });
    expect(await res.json()).toMatchObject({ id: ids[0], status: "denied", history: expect.any(Array), versions: expect.any(Array) });
  });
});
