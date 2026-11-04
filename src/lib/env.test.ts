// MESA_ENV gating: one reader, and every outward integration is off in sandbox.
import { afterEach, describe, expect, it, vi } from "vitest";
import { isSandbox, mesaEnv } from "./env";
import { githubEnabled } from "./integrations/github-worker";

afterEach(() => vi.unstubAllEnvs());
const e = (o: Record<string, string>) => o as NodeJS.ProcessEnv;

describe("mesaEnv", () => {
  it("is live unless MESA_ENV says sandbox", () => {
    expect(mesaEnv(e({}))).toBe("live");
    expect(mesaEnv(e({ MESA_ENV: "" }))).toBe("live");
    expect(mesaEnv(e({ MESA_ENV: "production" }))).toBe("live");
    expect(mesaEnv(e({ MESA_ENV: "sandbox" }))).toBe("sandbox");
    expect(mesaEnv(e({ MESA_ENV: " Sandbox " }))).toBe("sandbox");
    expect(isSandbox(e({ MESA_ENV: "live" }))).toBe(false);
  });

  it("reads process.env by default", () => {
    vi.stubEnv("MESA_ENV", "sandbox");
    expect(isSandbox()).toBe(true);
  });
});

describe("GitHub worker gating", () => {
  it("keeps the live rules", () => {
    expect(githubEnabled(e({}))).toBe(true);
    expect(githubEnabled(e({ MESA_DB: "data/x.db" }))).toBe(false);
    expect(githubEnabled(e({ MESA_DB: "data/x.db", MESA_GITHUB: "on" }))).toBe(true);
  });

  it("is always off in sandbox, MESA_GITHUB=on included", () => {
    expect(githubEnabled(e({ MESA_ENV: "sandbox" }))).toBe(false);
    expect(githubEnabled(e({ MESA_ENV: "sandbox", MESA_GITHUB: "on" }))).toBe(false);
    expect(githubEnabled(e({ MESA_ENV: "sandbox", MESA_DB: "data/sandbox.db", MESA_GITHUB: "1" }))).toBe(false);
  });
});
