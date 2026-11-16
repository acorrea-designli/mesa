import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET as HEALTH } from "@/app/api/health/route";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";
import { activeGhChildren, classify, execGh, GH_TIMEOUT_CODE, parseHttp } from "./gh";

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

describe("execGh hard timeout (t206)", () => {
  const sleeper = (ms: number) => ["-e", `setTimeout(() => {}, ${ms})`];

  it("kills a hung child at the deadline and resolves with code 124", async () => {
    const t0 = Date.now();
    const r = await execGh(process.execPath, sleeper(60_000), process.env, 300);
    expect(r.code).toBe(GH_TIMEOUT_CODE);
    expect(r.stderr).toMatch(/timed out/);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(activeGhChildren()).toEqual([]);
  });

  it("resolves even when a grandchild keeps the pipes open after the kill", async () => {
    // The child starts a grandchild that inherits stdout and outlives it; only the grace timer can settle the call.
    const code = `const { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: ["ignore", "inherit", "inherit"] }); setTimeout(() => {}, 60000);`;
    const t0 = Date.now();
    const r = await execGh(process.execPath, ["-e", code], process.env, 300);
    expect(r.code).toBe(GH_TIMEOUT_CODE);
    expect(Date.now() - t0).toBeLessThan(8_000);
  }, 15_000);

  it("closes stdin when there is no input, so a child that reads it sees EOF", async () => {
    const r = await execGh(process.execPath, ["-e", `process.stdin.on("data", () => {}).on("end", () => console.log("eof"))`], process.env, 10_000);
    expect(r).toMatchObject({ code: 0, stdout: expect.stringContaining("eof") });
  });

  it("reports an exit code and output of a normal run", async () => {
    const r = await execGh(process.execPath, ["-e", `console.log("hi"); process.exit(3)`], process.env, 10_000);
    expect(r).toMatchObject({ code: 3, stdout: expect.stringContaining("hi") });
  });

  it("does not block a request while a slow gh call runs", async () => {
    const g = globalThis as unknown as { __mesaRepos?: Repos };
    g.__mesaRepos = createRepos(openDb(":memory:"));
    let slowDone = false;
    const slow = execGh(process.execPath, sleeper(3_000), process.env, 10_000).then((r) => {
      slowDone = true;
      return r;
    });
    expect(activeGhChildren()).toHaveLength(1);
    const t0 = Date.now();
    const res = await HEALTH(new Request("http://local/api/health"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(1_000);
    // The request was answered while the 3 s child was still running.
    expect(slowDone).toBe(false);
    expect((await slow).code).toBe(0);
  }, 15_000);

  it("drops partial stdout when it times out", async () => {
    const r = await execGh(process.execPath, ["-e", `console.log("HTTP/2.0 200 OK"); setTimeout(() => {}, 60000)`], process.env, 1_500);
    expect(r).toMatchObject({ code: GH_TIMEOUT_CODE, stdout: "" });
  });

  // cmd.exe is not a libuv process (no kill-on-close job), so like gh.exe it leaves its child behind unless the tree is
  // killed in the right order: taskkill first, the plain kill only from its callback.
  it.skipIf(process.platform !== "win32")("kills a grandchild started through cmd.exe on timeout", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mesa-gh-"));
    try {
      const pidFile = path.join(dir, "pid.txt");
      const script = path.join(dir, "gc.js");
      const bat = path.join(dir, "run.cmd");
      writeFileSync(script, `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 30000);`);
      writeFileSync(bat, `@"${process.execPath}" "${script}"\r\n`);
      const run = execGh("cmd.exe", ["/d", "/c", bat], process.env, 2_500);
      let gc = 0;
      for (let i = 0; i < 40 && !gc; i++) {
        await new Promise((r) => setTimeout(r, 100));
        gc = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : 0;
      }
      expect(gc).toBeGreaterThan(0);
      expect((await run).code).toBe(GH_TIMEOUT_CODE);
      await new Promise((r) => setTimeout(r, 1_000));
      const alive = (() => {
        try {
          process.kill(gc, 0);
          return true;
        } catch {
          return false;
        }
      })();
      if (alive) process.kill(gc, "SIGKILL");
      expect(alive).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
