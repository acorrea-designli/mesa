import { describe, expect, it } from "vitest";
import { related, MAX_MENTIONS, type RelItem, type RelTicket } from "./related";

const PR474 = "https://github.com/7-Arrow/dre-backend/pull/474";
const SLACK = "https://designli.slack.com/archives/C1/p1699";

const item = (id: string, o: Partial<RelItem> = {}): RelItem => ({ id, source: "slack", title: `item ${id}`, excerpt: "", url: null, taskId: null, meta: {}, ...o });
const tk = (ref: string, o: Partial<RelTicket> = {}): RelTicket => ({ id: `id-${ref}`, ref, title: `title ${ref}`, itemId: null, texts: [], refUrls: [], reviews: [], ...o });
const base = (o: Partial<Parameters<typeof related>[0]> = {}) => ({
  ticket: { ...tk("t44"), taskId: null as string | null },
  item: null,
  items: [],
  tickets: [],
  shown: { urls: [], tickets: [] },
  ...o,
});

describe("related: the PR and its CI", () => {
  it("a review gives the PR and its checks page, labelled repo#N and CI", () => {
    const r = related(base({ ticket: { ...tk("t44", { reviews: [{ repo: "7-Arrow/dre-backend", pr: 474 }] }), taskId: null } }));
    expect(r.map((x) => [x.label, x.href, x.why])).toEqual([
      ["dre-backend#474", PR474, "pr"],
      ["CI", `${PR474}/checks`, "ci"],
    ]);
    expect(r.every((x) => !x.internal && x.source === "github")).toBe(true);
  });

  it("a PR item gives the same from meta.repo/pr, once even with a review of the same PR", () => {
    const it = item("i1", { source: "github", url: PR474, meta: { repo: "7-Arrow/dre-backend", pr: 474 } });
    const r = related(base({ ticket: { ...tk("t44", { reviews: [{ repo: "7-arrow/dre-backend", pr: 474 }] }), taskId: null }, item: it }));
    expect(r.filter((x) => x.why === "pr")).toHaveLength(1);
    expect(r.filter((x) => x.why === "ci")).toHaveLength(1);
  });

  it("is deduped against Fuente: the PR url shown there is not repeated, its checks page still is", () => {
    const it = item("i1", { source: "github", url: PR474 + "/files", meta: { repo: "7-Arrow/dre-backend", pr: 474 } });
    const r = related(base({ item: it, shown: { urls: [PR474 + "/files"], tickets: [] } }));
    expect(r.map((x) => x.label)).toEqual(["CI"]);
  });
});

describe("related: the board card", () => {
  it("lists the other items on the card, not the ticket's own item or items without an address", () => {
    const own = item("own", { url: SLACK, taskId: "task1" });
    const bc = item("bc", { source: "basecamp", url: "https://3.basecamp.com/1/buckets/2/todos/3", taskId: "task1", title: "Todo" });
    const noUrl = item("nu", { taskId: "task1" });
    const other = item("ot", { url: "https://3.basecamp.com/1/buckets/9/todos/9", taskId: "task2" });
    const r = related(base({ ticket: { ...tk("t44", { itemId: "own" }), taskId: "task1" }, item: own, items: [own, bc, noUrl, other], shown: { urls: [SLACK], tickets: [] } }));
    expect(r).toMatchObject([{ label: "Todo", why: "card", source: "basecamp" }]);
  });
});

describe("related: mentions", () => {
  const prTicket = () => base({ ticket: { ...tk("t44", { reviews: [{ repo: "7-Arrow/dre-backend", pr: 474 }] }), taskId: null } });

  it("t46 (Slack) <-> t44 (PR 474): each lists the other", () => {
    const t46 = tk("t46", { texts: ["Revisar github.com/7-Arrow/dre-backend/pull/474 hoy"] });
    const a = related({ ...prTicket(), tickets: [t46] });
    expect(a.find((x) => x.why === "mention")).toMatchObject({ href: "/tickets?t=t46", internal: true, label: "@t46", detail: "title t46" });

    const t44 = tk("t44", { reviews: [{ repo: "7-Arrow/dre-backend", pr: 474 }] });
    const b = related(base({ ticket: { ...t46, taskId: null }, tickets: [t44] }));
    expect(b.find((x) => x.why === "mention")).toMatchObject({ href: "/tickets?t=t44", internal: true });
  });

  it("matches any URL form of the PR, including /files and a bare host", () => {
    for (const text of [`${PR474}/files`, "github.com/7-arrow/dre-backend/pull/474", `(${PR474}).`]) {
      const r = related({ ...prTicket(), tickets: [tk("t46", { texts: [text] })] });
      expect(r.some((x) => x.label === "@t46"), text).toBe(true);
    }
    const none = related({ ...prTicket(), tickets: [tk("t46", { texts: ["https://github.com/7-Arrow/dre-backend/pull/475"] })] });
    expect(none.some((x) => x.label === "@t46")).toBe(false);
  });

  it("an item that mentions the PR in its excerpt or meta is listed", () => {
    const slack = item("s1", { url: SLACK, excerpt: `mira ${PR474}`, title: "Slack: revisar" });
    const byMeta = item("g1", { source: "github", url: "https://github.com/7-Arrow/dre-backend/pull/474/files", meta: { repo: "7-Arrow/dre-backend", pr: 474 } });
    const r = related({ ...prTicket(), items: [slack, byMeta] });
    expect(r.filter((x) => x.why === "mention").map((x) => x.label)).toEqual(["Slack: revisar"]);
    // the PR-meta item is the PR itself: already listed as the PR, not repeated
    expect(r.filter((x) => x.href.includes("/pull/474"))).toHaveLength(2); // PR + checks
  });

  it("matches the same Slack or Basecamp address in another ticket's refs or messages", () => {
    const own = tk("t46", { texts: [`hilo ${SLACK}?cid=C1`] });
    const viaRef = tk("t50", { refUrls: [SLACK] });
    const viaText = tk("t51", { texts: [`también ${SLACK}.`] });
    const unrelated = tk("t52", { texts: ["https://designli.slack.com/archives/C1/p0000"] });
    const r = related(base({ ticket: { ...own, taskId: null }, tickets: [viaRef, viaText, unrelated] }));
    expect(r.map((x) => x.label)).toEqual(["@t50", "@t51"]);
  });

  it("a ticket that reaches the PR through its item is related too", () => {
    const prItem = item("i9", { source: "github", url: PR474, meta: { repo: "7-Arrow/dre-backend", pr: 474 } });
    const other = tk("t60", { itemId: "i9" });
    const r = related({ ...prTicket(), items: [prItem], tickets: [other] });
    expect(r.some((x) => x.label === "@t60")).toBe(true);
  });

  it("does not list the ticket itself, a ticket already in Fuente, or the same thing twice", () => {
    const r = related({
      ...prTicket(),
      tickets: [tk("t44", { texts: [PR474] }), tk("t46", { texts: [PR474] }), tk("t47", { texts: [PR474] })],
      shown: { urls: [], tickets: ["t46"] },
    });
    expect(r.filter((x) => x.why === "mention").map((x) => x.label)).toEqual(["@t47"]);
  });

  it("nothing in common means no mentions; a ticket without keys matches nothing", () => {
    expect(related(base({ tickets: [tk("t46", { texts: [PR474] })] }))).toEqual([]);
  });

  it("is bounded", () => {
    const many = Array.from({ length: 30 }, (_, i) => tk(`t${100 + i}`, { texts: [PR474] }));
    const r = related({ ...prTicket(), tickets: many });
    expect(r.filter((x) => x.why === "mention")).toHaveLength(MAX_MENTIONS);
  });
});

describe("related: CI runs in the messages", () => {
  it("lists actions/runs addresses found in messages, once, labelled CI · repo", () => {
    const run = "https://github.com/o/mesa/actions/runs/998877";
    const r = related(base({ ticket: { ...tk("t44", { texts: [`falló ${run}.`, `otra vez ${run}/job/1`, run] }), taskId: null } }));
    expect(r.map((x) => [x.label, x.why])).toEqual([["CI · mesa", "run"]]); // the /job/1 form is the same run
  });
  it("empty when there is nothing", () => {
    expect(related(base())).toEqual([]);
  });
});
