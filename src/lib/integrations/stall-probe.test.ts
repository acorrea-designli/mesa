import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startStallProbe, stopStallProbe } from "./stall-probe";
import { syncMark } from "./sync-mark";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const block = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

describe("stall probe", () => {
  let dir = "";
  afterEach(async () => {
    await stopStallProbe();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("names the tracked call the main thread is stuck in while it is still stuck", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-probe-"));
    const out = path.join(dir, "stderr.log");
    const fd = fs.openSync(out, "a");
    startStallProbe({ fd, everyMs: 100, stallMs: 400 });
    await sleep(400); // worker start-up
    // A synchronous wait with no CPU, inside a tracked SQLite call.
    syncMark("sqlite", "BEGIN   IMMEDIATE -- blocked", () => block(1_500));
    const duringBlock = fs.readFileSync(out, "utf8"); // written by the worker while the thread was blocked
    expect(duringBlock).toMatch(/main thread unresponsive for \d+\.\ds \(process cpu \+\d+ms since the last beat\); in sqlite for \d+\.\ds: BEGIN IMMEDIATE -- blocked/);
    await sleep(600);
    expect(fs.readFileSync(out, "utf8")).toContain("main thread responsive again");
    fs.closeSync(fd);
  });

  it("says no tracked call when the block is somewhere else, and stays quiet when healthy", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-probe-"));
    const out = path.join(dir, "stderr.log");
    const fd = fs.openSync(out, "a");
    startStallProbe({ fd, everyMs: 100, stallMs: 400 });
    await sleep(800);
    expect(fs.readFileSync(out, "utf8")).toBe("");
    block(1_200);
    expect(fs.readFileSync(out, "utf8")).toMatch(/unresponsive for .*; no tracked sync call/);
    fs.closeSync(fd);
  });
});
