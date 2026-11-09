import { describe, expect, it } from "vitest";
import { clearReply, clearRequest, DRAFTS_KEY, loadReply, loadRequest, MAX_AGE_MS, parseDrafts, saveReply, saveRequest, type DraftStore } from "./drafts";

const memory = (seed?: string): DraftStore & { data: Map<string, string> } => {
  const data = new Map<string, string>(seed ? [[DRAFTS_KEY, seed]] : []);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};
const NOW = Date.UTC(2026, 10, 9, 16, 0, 0);
const ref = { target: "t12", label: "Otro ticket" };

describe("reply drafts", () => {
  it("restores the text and @refs of a ticket", () => {
    const s = memory();
    saveReply("tk_a", { text: "voy escribiendo", refs: [ref] }, s, NOW);
    expect(loadReply("tk_a", s, NOW + 1000)).toEqual({ text: "voy escribiendo", refs: [ref] });
  });

  it("keeps one draft per ticket", () => {
    const s = memory();
    saveReply("tk_a", { text: "uno", refs: [] }, s, NOW);
    saveReply("tk_b", { text: "dos", refs: [] }, s, NOW);
    expect(loadReply("tk_a", s, NOW)?.text).toBe("uno");
    expect(loadReply("tk_b", s, NOW)?.text).toBe("dos");
    expect(loadReply("tk_c", s, NOW)).toBeNull();
  });

  it("an empty draft removes the entry and the key", () => {
    const s = memory();
    saveReply("tk_a", { text: "algo", refs: [] }, s, NOW);
    saveReply("tk_a", { text: "", refs: [] }, s, NOW);
    expect(loadReply("tk_a", s, NOW)).toBeNull();
    expect(s.data.has(DRAFTS_KEY)).toBe(false);
  });

  it("clearReply drops only that ticket", () => {
    const s = memory();
    saveReply("tk_a", { text: "uno", refs: [] }, s, NOW);
    saveReply("tk_b", { text: "dos", refs: [] }, s, NOW);
    clearReply("tk_a", s, NOW);
    expect(loadReply("tk_a", s, NOW)).toBeNull();
    expect(loadReply("tk_b", s, NOW)?.text).toBe("dos");
  });

  it("a draft with only @refs is kept", () => {
    const s = memory();
    saveReply("tk_a", { text: "", refs: [ref] }, s, NOW);
    expect(loadReply("tk_a", s, NOW)).toEqual({ text: "", refs: [ref] });
  });
});

describe("new request draft", () => {
  const full = { text: "pídele a Claude", refs: [ref], link: "https://github.com/x/y/pull/1", project: "mesa" };

  it("restores text, refs, link and project", () => {
    const s = memory();
    saveRequest(full, s, NOW);
    expect(loadRequest(s, NOW)).toEqual(full);
  });

  it("a form with only a link still counts as a draft; a blank one removes it", () => {
    const s = memory();
    saveRequest({ text: "", refs: [], link: "https://x", project: "" }, s, NOW);
    expect(loadRequest(s, NOW)?.link).toBe("https://x");
    clearRequest(s, NOW);
    expect(loadRequest(s, NOW)).toBeNull();
    expect(s.data.has(DRAFTS_KEY)).toBe(false);
  });

  it("is independent of the replies", () => {
    const s = memory();
    saveRequest(full, s, NOW);
    saveReply("tk_a", { text: "uno", refs: [] }, s, NOW);
    clearRequest(s, NOW);
    expect(loadReply("tk_a", s, NOW)?.text).toBe("uno");
    clearReply("tk_a", s, NOW);
    saveRequest(full, s, NOW);
    expect(loadRequest(s, NOW)).toEqual(full);
  });
});

describe("pruning and bad data", () => {
  it("drops drafts older than 14 days and keeps the recent ones", () => {
    const s = memory();
    saveReply("tk_old", { text: "viejo", refs: [] }, s, NOW - MAX_AGE_MS - 1);
    saveReply("tk_new", { text: "nuevo", refs: [] }, s, NOW - MAX_AGE_MS + 60_000);
    expect(loadReply("tk_old", s, NOW)).toBeNull();
    expect(loadReply("tk_new", s, NOW)?.text).toBe("nuevo");
  });

  it("an old draft is gone from storage after the next write", () => {
    const s = memory();
    saveReply("tk_old", { text: "viejo", refs: [] }, s, NOW - MAX_AGE_MS - 1);
    saveReply("tk_new", { text: "nuevo", refs: [] }, s, NOW);
    expect(Object.keys(JSON.parse(s.data.get(DRAFTS_KEY)!).replies)).toEqual(["tk_new"]);
  });

  it("an old request is dropped too", () => {
    const s = memory();
    saveRequest({ text: "viejo", refs: [], link: "", project: "" }, s, NOW - MAX_AGE_MS - 1);
    expect(loadRequest(s, NOW)).toBeNull();
  });

  it("ignores garbage without throwing", () => {
    for (const raw of ["", "{", "null", "[]", '{"replies":5}', '{"replies":{"a":{"d":{"text":1},"at":1}}}', '{"replies":{"a":{"d":{"text":"x","refs":[{"target":1}]},"at":' + NOW + "}}}"]) {
      expect(parseDrafts(raw, NOW)).toEqual({ replies: {} });
    }
  });

  it("ignores a draft stamped in the far future", () => {
    const raw = JSON.stringify({ replies: { a: { d: { text: "x", refs: [] }, at: NOW + 30 * 86_400_000 } } });
    expect(parseDrafts(raw, NOW).replies).toEqual({});
  });

  it("keeps at most 50 reply drafts, the most recent", () => {
    const s = memory();
    for (let i = 0; i < 55; i++) saveReply(`tk_${i}`, { text: `t${i}`, refs: [] }, s, NOW + i);
    const ids = Object.keys(JSON.parse(s.data.get(DRAFTS_KEY)!).replies);
    expect(ids).toHaveLength(50);
    expect(ids).not.toContain("tk_0");
    expect(ids).toContain("tk_54");
  });

  it("stores only the draft: text, refs, link, project and a timestamp", () => {
    const s = memory();
    saveReply("tk_a", { text: "hola", refs: [ref] }, s, NOW);
    saveRequest({ text: "pedido", refs: [], link: "l", project: "p" }, s, NOW);
    expect(JSON.parse(s.data.get(DRAFTS_KEY)!)).toEqual({
      v: 1,
      replies: { tk_a: { d: { text: "hola", refs: [ref] }, at: NOW } },
      request: { d: { text: "pedido", refs: [], link: "l", project: "p" }, at: NOW },
    });
  });
});

describe("a storage that fails", () => {
  const broken: DraftStore = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };

  it("never throws and just has no draft", () => {
    expect(() => saveReply("tk_a", { text: "x", refs: [] }, broken, NOW)).not.toThrow();
    expect(() => clearReply("tk_a", broken, NOW)).not.toThrow();
    expect(() => saveRequest({ text: "x", refs: [], link: "", project: "" }, broken, NOW)).not.toThrow();
    expect(loadReply("tk_a", broken, NOW)).toBeNull();
    expect(loadRequest(broken, NOW)).toBeNull();
  });

  it("works without any storage (null)", () => {
    expect(() => saveReply("tk_a", { text: "x", refs: [] }, null, NOW)).not.toThrow();
    expect(loadReply("tk_a", null, NOW)).toBeNull();
  });
});
