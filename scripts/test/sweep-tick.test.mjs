import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyReport, dueSources, inWorkHours, intervalSec, loadConfig, makeStore, report, wait, writeForce } from "../sweep-tick.mjs";

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

test("the store falls back to a local file while Mesa has no sources API", async () => {
  const fetchImpl = async () => ({ status: 404, json: async () => ({ error: { code: "not_found" } }) });
  const store = makeStore({ fetchImpl, base: "http://x", localPath: join(mkdtempSync(join(tmpdir(), "sweep-")), "s.json") });
  await report(config, store, "slack", { new: 0 }, { now: () => tue10 });
  assert.equal(store.kind, "local");
  assert.equal((await store.load()).sources.slack.health, "ok");
});

test("force drops a flag the waiting store picks up once, limited to the named sources", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sweep-force-"));
  const forcePath = join(dir, "force.json");
  const fetchImpl = async () => ({ status: 404, json: async () => ({}) });
  const store = makeStore({ fetchImpl, base: "http://x", localPath: join(dir, "s.json"), forcePath });
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

test("report sends health to Mesa: ok, limited on a 429, down on other errors", async () => {
  const sent = [];
  const store = memStore({ sources: {} });
  store.health = async (name, state) => sent.push([name, state]);
  await report(config, store, "slack", { new: 0 }, { now: () => tue10 });
  await report(config, store, "slack", { error: "429", rateLimited: true }, { now: () => tue10 });
  await report(config, store, "basecamp", { error: "boom" }, { now: () => tue10 });
  assert.deepEqual(sent, [["slack", "ok"], ["slack", "limited"], ["basecamp", "down"]]);
});
