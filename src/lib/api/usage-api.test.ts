// /api/usage over an in-memory database: the statusLine's POST, the rail's GET, and the tokens detail.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/usage/route";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const ctx = { params: Promise.resolve({}) };
const post = (body: unknown) => POST(new Request("http://local/api/usage", { method: "POST", body: JSON.stringify(body) }), ctx);
const get = (q = "") => GET(new Request(`http://local/api/usage${q}`), ctx);

const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const reset = (h: number) => Math.floor(Date.now() / 1000) + h * 3600;

describe("POST /api/usage", () => {
  it("saves the snapshot and GET shows % remaining", async () => {
    const res = await post({
      sessionId: "s1",
      model: { id: "claude-opus-5-5", displayName: "Opus 5.5" },
      capturedAt: at(2),
      fiveHour: { usedPercentage: 32, resetsAt: reset(3) },
      sevenDay: { usedPercentage: 11, resetsAt: reset(80) },
    });
    expect(await res.json()).toEqual({ saved: true });
    const { view, tokens } = (await (await get()).json()) as { view: { state: string; windows: { label: string; remaining: number | null }[] }; tokens: unknown };
    expect(view.state).toBe("fresh");
    expect(view.windows.map((w) => [w.label, w.remaining])).toEqual([
      ["5 h", 68],
      ["semana", 89],
    ]);
    expect(tokens).toBeNull();
  });

  it("keeps the newest capture when an older one arrives late", async () => {
    await post({ sessionId: "new", capturedAt: at(1), fiveHour: { usedPercentage: 50, resetsAt: reset(3) } });
    const res = await post({ sessionId: "old", capturedAt: at(10), fiveHour: { usedPercentage: 10, resetsAt: reset(3) } });
    expect(await res.json()).toEqual({ saved: false });
    expect(r.usage.snapshot()?.sessionId).toBe("new");
  });

  it("accepts a snapshot with no rate_limits (API-key sessions) without error", async () => {
    const res = await post({ sessionId: "s1", model: { id: "m", displayName: "M" } });
    expect(res.status).toBe(200);
    expect(r.usage.snapshot()?.fiveHour).toBeNull();
  });

  it("rejects a malformed body", async () => {
    expect((await post({ fiveHour: { usedPercentage: "lots", resetsAt: 1 } })).status).toBe(400);
  });
});

describe("GET /api/usage", () => {
  it("answers 'none' with no error before anything was captured", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { view: { state: string } }).view.state).toBe("none");
  });

  it("marks a snapshot older than 15 minutes stale", async () => {
    await post({ sessionId: "s1", capturedAt: at(20), fiveHour: { usedPercentage: 32, resetsAt: reset(3) } });
    expect(((await (await get()).json()) as { view: { state: string; age: string } }).view).toMatchObject({ state: "stale", age: "hace 20 min" });
  });

  it("returns tokens by role only when asked, from CLAUDE_CONFIG_DIR", async () => {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-usage-api-"));
    const proj = path.join(cfg, "projects", "x");
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(
      path.join(proj, "s1.jsonl"),
      JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 5, output_tokens: 7 } } }) + "\n",
    );
    vi.stubEnv("MESA_TRANSCRIPTS_DIR", proj);
    const { tokens } = (await (await get("?tokens=1")).json()) as { tokens: { today: { total: number; byRole: { key: string }[] } } };
    expect(tokens.today.total).toBe(12);
    expect(tokens.today.byRole.map((x) => x.key)).toEqual(["lead"]);
    fs.rmSync(cfg, { recursive: true, force: true });
  });

  it("records a history point per accepted snapshot, one per 5 minutes, and GET returns it on request", async () => {
    const win = { fiveHour: { usedPercentage: 10, resetsAt: reset(3) }, sevenDay: { usedPercentage: 4, resetsAt: reset(80) } };
    await post({ sessionId: "s1", capturedAt: at(30), ...win });
    await post({ sessionId: "s1", capturedAt: at(28), ...win }); // 2 min later: no new point
    await post({ sessionId: "s1", capturedAt: at(20), fiveHour: { usedPercentage: 12, resetsAt: reset(3) }, sevenDay: { usedPercentage: 5, resetsAt: reset(80) } });
    await post({ sessionId: "s0", capturedAt: at(40), ...win }); // older than the stored snapshot: not saved, no point
    const body = (await (await get("?history=1")).json()) as { now: string; history: { t: number; fiveHourUsed: number | null; sevenDayUsed: number | null }[] };
    expect(body.history.map((p) => [p.fiveHourUsed, p.sevenDayUsed])).toEqual([
      [10, 4],
      [12, 5],
    ]);
    expect(body.history[0]!.t).toBeLessThan(body.history[1]!.t);
    expect(Number.isNaN(Date.parse(body.now))).toBe(false);
    expect(((await (await get()).json()) as { history: unknown[] }).history).toEqual([]);
  });

  it("a snapshot with no rate_limits adds no point", async () => {
    await post({ sessionId: "s1", capturedAt: at(5) });
    expect(((await (await get("?history=1")).json()) as { history: unknown[] }).history).toEqual([]);
  });

  it("tokens are null when there is no transcripts folder", async () => {
    vi.stubEnv("MESA_TRANSCRIPTS_DIR", "");
    vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(os.tmpdir(), "mesa-no-such-config"));
    expect(((await (await get("?tokens=1")).json()) as { tokens: unknown }).tokens).toBeNull();
  });
});
