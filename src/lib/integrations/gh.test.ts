import { describe, expect, it } from "vitest";
import { classify, parseHttp } from "./gh";

describe("parseHttp", () => {
  it("splits status, lower-cased headers and body (CRLF)", () => {
    const r = parseHttp("HTTP/2.0 200 OK\r\nX-Poll-Interval: 60\r\nLast-Modified: Tue, 03 Nov 2026 22:50:34 GMT\r\n\r\n[1,2]");
    expect(r).toEqual({ status: 200, headers: { "x-poll-interval": "60", "last-modified": "Tue, 03 Nov 2026 22:50:34 GMT" }, body: "[1,2]" });
  });
  it("handles a 304 with no body", () => {
    expect(parseHttp("HTTP/2.0 304 Not Modified\nX-Poll-Interval: 120\n")?.status).toBe(304);
  });
  it("returns null without a status line", () => {
    expect(parseHttp("gh: not logged in")).toBeNull();
  });
});

describe("classify", () => {
  it("recognises rate limits, scopes, auth and a missing gh", () => {
    expect(classify({ code: 1, stdout: "", stderr: "API rate limit exceeded" }).kind).toBe("rate_limit");
    expect(classify({ code: 1, stdout: "", stderr: "" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000" }).resetAt).toBe(
      new Date(1_800_000_000_000).toISOString(),
    );
    expect(classify({ code: 1, stdout: "", stderr: "your token has not been granted the required scopes: INSUFFICIENT_SCOPES" }).kind).toBe("scope");
    expect(classify({ code: 4, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login" }).kind).toBe("auth");
    expect(classify({ code: 127, stdout: "", stderr: "" }).kind).toBe("missing");
  });
});
