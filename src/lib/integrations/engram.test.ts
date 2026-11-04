import { beforeEach, describe, expect, it } from "vitest";
import { clearEngramCache, parseSearch, searchEngram, type EngramRunner } from "./engram";

const OUT = `Update available: 3.3.0 -> 3.6.1
To update:
  go install github.com/Gentleman-Programming/engram/v3/cmd/engram@latest

Found 2 memories:

[1] #2901 (learning) — CI runners look offline in repo runner list
    **What**: a body that must never reach the panel
    2026-11-03 03:56:32 | project: medix-platform | scope: project

[2] #1747 (bugfix) — Runners went into a 401 restart loop
    **What**: another body
    2026-10-28 14:11:06 | project: nexo | scope: project
`;

const runner = (r: { code: number; stdout: string; stderr?: string }): EngramRunner & { calls: string[][] } => {
  const calls: string[][] = [];
  const fn = (async (args: string[]) => {
    calls.push(args);
    return { stderr: "", ...r };
  }) as EngramRunner & { calls: string[][] };
  fn.calls = calls;
  return fn;
};

describe("engram search", () => {
  beforeEach(() => clearEngramCache());

  it("parses titles, types, dates and projects, never bodies", () => {
    const obs = parseSearch(OUT);
    expect(obs).toEqual([
      { id: "2901", type: "learning", title: "CI runners look offline in repo runner list", createdAt: "2026-11-03T03:56:32.000Z", project: "medix-platform" },
      { id: "1747", type: "bugfix", title: "Runners went into a 401 restart loop", createdAt: "2026-10-28T14:11:06.000Z", project: "nexo" },
    ]);
    expect(JSON.stringify(obs)).not.toContain("body");
  });

  it("passes project and limit to the CLI", async () => {
    const run = runner({ code: 0, stdout: OUT });
    const r = await searchEngram("runners", { project: "medix-platform", limit: 1 }, run);
    expect(run.calls[0]).toEqual(["search", "runners", "--project", "medix-platform", "--limit", "1"]);
    expect(r).toMatchObject({ status: "connected" });
    expect(r.observations).toHaveLength(1);
  });

  it("searches every project without one", async () => {
    const run = runner({ code: 0, stdout: OUT });
    await searchEngram("x", {}, run);
    expect(run.calls[0]).toContain("--all");
  });

  it("is connected and empty for no matches or an unknown project", async () => {
    expect(await searchEngram("zz", {}, runner({ code: 0, stdout: 'No memories found for: "zz"' }))).toEqual({ status: "connected", observations: [] });
    expect(await searchEngram("zz", { project: "mesa" }, runner({ code: 1, stdout: "", stderr: "engram: unknown project: mesa" }))).toEqual({
      status: "connected",
      observations: [],
    });
  });

  it("is offline when the CLI is missing or fails, and does not cache that", async () => {
    expect(await searchEngram("q", {}, runner({ code: 127, stdout: "" }))).toEqual({ status: "offline", observations: [] });
    const run = runner({ code: 0, stdout: OUT });
    expect((await searchEngram("q", {}, run)).status).toBe("connected");
  });

  it("caches connected answers for 30 s", async () => {
    const run = runner({ code: 0, stdout: OUT });
    await searchEngram("q", {}, run, 1000);
    await searchEngram("q", {}, run, 20_000);
    expect(run.calls).toHaveLength(1);
    await searchEngram("q", {}, run, 40_000);
    expect(run.calls).toHaveLength(2);
  });
});
