import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_FULL_SCAN_EVERY_TICKS,
  applyReport,
  dueSources,
  fullScanEveryTicks,
  inWorkHours,
  intervalSec,
  joinMark,
  loadConfig,
  makeStore,
  report,
  splitMark,
  sweeperSessionName,
  tickSources,
  wait,
  writeForce,
} from "../sweep-tick.mjs";

const config = loadConfig();
const at = (s) => new Date(s).getTime(); // local time, like the config
const tue10 = at("2026-11-03T10:00:00");
const iso = (t) => new Date(t).toISOString();

test("config holds the cadence numbers", () => {
  assert.equal(config.activeIntervalSec, 60);
  assert.equal(config.idleIntervalSec, 300);
  assert.equal(config.idleAfterMin, 30);
});

test("work hours", () => {
  assert.equal(inWorkHours(config, tue10), true);
  assert.equal(inWorkHours(config, at("2026-11-03T20:00:00")), false);
  assert.equal(inWorkHours(config, at("2026-11-08T10:00:00")), false); // Sunday
});

test("60 s while active, 300 s after 30 idle minutes, back to 60 s on interaction", () => {
  const recent = { sources: { slack: { lastNewAt: iso(tue10 - 5 * 60_000) } } };
  const stale = { sources: { slack: { lastNewAt: iso(tue10 - 31 * 60_000) } } };
  assert.equal(intervalSec(config, recent, tue10), 60);
  assert.equal(intervalSec(config, stale, tue10), 300);
  assert.equal(intervalSec(config, { ...stale, lastInteractionAt: iso(tue10 - 60_000) }, tue10), 60);
  assert.equal(intervalSec(config, { sources: {} }, tue10), 300);
});

test("a source is due when its interval passed and it is not backing off", () => {
  const state = {
    lastInteractionAt: iso(tue10 - 60_000),
    sources: {
      slack: { lastChecked: iso(tue10 - 61_000) },
      basecamp: { lastChecked: iso(tue10 - 61_000), backoffUntil: iso(tue10 + 60_000) },
    },
  };
  assert.deepEqual(dueSources(config, state, tue10), ["slack"]);
  assert.deepEqual(dueSources(config, { ...state, sources: { slack: { lastChecked: iso(tue10 - 30_000) } } }, tue10), ["basecamp"]); // never checked = due
  assert.deepEqual(dueSources(config, { sources: {} }, at("2026-11-03T22:00:00")), []);
  assert.deepEqual(dueSources(config, { sources: {} }, at("2026-11-03T22:00:00"), { forced: true }), ["slack", "basecamp"]);
  assert.deepEqual(dueSources(config, state, tue10, { forced: true }), ["slack"]);
});

test("errors back off exponentially to the cap and mark the source degraded; success resets", () => {
  let s = {};
  const waits = [];
  for (let i = 0; i < 7; i++) {
    s = applyReport(config, s, { error: "429", rateLimited: true }, tue10);
    waits.push((Date.parse(s.backoffUntil) - tue10) / 1000);
  }
  assert.deepEqual(waits, [60, 120, 240, 480, 960, 1800, 1800]);
  assert.equal(s.health, "degraded");
  assert.match(s.lastError, /rate limited/);
  s = applyReport(config, s, { new: 2, watermark: "1762180000.000100" }, tue10);
  assert.equal(s.health, "ok");
  assert.equal(s.errorCount, 0);
  assert.equal(s.backoffUntil, null);
  assert.equal(s.watermark, "1762180000.000100");
  assert.equal(s.lastNewAt, iso(tue10));
  const quiet = applyReport(config, s, { new: 0 }, tue10 + 60_000);
  assert.equal(quiet.lastNewAt, iso(tue10));
  assert.equal(quiet.watermark, "1762180000.000100");
});

const memStore = (state, { forcedAfter = Infinity } = {}) => {
  let polls = 0;
  return {
    kind: "mesa",
    saved: {},
    async load() {
      return structuredClone(state);
    },
    async save(n, s) {
      this.saved[n] = s;
      state.sources[n] = s;
    },
    async forcedWithin() {
      polls++;
      return polls >= forcedAfter;
    },
  };
};

test("wait returns at once when a source is due, with its watermark", async () => {
  const store = memStore({ sources: { slack: { lastChecked: iso(tue10 - 120_000), watermark: "w1" }, basecamp: { lastChecked: iso(tue10) } }, lastInteractionAt: iso(tue10) });
  const r = await wait(config, store, { now: () => tue10 });
  assert.deepEqual(r.sources, ["slack"]);
  assert.equal(r.watermarks.slack, "w1");
  assert.equal(r.forced, false);
});

test("wait returns on Barrer ahora even outside work hours", async () => {
  const night = at("2026-11-03T23:00:00");
  let t = night;
  const store = memStore({ sources: {} }, { forcedAfter: 2 });
  const r = await wait(config, store, { now: () => (t += 1000) });
  assert.equal(r.forced, true);
  assert.deepEqual(r.sources, ["slack", "basecamp"]);
});

test("wait times out silently when nothing is due", async () => {
  let t = at("2026-11-03T23:00:00");
  const store = memStore({ sources: {} });
  store.forcedWithin = async (sec) => {
    t += sec * 1000;
    return false;
  };
  const r = await wait(config, store, { now: () => t, maxSec: 120 });
  assert.deepEqual(r, { due: false, reason: "timeout", store: "mesa" });
});

test("report persists the new state", async () => {
  const store = memStore({ sources: {} });
  const r = await report(config, store, "basecamp", { new: 1, watermark: "2026-11-03T15:00:00Z" }, { now: () => tue10 });
  assert.equal(r.intervalSec, 60);
  assert.equal(store.saved.basecamp.watermark, "2026-11-03T15:00:00Z");
  await assert.rejects(report(config, store, "email", { new: 0 }), /unknown source/);
});

test("there is no local fallback: Mesa errors surface", async () => {
  const fetchImpl = async () => ({ status: 404, json: async () => ({ error: { code: "not_found" } }) });
  const store = makeStore({ fetchImpl, base: "http://x", session: "sweeper" });
  await assert.rejects(report(config, store, "slack", { new: 0 }, { now: () => tue10 }), /404 on GET \/api\/sources/);
  const r = await wait(config, store, { now: () => tue10, maxSec: 5 });
  assert.equal(r.reason, "mesa_down");
});

test("force drops a flag the waiting store picks up once, limited to the named sources", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sweep-force-"));
  const forcePath = join(dir, "force.json");
  // Mesa has the sources but its wait endpoint fails: only the flag can wake the store.
  const fetchImpl = async (url) =>
    url.endsWith("/api/sources") ? { status: 200, json: async () => ({ sources: {}, lastInteractionAt: null }) } : { status: 500, json: async () => ({}) };
  const store = makeStore({ fetchImpl, base: "http://x", forcePath, session: "sweeper" });
  assert.equal(await store.forcedWithin(0.05, 0.01), null);
  writeForce(["slack"], forcePath);
  assert.deepEqual(await store.forcedWithin(1, 0.01), { sources: ["slack"] });
  assert.equal(await store.forcedWithin(0.05, 0.01), null); // consumed
  writeForce([], forcePath);
  const night = at("2026-11-03T23:00:00");
  const r = await wait(config, store, { now: () => night, maxSec: 30 });
  assert.equal(r.forced, true);
  assert.deepEqual(r.sources, ["slack", "basecamp"]);
});

test("health: degraded on errors, down after repeated non-rate-limit failures, ok again on success", () => {
  let s1 = {};
  s1 = applyReport(config, s1, { error: "boom" }, tue10);
  assert.equal(s1.health, "degraded");
  s1 = applyReport(config, s1, { error: "boom" }, tue10);
  s1 = applyReport(config, s1, { error: "boom" }, tue10);
  assert.equal(s1.health, "down");
  let s2 = {};
  for (let k = 0; k < 5; k++) s2 = applyReport(config, s2, { error: "429", rateLimited: true }, tue10);
  assert.equal(s2.health, "degraded");
  assert.equal(applyReport(config, s1, { new: 0 }, tue10).health, "ok");
});

test("report PATCHes Mesa with only the source fields, including the current cadence", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith("/api/sources")) return { status: 200, json: async () => ({ sources: { slack: { source: "slack", health: "ok", updatedAt: "x", watermark: "w0" } }, lastInteractionAt: iso(tue10) }) };
    return { status: 200, json: async () => ({ source: {} }) };
  };
  const store = makeStore({ fetchImpl, base: "http://m", session: "sweeper" });
  await report(config, store, "slack", { new: 1, watermark: "w1" }, { now: () => tue10 });
  const patch = calls.find((c) => c.method === "PATCH");
  assert.ok(patch.url.endsWith("/api/sources/slack"));
  assert.deepEqual(Object.keys(patch.body).sort(), ["backoffUntil", "cadenceS", "errorCount", "health", "lastChecked", "lastError", "lastNewAt", "watermark"]);
  assert.equal(patch.body.cadenceS, 60);
  assert.equal(store.kind, "mesa");
});

test("Barrer ahora: wait returns on sweep.requested for the sweeper session", async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push(`${init.method ?? "GET"} ${new URL(url).pathname}`);
    if (url.includes("/api/wait?session=sweeper")) return { status: 200, json: async () => ({ events: [{ kind: "sweep.requested", payload: { sources: ["basecamp"] } }], cursor: 7 }) };
    if (url.endsWith("/api/sources")) return { status: 200, json: async () => ({ sources: {}, lastInteractionAt: null }) };
    return { status: 200, json: async () => ({}) };
  };
  const dir = mkdtempSync(join(tmpdir(), "sweep-wake-"));
  const store = makeStore({ fetchImpl, base: "http://m", forcePath: join(dir, "f.json"), session: "sweeper" });
  const r = await wait(config, store, { now: () => at("2026-11-03T23:00:00"), maxSec: 60 });
  assert.equal(r.forced, true);
  assert.deepEqual(r.sources, ["basecamp"]);
  assert.ok(seen.includes("POST /api/sessions") && seen.includes("POST /api/wait/ack"));
});

test("fullScanEveryTicks comes from config, and falls back to the default when absent or invalid", () => {
  assert.equal(config.sources.basecamp.fullScanEveryTicks, 10);
  assert.equal(fullScanEveryTicks(config), 10);
  assert.equal(fullScanEveryTicks({ ...config, sources: { ...config.sources, basecamp: { enabled: true, fullScanEveryTicks: 5 } } }), 5);
  assert.equal(fullScanEveryTicks({ sources: { basecamp: { enabled: true } } }), DEFAULT_FULL_SCAN_EVERY_TICKS);
  assert.equal(fullScanEveryTicks({ sources: {} }), DEFAULT_FULL_SCAN_EVERY_TICKS);
  assert.equal(fullScanEveryTicks({ sources: { basecamp: { fullScanEveryTicks: 0 } } }), DEFAULT_FULL_SCAN_EVERY_TICKS);
  assert.equal(fullScanEveryTicks({ sources: { basecamp: { fullScanEveryTicks: "x" } } }), DEFAULT_FULL_SCAN_EVERY_TICKS);
});

test("compound watermark: probe and catch-up window are kept apart", () => {
  assert.deepEqual(splitMark("2026-11-09T10:00:00Z|2026-11-09T09:00:00Z"), { probe: "2026-11-09T10:00:00Z", scan: "2026-11-09T09:00:00Z" });
  assert.deepEqual(splitMark("1762180000.000100"), { probe: "1762180000.000100", scan: null });
  assert.deepEqual(splitMark(null), { probe: null, scan: null });
  assert.equal(joinMark("p", null), "p");
  assert.equal(joinMark(null, null), null);
  assert.deepEqual(splitMark(joinMark(null, "s")), { probe: null, scan: "s" });

  let s = applyReport(config, {}, { new: 1, watermark: "P1" }, tue10);
  assert.equal(s.watermark, "P1"); // Slack-style: unchanged shape
  s = applyReport(config, s, { new: 0, watermark: "P2", scanSince: "S1" }, tue10);
  assert.equal(s.watermark, "P2|S1");
  s = applyReport(config, s, { new: 0, watermark: "P3" }, tue10); // the probe moves, the catch-up window stays
  assert.equal(s.watermark, "P3|S1");
  s = applyReport(config, s, { new: 0 }, tue10); // a quiet report touches neither
  assert.equal(s.watermark, "P3|S1");
  s = applyReport(config, s, { new: 0, scanSince: "S2" }, tue10); // the catch-up moves, the probe stays
  assert.equal(s.watermark, "P3|S2");
  s = applyReport(config, s, { error: "boom" }, tue10); // an error keeps both
  assert.equal(s.watermark, "P3|S2");
});

test("wait carries fullScanEveryTicks and the catch-up window for Basecamp, and the probe watermark apart", async () => {
  const state = { sources: { slack: { lastChecked: iso(tue10), watermark: "w1" }, basecamp: { lastChecked: iso(tue10 - 120_000), watermark: "P|S" } }, lastInteractionAt: iso(tue10) };
  const r = await wait(config, memStore(state), { now: () => tue10 });
  assert.deepEqual(r.sources, ["basecamp"]);
  assert.equal(r.watermarks.basecamp, "P");
  assert.equal(r.fullScanEveryTicks, 10);
  assert.deepEqual(r.scanSince, { basecamp: "S" });

  const fresh = await wait(config, memStore({ sources: {}, lastInteractionAt: iso(tue10) }), { now: () => tue10 });
  assert.deepEqual(fresh.scanSince, { basecamp: null }); // never probed: the instance's first tick reads everything
  assert.equal(fresh.watermarks.basecamp, null);

  // probed before the catch-up window existed: the first catch-up falls back to the probe watermark, not "all unread"
  const probeOnly = await wait(config, memStore({ sources: { basecamp: { lastChecked: iso(tue10 - 120_000), watermark: "P" } }, lastInteractionAt: iso(tue10) }), { now: () => tue10 });
  assert.deepEqual(probeOnly.scanSince, { basecamp: "P" });
  assert.equal(probeOnly.watermarks.basecamp, "P");

  const slackOnly = await wait(config, memStore({ sources: { slack: { lastChecked: iso(tue10 - 120_000) }, basecamp: { lastChecked: iso(tue10) } }, lastInteractionAt: iso(tue10) }), { now: () => tue10 });
  assert.deepEqual(slackOnly.sources, ["slack"]);
  assert.equal("scanSince" in slackOnly, false);
});

test("report writes the catch-up window to Mesa and keeps it across a probe-only report", async () => {
  const store = memStore({ sources: { basecamp: { watermark: "P0" } } });
  await report(config, store, "basecamp", { new: 2, watermark: "P1", scanSince: "S1" }, { now: () => tue10 });
  assert.equal(store.saved.basecamp.watermark, "P1|S1");
  await report(config, store, "basecamp", { new: 0, watermark: "P2" }, { now: () => tue10 + 60_000 });
  assert.equal(store.saved.basecamp.watermark, "P2|S1");
});

// A store on a fake clock: waiting advances the clock by the time asked, nothing forces a sweep.
const clockStore = (state, clock) => ({
  ...memStore(state),
  async forcedWithin(sec) {
    clock.t += sec * 1000;
    return null;
  },
});

test("coalesced tick: sources checked 7 s apart come back in one wait, not two", async () => {
  const state = { sources: { slack: { lastChecked: iso(tue10 - 61_000) }, basecamp: { lastChecked: iso(tue10 - 54_000) } }, lastInteractionAt: iso(tue10) };
  const r = await wait(config, memStore(state), { now: () => tue10 });
  assert.deepEqual(r.sources, ["slack", "basecamp"]); // basecamp is due in 7 s, inside half of 60 s
  assert.equal(r.forced, false);
  assert.deepEqual(r.scanSince, { basecamp: null });
});

test("coalesced tick: only sources due within half the interval, never one that is backing off", () => {
  const live = { lastInteractionAt: iso(tue10) };
  const slackDue = { lastChecked: iso(tue10 - 61_000) };
  const pick = (basecamp) => tickSources(config, { ...live, sources: { slack: slackDue, basecamp } }, tue10);
  assert.deepEqual(pick({ lastChecked: iso(tue10 - 30_000) }), ["slack", "basecamp"]); // due in 30 s = half of 60 s
  assert.deepEqual(pick({ lastChecked: iso(tue10 - 29_000) }), ["slack"]); // due in 31 s
  assert.deepEqual(pick({ lastChecked: iso(tue10) }), ["slack"]); // just checked
  assert.deepEqual(pick({ lastChecked: iso(tue10 - 54_000), backoffUntil: iso(tue10 + 5_000) }), ["slack"]); // parked
  assert.deepEqual(pick({ lastChecked: iso(tue10 - 54_000), backoffUntil: iso(tue10 - 1_000) }), ["slack", "basecamp"]); // backoff over
  assert.deepEqual(tickSources(config, { ...live, sources: { slack: { lastChecked: iso(tue10) }, basecamp: { lastChecked: iso(tue10 - 54_000) } } }, tue10), []); // nothing due: nothing is pulled in
  assert.deepEqual(tickSources(config, { sources: {} }, at("2026-11-03T22:00:00")), []); // outside work hours
});

test("a quiet hour costs at most 12 wait() returns for a sweeper, even with the sources 7 s apart", async () => {
  const clock = { t: tue10 };
  const now = () => clock.t;
  const state = { sources: { slack: { lastChecked: iso(tue10 - 400_000) }, basecamp: { lastChecked: iso(tue10 - 407_000) } } };
  const store = clockStore(state, clock);
  let returns = 0;
  const end = tue10 + 3600_000;
  while (clock.t < end) {
    const r = await wait(config, store, { now });
    if (clock.t >= end) break; // this return belongs to the next hour
    returns++;
    if (!r.due) continue;
    for (const name of r.sources) {
      await report(config, store, name, { new: 0 }, { now });
      clock.t += 7_000; // the probe of the next source takes a few seconds
    }
  }
  assert.ok(returns <= 12, `${returns} wait returns in a quiet hour`);
});

test("MESA_SLACK_USER_ID overrides the Slack user id of the file; blank keeps it", () => {
  const file = loadConfig(undefined, {}).sources.slack.userId;
  assert.equal(file, "U06E2UBDC73");
  assert.equal(loadConfig(undefined, { MESA_SLACK_USER_ID: "U0ANA" }).sources.slack.userId, "U0ANA");
  assert.equal(loadConfig(undefined, { MESA_SLACK_USER_ID: "  " }).sources.slack.userId, file);
});

// ---------- the sweeper's session name ----------

test("the sweeper session comes from the environment, then from the repo's .env.local, then \"sweeper\"", () => {
  const repo = mkdtempSync(join(tmpdir(), "mesa-sweeper-session-"));
  assert.equal(sweeperSessionName({}, repo), "sweeper"); // no .env.local at all
  writeFileSync(join(repo, ".env.local"), "MESA_GH_USER=ana-dev\nMESA_SWEEPER_SESSION=sweeper-ana\n");
  assert.equal(sweeperSessionName({}, repo), "sweeper-ana");
  assert.equal(sweeperSessionName({ MESA_SWEEPER_SESSION: "from-env" }, repo), "from-env"); // the environment wins
  assert.equal(sweeperSessionName({ MESA_SWEEPER_SESSION: "  " }, repo), "sweeper-ana"); // blank is unset
  writeFileSync(join(repo, ".env.local"), "MESA_SWEEPER_SESSION=\n"); // the line copied from .env.example, left blank
  assert.equal(sweeperSessionName({}, repo), "sweeper");
});
