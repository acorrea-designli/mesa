import { describe, expect, it } from "vitest";
import { LINK_LABEL, isLoopbackHost, linkState, pingReachable } from "./tunnel";

describe("phone link state", () => {
  it("is local on loopback hosts, whatever the ping says", () => {
    for (const h of ["localhost", "127.0.0.1", "[::1]", ""]) {
      expect(linkState(h, true)).toBe("local");
      expect(linkState(h, false)).toBe("local");
    }
    expect(isLoopbackHost("pc.tail1234.ts.net")).toBe(false);
  });
  it("is 'vía túnel' on a tailnet host when the PC answers and 'sin túnel' when it does not", () => {
    expect(linkState("pc.tail1234.ts.net", true)).toBe("tunnel");
    expect(linkState("pc.tail1234.ts.net", false)).toBe("down");
    expect(LINK_LABEL.tunnel).toBe("vía túnel");
    expect(LINK_LABEL.down).toBe("sin túnel");
  });
  it("counts any answer below 500 as reachable and a network error or 5xx as down", () => {
    expect(pingReachable(200)).toBe(true);
    expect(pingReachable(401)).toBe(true);
    expect(pingReachable(502)).toBe(false);
    expect(pingReachable(null)).toBe(false);
  });
});
