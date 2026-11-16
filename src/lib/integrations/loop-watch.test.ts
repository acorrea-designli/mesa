import { describe, expect, it } from "vitest";
import { STALL_LOG_MS, stallLine } from "./loop-watch";

describe("stallLine", () => {
  it("stays quiet below the threshold", () => {
    expect(stallLine("loop", STALL_LOG_MS - 1)).toBeNull();
  });
  it("names the kind of stall and the gh children", () => {
    expect(stallLine("loop", 4_200)).toBe("[mesa] event loop blocked for 4.2s; gh children: none");
    expect(stallLine("pool", 3_000)).toContain("libuv pool slow");
  });
});
