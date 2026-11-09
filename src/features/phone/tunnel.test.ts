import { describe, expect, it } from "vitest";
import { LINK_LABEL, classifyPing, isLoopbackHost, linkState } from "./tunnel";

describe("phone link state", () => {
  it("is local on loopback hosts, whatever the ping says", () => {
    for (const h of ["localhost", "127.0.0.1", "[::1]", ""]) {
      for (const p of ["ok", "down", "login"] as const) expect(linkState(h, p)).toBe("local");
    }
    expect(isLoopbackHost("mesa.example.com")).toBe(false);
  });
  it("is 'vía túnel' when the PC answers, 'sin túnel' when it does not, 'Vuelve a entrar' on an expired Access session", () => {
    expect(linkState("mesa.example.com", "ok")).toBe("tunnel");
    expect(linkState("mesa.example.com", "down")).toBe("down");
    expect(linkState("mesa.example.com", "login")).toBe("login");
    expect(LINK_LABEL.tunnel).toBe("vía túnel");
    expect(LINK_LABEL.down).toBe("sin túnel");
    expect(LINK_LABEL.login).toBe("Vuelve a entrar");
  });
});

describe("classifyPing", () => {
  it("any answer below 500 proves the PC is up, a 401 included", () => {
    expect(classifyPing({ status: 200, type: "basic" })).toBe("ok");
    expect(classifyPing({ status: 401, type: "basic" })).toBe("ok");
  });
  it("a redirect to the Access login (opaque redirect) or a 403 is an expired session, not a missing tunnel", () => {
    expect(classifyPing({ status: 0, type: "opaqueredirect" })).toBe("login");
    expect(classifyPing({ status: 403, type: "basic" })).toBe("login");
  });
  it("a network error or a 5xx (502 Mesa down, 530 tunnel down) is down", () => {
    expect(classifyPing(null)).toBe("down");
    expect(classifyPing({ status: 502, type: "basic" })).toBe("down");
    expect(classifyPing({ status: 530, type: "basic" })).toBe("down");
  });
});
