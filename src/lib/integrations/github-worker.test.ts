import { afterEach, describe, expect, it, vi } from "vitest";
import { ghTokenState } from "./gh";
import { githubEnabled, githubMayStart, githubNoToken, startGithubWorker } from "./github-worker";

afterEach(() => {
  delete (globalThis as { __mesaGithubNoToken?: boolean }).__mesaGithubNoToken;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("githubMayStart: only a clear 'no token' for the configured login turns the worker off", () => {
  it("missing: one log line, off, and githubEnabled() answers false from then on", async () => {
    vi.stubEnv("MESA_GITHUB", "on");
    vi.stubEnv("MESA_ENV", "");
    vi.stubEnv("MESA_GH_USER", "ana-dev");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const asked: string[] = [];
    expect(
      await githubMayStart(async (login) => {
        asked.push(login);
        return "missing";
      }),
    ).toBe(false);
    expect(asked).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/github worker off: gh has no token for/);
    expect(githubNoToken()).toBe(true);
    expect(githubEnabled()).toBe(false);
  });

  it("present: starts, no log line", async () => {
    vi.stubEnv("MESA_GITHUB", "on");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await githubMayStart(async () => "present")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(githubNoToken()).toBe(false);
  });

  it.each([
    ["unknown (gh missing, timeout, spawn error)", async () => "unknown" as const],
    ["a token check that throws", async (): Promise<"unknown"> => Promise.reject(new Error("boom"))],
  ])("%s: starts the worker as before, no log line, not off", async (_n, check) => {
    vi.stubEnv("MESA_GITHUB", "on");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await githubMayStart(check)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(githubNoToken()).toBe(false);
  });

  it("a later check that finds the token clears the off flag", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await githubMayStart(async () => "missing");
    expect(githubNoToken()).toBe(true);
    await githubMayStart(async () => "present");
    expect(githubNoToken()).toBe(false);
  });
});

describe("startGithubWorker", () => {
  it("stays off without touching the database when the login has no token", async () => {
    vi.stubEnv("MESA_GITHUB", "on");
    vi.stubEnv("MESA_ENV", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await startGithubWorker(async () => "missing");
    expect(githubNoToken()).toBe(true);
  });

  it("does not even look for a token when GitHub is off", async () => {
    vi.stubEnv("MESA_GITHUB", "off");
    const check = vi.fn(async () => "present" as const);
    await startGithubWorker(check);
    expect(check).not.toHaveBeenCalled();
  });
});

const pe = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("ghTokenState", () => {
  it("is present with GH_TOKEN and unknown without a login, without running gh", async () => {
    expect(await ghTokenState("ana-dev", pe({ GH_TOKEN: "x" }))).toBe("present");
    expect(await ghTokenState("", pe({}))).toBe("unknown");
  });

  const answer = (code: number, stdout: string, stderr: string) => async () => ({ code, stdout, stderr });
  it.each([
    ["a token", answer(0, "gho_x", ""), "present"],
    ["gh's 'no oauth token found for github.com account'", answer(1, "", "no oauth token found for github.com account ana-dev"), "missing"],
    ["not logged in", answer(1, "", "You are not logged in to any GitHub hosts"), "missing"],
    ["gh not installed (127)", answer(127, "", "gh: command not found"), "unknown"],
    ["a timeout or spawn error (exit 1, no message)", answer(1, "", ""), "unknown"],
    ["an empty token on exit 0", answer(0, "", ""), "unknown"],
    ["some other failure", answer(1, "", "network is unreachable"), "unknown"],
  ])("%s -> %s", async (_n, run, want) => {
    expect(await ghTokenState("ana-dev", pe({}), run as never)).toBe(want);
  });
});
