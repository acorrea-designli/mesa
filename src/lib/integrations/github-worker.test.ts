import { afterEach, describe, expect, it, vi } from "vitest";
import { githubNoToken, startGithubWorker } from "./github-worker";

afterEach(() => {
  delete (globalThis as { __mesaGithubNoToken?: boolean }).__mesaGithubNoToken;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("startGithubWorker without a token for the configured login", () => {
  it("logs one line and stays off, without touching the database", async () => {
    vi.stubEnv("MESA_GITHUB", "on");
    vi.stubEnv("MESA_ENV", "");
    vi.stubEnv("MESA_GH_USER", "ana-dev");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const asked: string[] = [];
    await startGithubWorker(async (login) => {
      asked.push(login);
      return false;
    });
    expect(asked).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/github worker off: gh has no token for/);
    expect(githubNoToken()).toBe(true);
  });

  it("does not even look for a token when GitHub is off", async () => {
    vi.stubEnv("MESA_GITHUB", "off");
    const hasToken = vi.fn(async () => true);
    await startGithubWorker(hasToken);
    expect(hasToken).not.toHaveBeenCalled();
  });

  it("treats a failing token check as no token", async () => {
    vi.stubEnv("MESA_GITHUB", "on");
    vi.stubEnv("MESA_ENV", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await startGithubWorker(async () => {
      throw new Error("boom");
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(githubNoToken()).toBe(true);
  });
});
