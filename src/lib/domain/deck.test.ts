import { describe, expect, it } from "vitest";
import { deckPrView, deckView, mesaNote, reasonLabel, sameHead, type DeckFacts, type DeckItem } from "./deck";

// polledAt is local time with no offset, read as local like the plugin does; `now` is built the same way so the tests
// do not depend on the machine's time zone.
const NOW = new Date("2026-11-10T11:00:00");

const pr = (num: number, extra: Record<string, unknown> = {}) => ({
  id: `pr:7-Arrow/dre-backend#${num}@fc5f20b`,
  repo: "7-Arrow/dre-backend",
  num,
  title: `PR ${num}`,
  author: "jrodriguez-designli",
  url: `https://github.com/7-Arrow/dre-backend/pull/${num}`,
  head: "fc5f20b",
  requested: true,
  rereview: false,
  ...extra,
});

const STATE = {
  version: 1,
  polledAt: "2026-11-10T10:51:12",
  ok: true,
  counts: { review: 1, postApprovePush: 1, notifications: 1, total: 3, fresh: 1 },
  items: {
    review: [pr(476)],
    postApprovePush: [pr(439, { head: "0a58206", requested: false, approvedHead: "c76651f" })],
    notifications: [
      { id: "nt:1@x", repo: "7-Arrow/dre-frontend", reason: "mention", type: "PullRequest", title: "A note", url: "https://github.com/7-Arrow/dre-frontend/pull/601", updatedAt: "x" },
    ],
  },
};

describe("deckView", () => {
  it("shows the deck's own total, fresh when the poll is recent", () => {
    const v = deckView(STATE, NOW);
    expect(v).toMatchObject({ state: "fresh", total: 3, polledAt: "2026-11-10T10:51:12", age: "hace 8 min" });
    expect(v.items.map((i) => [i.key, i.reason])).toEqual([
      ["7-Arrow/dre-backend#476", "review_requested"],
      ["7-Arrow/dre-backend#439", "post_approve_push"],
      ["7-Arrow/dre-frontend#601", "notification"],
    ]);
  });

  it("is stale after 15 min, exactly like the deck", () => {
    expect(deckView({ ...STATE, polledAt: "2026-11-10T10:45:00" }, NOW).state).toBe("fresh");
    expect(deckView({ ...STATE, polledAt: "2026-11-10T10:44:59" }, NOW)).toMatchObject({ state: "stale", total: 3 });
  });

  it("a failed poll or an unreadable polledAt is stale, and a failed poll keeps no number it never had", () => {
    expect(deckView({ ...STATE, ok: false }, NOW).state).toBe("stale");
    expect(deckView({ ...STATE, polledAt: "nope" }, NOW)).toMatchObject({ state: "stale", age: "" });
    expect(deckView({ version: 1, polledAt: "2026-11-10T10:59:00", ok: false, error: "gh failed" }, NOW).state).toBe("none");
  });

  it("a missing, invalid or odd file is sin dato, never an error", () => {
    for (const raw of [null, undefined, "x", 3, [], {}, { counts: {} }, { counts: { total: "2" } }, { counts: { total: Number.NaN } }]) {
      expect(deckView(raw, NOW)).toMatchObject({ state: "none", total: null, items: [] });
    }
  });

  it("tolerates unknown and missing fields in items and drops what it cannot read", () => {
    const v = deckView(
      { counts: { total: 2 }, polledAt: "2026-11-10T10:59:00", items: { review: [null, 7, { title: "no repo" }, { repo: "a/b", url: "https://github.com/a/b/pull/9", future: true }], other: [] } },
      NOW,
    );
    expect(v.total).toBe(2);
    expect(v.items).toHaveLength(1);
    expect(v.items[0]).toMatchObject({ key: "a/b#9", num: 9, title: "(sin título)", author: "", head: "", reason: "review_requested" });
  });

  it("lists a PR once when the deck also has a notification about it", () => {
    const v = deckView(
      { ...STATE, items: { ...STATE.items, notifications: [{ repo: "7-Arrow/dre-backend", reason: "comment", type: "PullRequest", title: "t", url: "https://github.com/7-Arrow/dre-backend/pull/476" }] } },
      NOW,
    );
    expect(v.items.map((i) => i.key)).toEqual(["7-Arrow/dre-backend#476", "7-Arrow/dre-backend#439"]);
  });

  it("maps the deck's reasons: push onto open findings, and a notification that is not a PR", () => {
    const v = deckView(
      {
        ...STATE,
        items: {
          review: [pr(5, { rereview: true })],
          postApprovePush: [],
          notifications: [{ id: "nt:2", repo: "a/b", reason: "assign", type: "Issue", title: "An issue", url: "https://github.com/a/b/issues/3" }],
        },
      },
      NOW,
    );
    expect(v.items[0]!.reason).toBe("open_findings");
    expect(v.items[1]).toMatchObject({ num: null, reason: "notification", notificationReason: "assign", type: "Issue" });
  });
});

describe("reasonLabel", () => {
  it("says the deck's reason in Spanish", () => {
    const l = (reason: DeckItem["reason"], notificationReason = "") => reasonLabel({ reason, notificationReason });
    expect(l("review_requested")).toBe("te pidieron review y el monitor no vio este head");
    expect(l("post_approve_push")).toBe("un push tumbó tu approve");
    expect(l("open_findings")).toBe("push sobre findings abiertos");
    expect(l("notification", "mention")).toBe("notificación de GitHub: te mencionaron");
    expect(l("notification", "odd")).toBe("notificación de GitHub: odd");
    expect(l("unknown")).toBe("el deck no dice por qué");
  });
});

describe("sameHead", () => {
  it("matches by prefix, needs 7 chars, never an empty head", () => {
    expect(sameHead("0a58206", "0a582069d1b0c4e6f8a1b2c3d4e5f60718293a4b")).toBe(true);
    expect(sameHead("0a58206", "fc5f20b9d1b0c4e6f8a1b2c3d4e5f60718293a4b")).toBe(false);
    expect(sameHead("0a5820", "0a5820")).toBe(false);
    expect(sameHead("", "0a58206")).toBe(false);
    expect(sameHead(null, undefined)).toBe(false);
  });
});

const HEAD = "0a58206d1b0c4e6f8a1b2c3d4e5f60718293a4b5";
const item = (over: Partial<DeckItem> = {}): DeckItem => ({
  key: "7-Arrow/dre-backend#439",
  repo: "7-Arrow/dre-backend",
  num: 439,
  title: "feat(labs): backfill",
  author: "7AIDEV",
  url: "https://github.com/7-Arrow/dre-backend/pull/439",
  head: "0a58206",
  reason: "post_approve_push",
  notificationReason: "",
  type: "",
  ...over,
});
const facts = (over: Partial<DeckFacts> = {}, gh: Partial<Extract<DeckFacts["github"], { status: "ok" }>> = {}): DeckFacts => ({
  login: "acorrea-designli",
  ignored: false,
  skipped: false,
  github: { status: "ok", head: HEAD, draft: false, author: "7AIDEV", releaseTrain: false, myReview: null, myReviewHead: null, ...gh },
  mesa: { hasItem: false, ticketRef: null, reviewHead: "", openFindings: 0 },
  ...over,
});

describe("deckPrView: the verdict, by Mesa's own rules", () => {
  it("nos interesa when no rule discards it, with the deck's reason", () => {
    const v = deckPrView(item({ reason: "review_requested" }), facts());
    expect(v).toMatchObject({ verdict: "interesa", disagree: null, reason: "te pidieron review y el monitor no vio este head", mesa: "Mesa aún no la tiene" });
    expect(v.why).toBe("no has aprobado 0a58206");
  });

  it("nos interesa when his last review at the head is not an approve, or he approved an older head", () => {
    expect(deckPrView(item(), facts({}, { myReview: "CHANGES_REQUESTED", myReviewHead: HEAD })).verdict).toBe("interesa");
    expect(deckPrView(item(), facts({}, { myReview: "APPROVED", myReviewHead: "c76651f9d1b0c4e6f8a1b2c3d4e5f60718293a4b" })).verdict).toBe("interesa");
  });

  it("no nos interesa when he approved the current head, and says the deck reads an old pr-monitor state (today's #439)", () => {
    const v = deckPrView(item(), facts({}, { myReview: "APPROVED", myReviewHead: HEAD }));
    expect(v.verdict).toBe("no_interesa");
    expect(v.why).toBe("ya aprobaste 0a58206 en GitHub");
    expect(v.disagree).toBe("ya aprobaste este head en GitHub; el deck lee un estado viejo del pr-monitor");
  });

  it("no nos interesa for a draft, an own PR, a release-train PR", () => {
    expect(deckPrView(item(), facts({}, { draft: true }))).toMatchObject({ verdict: "no_interesa", why: "es un borrador" });
    expect(deckPrView(item({ author: "acorrea-designli" }), facts())).toMatchObject({ verdict: "no_interesa", why: "es una PR tuya" });
    expect(deckPrView(item({ author: "" }), facts({}, { author: "ACorrea-Designli" }))).toMatchObject({ verdict: "no_interesa", why: "es una PR tuya" });
    expect(deckPrView(item(), facts({}, { releaseTrain: true }))).toMatchObject({ verdict: "no_interesa", why: "es una PR de release train" });
  });

  it("no nos interesa for an ignored project or a skipped item, without needing GitHub", () => {
    const off = { status: "none", why: "off" } as const;
    expect(deckPrView(item(), facts({ ignored: true, github: off }))).toMatchObject({ verdict: "no_interesa", why: "el proyecto está ignorado en Mesa" });
    const v = deckPrView(item(), facts({ skipped: true, github: off }));
    expect(v).toMatchObject({ verdict: "no_interesa", why: "la saltaste en Mesa" });
    expect(v.disagree).toBe("el deck la cuenta, pero la saltaste en Mesa");
  });

  it("every no is a disagreement with the deck, and a yes never is", () => {
    for (const f of [facts({ ignored: true }), facts({ skipped: true }), facts({}, { draft: true }), facts({}, { releaseTrain: true }), facts({}, { myReview: "APPROVED", myReviewHead: HEAD })]) {
      const v = deckPrView(item(), f);
      expect(v.verdict).toBe("no_interesa");
      expect(v.disagree).toMatch(/^(el deck la cuenta, pero|ya aprobaste este head)/);
    }
    expect(deckPrView(item(), facts()).disagree).toBeNull();
  });

  it("sin dato when GitHub could not be read, never a guess; Mesa-only rules still apply first", () => {
    const limited = { status: "none", why: "rate_limit" } as const;
    expect(deckPrView(item(), facts({ github: limited }))).toMatchObject({ verdict: "sin_dato", disagree: null, why: "GitHub devolvió límite de uso; no se pudo leer la PR" });
    expect(deckPrView(item(), facts({ github: { status: "none", why: "error" } })).why).toBe("no se pudo leer la PR en GitHub");
    expect(deckPrView(item(), facts({ github: { status: "none", why: "off" } })).why).toMatch(/apagado/);
    // His own PR is known from the deck's author without reading anything.
    expect(deckPrView(item({ author: "acorrea-designli" }), facts({ github: limited })).verdict).toBe("no_interesa");
  });

  it("a notification that is not a PR gets sin dato (Mesa has no rule for it); an ignored repo still hides it", () => {
    const n = item({ key: "a/b:note", repo: "a/b", num: null, reason: "notification", notificationReason: "assign", type: "Issue" });
    expect(deckPrView(n, facts({ github: null }))).toMatchObject({ verdict: "sin_dato", mesa: null });
    expect(deckPrView(n, facts({ github: null, ignored: true })).verdict).toBe("no_interesa");
  });

  it("adds what Mesa already has: ticket, whether the reviewer saw the current head, open findings (today's #476)", () => {
    const m = { hasItem: true, ticketRef: "t88", reviewHead: "fc5f20b9d1b0c4e6f8a1b2c3d4e5f60718293a4b", openFindings: 1 };
    const v = deckPrView(item({ key: "x#476", num: 476, reason: "review_requested", head: "fc5f20b" }), facts({ mesa: m }, { head: m.reviewHead }));
    expect(v.verdict).toBe("interesa");
    expect(v.mesa).toBe("Mesa ya la tiene: ticket t88, el reviewer vio fc5f20b (el actual), 1 hallazgo abierto");
  });
});

describe("mesaNote", () => {
  it("covers no item, an item without review, a review on an older head, and findings counts", () => {
    expect(mesaNote({ hasItem: false, ticketRef: null, reviewHead: "", openFindings: 0 }, HEAD)).toBeNull();
    expect(mesaNote({ hasItem: true, ticketRef: null, reviewHead: "", openFindings: 0 }, HEAD)).toBe("Mesa ya la tiene en Hoy; aún sin review");
    expect(mesaNote({ hasItem: false, ticketRef: "t9", reviewHead: "c76651f", openFindings: 0 }, HEAD)).toBe(
      "Mesa ya la tiene: ticket t9, el reviewer vio c76651f (no el actual), sin hallazgos abiertos",
    );
    expect(mesaNote({ hasItem: true, ticketRef: "t9", reviewHead: "", openFindings: 3 }, HEAD)).toBe("Mesa ya la tiene: ticket t9, el reviewer aún no fija un head, 3 hallazgos abiertos");
  });
});
