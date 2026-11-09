import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { buildPayload, formatLine, isLoopback, main, mesaUrl, parseInput, postSnapshot } from "../statusline.mjs";

const SCRIPT = fileURLToPath(new URL("../statusline.mjs", import.meta.url));
const NOW = new Date("2026-11-09T20:00:00Z");
const INPUT = {
  session_id: "s-1",
  model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
  context_window: { used_percentage: 12 },
  cost: { total_cost_usd: 1.2 },
  rate_limits: {
    five_hour: { used_percentage: 32.4, resets_at: 1762731000 },
    seven_day: { used_percentage: 11, resets_at: 1763076600 },
  },
};

test("the line is model, 5 h and week, as % remaining", () => {
  assert.equal(formatLine(INPUT), "Opus 5.5 · 5 h 68% restante · semana 89% restante");
});

test("the line still prints with no rate_limits (API-key session) or an empty document", () => {
  assert.equal(formatLine({ model: { display_name: "Opus 5.5" } }), "Opus 5.5 · uso sin dato");
  assert.equal(formatLine({}), "Claude · uso sin dato");
  assert.equal(formatLine({ model: { id: "claude-x" }, rate_limits: {} }), "claude-x · uso sin dato");
});

test("a lone window prints alone; a figure without a reset time counts as absent", () => {
  assert.equal(formatLine({ model: { display_name: "M" }, rate_limits: { five_hour: { used_percentage: 100, resets_at: 5 } } }), "M · 5 h 0% restante");
  assert.equal(formatLine({ model: { display_name: "M" }, rate_limits: { five_hour: { used_percentage: 10 } } }), "M · uso sin dato");
});

test("the payload carries rate_limits, model, session id and capturedAt", () => {
  assert.deepEqual(buildPayload(INPUT, NOW), {
    sessionId: "s-1",
    model: { id: "claude-opus-5-5", displayName: "Opus 5.5" },
    capturedAt: "2026-11-09T20:00:00.000Z",
    fiveHour: { usedPercentage: 32.4, resetsAt: 1762731000 },
    sevenDay: { usedPercentage: 11, resetsAt: 1763076600 },
  });
});

test("no payload without rate_limits, so a good snapshot is never overwritten with nothing", () => {
  assert.equal(buildPayload({ session_id: "x" }, NOW), null);
});

test("resets_at may be a numeric or an ISO string", () => {
  const p = buildPayload({ rate_limits: { five_hour: { used_percentage: 1, resets_at: "1762731000" }, seven_day: { used_percentage: 2, resets_at: "2026-11-14T23:30:00Z" } } }, NOW);
  assert.equal(p.fiveHour.resetsAt, 1762731000);
  assert.equal(p.sevenDay.resetsAt, Date.parse("2026-11-14T23:30:00Z") / 1000);
});

test("parseInput survives garbage", () => {
  assert.deepEqual(parseInput("not json"), {});
  assert.deepEqual(parseInput("[1,2]"), {});
  assert.deepEqual(parseInput(""), {});
});

test("only a loopback Mesa is ever called", async () => {
  assert.ok(isLoopback("http://127.0.0.1:8790") && isLoopback("http://localhost:8796"));
  assert.ok(!isLoopback("https://api.anthropic.com") && !isLoopback("not a url"));
  let called = false;
  const fetchFn = async () => ((called = true), { ok: true });
  assert.equal(await postSnapshot("https://api.anthropic.com", buildPayload(INPUT, NOW), { fetchFn }), false);
  assert.equal(called, false);
});

test("--url wins over MESA_URL, which wins over the default", () => {
  assert.equal(mesaUrl(["--url", "http://127.0.0.1:8796"], { MESA_URL: "http://127.0.0.1:1" }), "http://127.0.0.1:8796");
  assert.equal(mesaUrl([], { MESA_URL: "http://127.0.0.1:1" }), "http://127.0.0.1:1");
  assert.equal(mesaUrl([], {}), "http://127.0.0.1:8790");
});

test("main prints the line, posts it, and returns 0", async () => {
  const out = [];
  const calls = [];
  const fetchFn = async (url, init) => (calls.push({ url: String(url), body: JSON.parse(init.body) }), { ok: true });
  const code = await main({
    stdin: [JSON.stringify(INPUT)],
    stdout: { write: (s) => out.push(s) },
    argv: ["--url", "http://127.0.0.1:8796"],
    env: {},
    fetchFn,
    now: NOW,
  });
  assert.equal(code, 0);
  assert.deepEqual(out, ["Opus 5.5 · 5 h 68% restante · semana 89% restante\n"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8796/api/usage");
  assert.equal(calls[0].body.sessionId, "s-1");
});

test("main prints and returns 0 when the POST throws", async () => {
  const out = [];
  const code = await main({ stdin: [JSON.stringify(INPUT)], stdout: { write: (s) => out.push(s) }, argv: [], env: {}, fetchFn: async () => Promise.reject(new Error("ECONNREFUSED")), now: NOW });
  assert.equal(code, 0);
  assert.equal(out.length, 1);
});

/** Runs the real script as Claude Code does: JSON on stdin, one line on stdout. */
function run(input, args) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr, ms: Date.now() - t0 }));
    child.stdin.end(input);
  });
}

test("process: saves to a running Mesa and prints one line", async () => {
  const got = [];
  const server = createServer((req, res) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      got.push({ method: req.method, url: req.url, body: JSON.parse(b) });
      res.setHeader("content-type", "application/json");
      res.end('{"saved":true}');
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const r = await run(JSON.stringify(INPUT), ["--url", `http://127.0.0.1:${port}`]);
  server.close();
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "Opus 5.5 · 5 h 68% restante · semana 89% restante\n");
  assert.equal(got.length, 1);
  assert.equal(got[0].method, "POST");
  assert.equal(got[0].url, "/api/usage");
  assert.equal(got[0].body.fiveHour.usedPercentage, 32.4);
  assert.match(got[0].body.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("process: Mesa down still prints the line and exits 0", async () => {
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r)); // nothing listens there now
  const r = await run(JSON.stringify(INPUT), ["--url", `http://127.0.0.1:${port}`]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "Opus 5.5 · 5 h 68% restante · semana 89% restante\n");
  assert.ok(r.ms < 4000, `took ${r.ms} ms`);
});

test("process: Mesa hanging is cut at the timeout; bad stdin still prints", async () => {
  const hang = createServer(() => {});
  await new Promise((r) => hang.listen(0, "127.0.0.1", r));
  const { port } = hang.address();
  const slow = await run(JSON.stringify(INPUT), ["--url", `http://127.0.0.1:${port}`]);
  hang.closeAllConnections();
  hang.close();
  assert.equal(slow.code, 0);
  assert.equal(slow.stdout, "Opus 5.5 · 5 h 68% restante · semana 89% restante\n");
  assert.ok(slow.ms < 4000, `took ${slow.ms} ms`);
  const bad = await run("{{{", []);
  assert.equal(bad.code, 0);
  assert.equal(bad.stdout, "Claude · uso sin dato\n");
});
