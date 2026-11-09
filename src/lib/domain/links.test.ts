import { describe, expect, it } from "vitest";
import { classify, linkKey, middleTruncate, normalizeUrl, prIdentity, resourceKey, tokenize, trimUrl, urlsIn } from "./links";

const links = (text: string) => tokenize(text).flatMap((s) => (s.t === "link" ? [s.link.href] : []));
const rebuild = (text: string, tickets: string[] = []) => tokenize(text, tickets).map((s) => s.v).join("");

describe("tokenize: addresses", () => {
  it("links an https address and keeps the text around it, line breaks included", () => {
    const text = "Mira esto:\nhttps://github.com/o/r/pull/12\nGracias";
    const segs = tokenize(text);
    expect(segs.map((s) => s.t)).toEqual(["text", "link", "text"]);
    expect(rebuild(text)).toBe(text);
  });

  it("leaves trailing sentence punctuation out of the link", () => {
    for (const end of [".", ",", ";", ":", "!", "?", "...", '."', ")."]) {
      const text = `ver https://example.com/a/b${end}`;
      const segs = tokenize(text);
      const l = segs.find((s) => s.t === "link");
      expect(l?.v, end).toBe("https://example.com/a/b");
      expect(rebuild(text)).toBe(text);
    }
  });

  it("keeps a balanced ')' and drops an unbalanced one", () => {
    expect(links("https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar)"]);
    expect(links("(ver https://example.com/x)")).toEqual(["https://example.com/x"]);
    expect(links("(https://example.com/x), luego")).toEqual(["https://example.com/x"]);
    expect(trimUrl("https://a.co/b)]")).toBe("https://a.co/b");
  });

  it("never links a non-http scheme", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "vbscript:x", "ftp://example.com/a", "//example.com/a", "mailto:a@b.co"]) {
      expect(links(bad), bad).toEqual([]);
      expect(rebuild(bad)).toBe(bad);
    }
    // a known host hidden behind a scheme-looking prefix is not a bare address
    expect(links("javascript://github.com/o/r")).toEqual([]);
  });

  it("links the bare github, slack and basecamp hosts as https", () => {
    expect(links("t46: github.com/7-Arrow/dre-backend/pull/474 y mas")).toEqual(["https://github.com/7-Arrow/dre-backend/pull/474"]);
    expect(links("designli.slack.com/archives/C1/p123")).toEqual(["https://designli.slack.com/archives/C1/p123"]);
    expect(links("3.basecamp.com/123/buckets/4/messages/5")).toEqual(["https://3.basecamp.com/123/buckets/4/messages/5"]);
  });

  it("does not link look-alike hosts or other bare domains", () => {
    expect(links("evilgithub.com/o/r")).toEqual([]);
    expect(links("example.com/a")).toEqual([]);
    expect(links("user@github.com/x")).toEqual([]);
    expect(links("notgithub.com.evil.io/x")).toEqual([]);
    expect(links("https://")).toEqual([]);
  });

  it("is not fooled by a credentials trick: the host decides what it is", () => {
    const l = classify("https://github.com@evil.example/o/r/pull/1");
    expect(l?.kind).toBe("other");
    expect(l?.label).toBeNull();
  });

  it("stops at whitespace, angle brackets and the Slack pipe", () => {
    expect(links("<https://example.com/a|label>")).toEqual(["https://example.com/a"]);
    expect(links("a https://example.com/a b")).toEqual(["https://example.com/a"]);
  });

  it("urlsIn lists each address once", () => {
    expect(urlsIn("https://a.co/x y https://a.co/x z github.com/o/r/pull/1")).toEqual(["https://a.co/x", "https://github.com/o/r/pull/1"]);
  });
});

describe("tokenize: ticket refs", () => {
  const known = ["t49", "t5"];
  it("links @t49 and a word-bounded t49 only when the ticket exists", () => {
    const segs = tokenize("ver @t49, t49 y @t50 o t51", known);
    expect(segs.filter((s) => s.t === "ticket").map((s) => [s.v, s.t === "ticket" ? s.ref : ""])).toEqual([
      ["@t49", "t49"],
      ["t49", "t49"],
    ]);
    expect(rebuild("ver @t49, t49 y @t50 o t51", known)).toBe("ver @t49, t49 y @t50 o t51");
  });

  it("does not link inside a word, a branch name or a path", () => {
    for (const s of ["feat/t49-plan", "dev-t49", "t49x", "at49", "a.t49", "t490", "x@t49"]) {
      expect(tokenize(s, known).some((x) => x.t === "ticket"), s).toBe(false);
    }
  });

  it("a ticket ref inside an address stays part of the address", () => {
    const segs = tokenize("https://example.com/tickets?t=t49", known);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.t).toBe("link");
  });

  it("finds nothing when no ticket is known", () => {
    expect(tokenize("t49 @t49").every((s) => s.t === "text")).toBe(true);
  });
});

describe("classify and labels", () => {
  it("a GitHub PR or issue is repo#N", () => {
    expect(classify("https://github.com/7-Arrow/dre-backend/pull/474")).toMatchObject({ kind: "pr", source: "github", label: "dre-backend#474" });
    expect(classify("https://github.com/o/mesa/issues/7")).toMatchObject({ kind: "issue", label: "mesa#7" });
    expect(classify("https://github.com/o/mesa/pull/7/files")).toMatchObject({ kind: "pr", label: "mesa#7" });
  });
  it("an actions run is CI · repo", () => {
    expect(classify("https://github.com/o/mesa/actions/runs/123456")).toMatchObject({ kind: "run", label: "CI · mesa", n: 123456 });
  });
  it("Slack and Basecamp carry their source and short label", () => {
    expect(classify("https://designli.slack.com/archives/C1/p1")).toMatchObject({ kind: "slack", source: "slack", label: "Slack" });
    expect(classify("https://3.basecamp.com/1/buckets/2/todos/3")).toMatchObject({ kind: "basecamp", source: "basecamp", label: "Basecamp" });
  });
  it("other GitHub pages keep the source colour but no label; other hosts have neither", () => {
    expect(classify("https://github.com/o/mesa")).toMatchObject({ kind: "github", source: "github", label: null });
    expect(classify("https://github.com/o/mesa/commit/abc")).toMatchObject({ kind: "github", label: null });
    expect(classify("https://example.com/x")).toMatchObject({ kind: "other", label: null });
    expect(classify("https://example.com/x")?.source).toBeUndefined();
  });
  it("rejects what is not an http(s) address", () => {
    expect(classify("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("example.com/a")).toBeNull();
    expect(normalizeUrl("github.com/o/r")).toBe("https://github.com/o/r");
  });
});

describe("PR identity", () => {
  const id = "7-arrow/dre-backend#474";
  it("is the same for every URL form", () => {
    for (const u of [
      "https://github.com/7-Arrow/dre-backend/pull/474",
      "https://github.com/7-Arrow/dre-backend/pull/474/files",
      "https://github.com/7-Arrow/dre-backend/pull/474/checks",
      "http://www.github.com/7-arrow/dre-backend/pull/474#issuecomment-1",
      "github.com/7-Arrow/dre-backend/pull/474",
    ]) {
      expect(prIdentity(u), u).toBe(id);
      expect(resourceKey(u), u).toBe(`pr:${id}`);
    }
  });
  it("is null for what is not a PR", () => {
    expect(prIdentity("https://github.com/o/r/issues/4")).toBeNull();
    expect(prIdentity("https://github.com/o/r")).toBeNull();
    expect(prIdentity("https://example.com/o/r/pull/4")).toBeNull();
  });
});

describe("resourceKey", () => {
  it("a Slack thread is host + path (+ thread_ts); a Basecamp page ignores the fragment", () => {
    expect(resourceKey("https://d.slack.com/archives/C1/p1?cid=C1")).toBe("slack:d.slack.com/archives/c1/p1");
    expect(resourceKey("https://d.slack.com/archives/C1/p2?thread_ts=11.2&cid=C1")).toBe("slack:d.slack.com/archives/c1/p2?thread_ts=11.2");
    expect(resourceKey("https://3.basecamp.com/1/buckets/2/messages/3#__recording_9")).toBe(resourceKey("https://3.basecamp.com/1/buckets/2/messages/3/"));
  });
  it("linkKey falls back to the plain address", () => {
    expect(linkKey("https://example.com/a/#x")).toBe("https://example.com/a");
    expect(linkKey("nope")).toBeNull();
  });
});

describe("middleTruncate", () => {
  it("keeps both ends of a long address", () => {
    const u = "https://example.com/a/very/long/path/that/keeps/going/and/going/file.html";
    const t = middleTruncate(u, 30);
    expect(t).toHaveLength(30);
    expect(t.startsWith("https://")).toBe(true);
    expect(t.endsWith("file.html")).toBe(true);
    expect(t).toContain("…");
  });
  it("leaves a short one alone", () => {
    expect(middleTruncate("https://a.co/x", 30)).toBe("https://a.co/x");
  });
});
