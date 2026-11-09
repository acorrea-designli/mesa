#!/usr/bin/env node
// The clock of the Slack/Basecamp sweep. The sweeper agent calls it in the FOREGROUND between probes, so its turn
// never ends while it waits (no idle notifications to the lead) and no tick touches the lead's context.
//
//   node scripts/sweep-tick.mjs wait                      block until a source is due or "Barrer ahora" is pressed
//   node scripts/sweep-tick.mjs report <source> --new N [--watermark W] [--scan-since S]
//   node scripts/sweep-tick.mjs report <source> --error "msg" [--rate-limited]
//   node scripts/sweep-tick.mjs status
//   node scripts/sweep-tick.mjs force [--source slack|basecamp]...   the lead, on sweep.requested ("Barrer ahora")
//
// Every number lives in config/sweep.json. State per source lives in Mesa (`GET /api/sources`,
// `PATCH /api/sources/:name`: watermark, lastChecked, lastNewAt, health, errorCount, backoffUntil, lastError, cadenceS;
// plus `lastInteractionAt`, stamped only by Andrés's UI actions). Basecamp's `watermark` is compound,
// `<probe>|<scan>` (see splitMark): `--watermark` moves the probe part, `--scan-since` the full-notifications
// catch-up's own "since"; `wait`/`status` print them apart, with `fullScanEveryTicks` (config sources.basecamp,
// default 10). Mesa unreachable or erroring = `wait` reports
// `mesa_down` and `report` fails; there is no local fallback. Health (ok | degraded | down, down after downAfterErrors consecutive
// failures that are not rate limits) rides on the same PATCH and feeds the rail (Estados B); leaving "down" resumes
// salidas held for that source. "Barrer ahora" emits `sweep.requested` to the session "sweeper", which `wait`
// long-polls; `force` is the lead's manual equivalent.
//
// Cadence: during work hours every source is probed every activeIntervalSec; after idleAfterMin minutes with no new
// item and no interaction from Andrés it backs off to idleIntervalSec, and it snaps back on the next new item or
// interaction. A source that errors waits baseSec * factor^(errors-1), capped at maxSec, and is marked degraded.
// Outside work hours nothing is due except a forced sweep. One JSON line on stdout per call.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const loadConfig = (path = join(REPO, "config", "sweep.json")) => JSON.parse(readFileSync(path, "utf8"));
const FORCE_FLAG = join(tmpdir(), "mesa-team", "sweep-force.json");
const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const max = (...xs) => Math.max(...xs.filter((x) => Number.isFinite(x)), -Infinity);

// ---------- pure cadence ----------

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function inWorkHours(config, now) {
  const d = new Date(now);
  const day = d.getDay() === 0 ? 7 : d.getDay();
  const mins = d.getHours() * 60 + d.getMinutes();
  const w = config.workHours;
  return w.days.includes(day) && mins >= minutesOf(w.start) && mins < minutesOf(w.end);
}

// The next moment work hours start (or now, when inside them). Scans at most 8 days.
export function nextWorkStart(config, now) {
  if (inWorkHours(config, now)) return now;
  const [h, m] = config.workHours.start.split(":").map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (d.getTime() > now && inWorkHours(config, d.getTime())) return d.getTime();
  }
  return now + 24 * 3600_000;
}

export function intervalSec(config, state, now) {
  const lastActivity = max(ms(state.lastInteractionAt), ...Object.values(state.sources ?? {}).map((s) => ms(s.lastNewAt)));
  const idle = !Number.isFinite(lastActivity) || now - lastActivity >= config.idleAfterMin * 60_000;
  return idle ? config.idleIntervalSec : config.activeIntervalSec;
}

const enabled = (config) => Object.entries(config.sources).filter(([, s]) => s.enabled).map(([n]) => n);

// When each enabled source is next due (ms), honouring its backoff.
export function dueTimes(config, state, now) {
  const every = intervalSec(config, state, now) * 1000;
  const out = {};
  for (const name of enabled(config)) {
    const s = state.sources?.[name] ?? {};
    const byInterval = Number.isFinite(ms(s.lastChecked)) ? ms(s.lastChecked) + every : now;
    out[name] = max(byInterval, ms(s.backoffUntil), nextWorkStart(config, now));
  }
  return out;
}

export function dueSources(config, state, now, { forced = false } = {}) {
  if (forced) {
    // A forced sweep ignores the interval and work hours, never a backoff (a rate-limited source stays parked).
    return enabled(config).filter((n) => !(ms(state.sources?.[n]?.backoffUntil) > now));
  }
  if (!inWorkHours(config, now)) return [];
  const t = dueTimes(config, state, now);
  return Object.keys(t).filter((n) => t[n] <= now);
}

// ---------- compound watermark ----------
// `source_state.watermark` holds `<probe>` or `<probe>|<scan>`. The probe part is the stage 1 watermark every source
// uses. The scan part is the Basecamp catch-up's own "since" (the newest notification the last full
// get_my_notifications read saw); it must not move with the probe, or the probe would hide the very comments the
// catch-up exists for. Slack and Basecamp ISO timestamps never contain `|`, so the split is unambiguous.
export const DEFAULT_FULL_SCAN_EVERY_TICKS = 10;

export function splitMark(w) {
  const [probe = "", scan = ""] = String(w ?? "").split("|");
  return { probe: probe || null, scan: scan || null };
}

export function joinMark(probe, scan) {
  return scan ? `${probe ?? ""}|${scan}` : probe ?? null;
}

// How many Basecamp ticks pass between two full notification reads (config/sweep.json, sources.basecamp).
export function fullScanEveryTicks(config) {
  const n = Number(config.sources?.basecamp?.fullScanEveryTicks);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_FULL_SCAN_EVERY_TICKS;
}

export function applyReport(config, s = {}, report, now) {
  const iso = new Date(now).toISOString();
  if (report.error) {
    const errorCount = (s.errorCount ?? 0) + 1;
    const b = config.backoff;
    const waitSec = Math.min(b.maxSec, b.baseSec * b.factor ** (errorCount - 1));
    return {
      ...s,
      lastChecked: iso,
      errorCount,
      health: errorCount >= (config.downAfterErrors ?? 3) && !report.rateLimited ? "down" : "degraded",
      lastError: `${report.rateLimited ? "rate limited: " : ""}${report.error}`.slice(0, 300),
      backoffUntil: new Date(now + waitSec * 1000).toISOString(),
    };
  }
  const n = Number(report.new ?? 0);
  const prev = splitMark(s.watermark);
  const watermark = joinMark(report.watermark ? String(report.watermark) : prev.probe, report.scanSince ? String(report.scanSince) : prev.scan);
  return {
    ...s,
    lastChecked: iso,
    errorCount: 0,
    health: "ok",
    lastError: null,
    backoffUntil: null,
    ...(n > 0 ? { lastNewAt: iso } : {}),
    ...(report.watermark || report.scanSince ? { watermark } : {}),
  };
}

// ---------- store ----------

async function http(path, { method = "GET", body, fetchImpl, base, timeoutMs = 5000 }) {
  const res = await fetchImpl(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export function writeForce(sources, path = FORCE_FLAG) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), sources: sources?.length ? sources : null }));
  return { ok: true, forced: sources?.length ? sources : "all" };
}

function takeForce(path) {
  try {
    const f = JSON.parse(readFileSync(path, "utf8"));
    rmSync(path, { force: true });
    return { sources: f.sources ?? null };
  } catch {
    return null;
  }
}

const PATCH_KEYS = ["health", "note", "watermark", "lastChecked", "lastNewAt", "backoffUntil", "cadenceS", "errorCount", "lastError"];

export function makeStore({
  fetchImpl = fetch,
  base = (process.env.MESA_URL ?? "http://127.0.0.1:8790").replace(/\/$/, ""),
  forcePath = FORCE_FLAG,
  session = process.env.MESA_SWEEPER_SESSION ?? "sweeper",
} = {}) {
  let registered = false;
  return {
    kind: "mesa",
    async load() {
      const r = await http("/api/sources", { fetchImpl, base });
      if (r.status >= 400) throw new Error(`Mesa answered ${r.status} on GET /api/sources`);
      return { sources: r.data.sources ?? {}, lastInteractionAt: r.data.lastInteractionAt ?? null };
    },
    async save(name, s) {
      const body = Object.fromEntries(PATCH_KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
      const r = await http(`/api/sources/${encodeURIComponent(name)}`, { method: "PATCH", body, fetchImpl, base });
      if (r.status >= 400) throw new Error(`Mesa answered ${r.status} on PATCH /api/sources/${name}`);
    },
    // Blocks up to `sec`. Returns the forced sources when "Barrer ahora" was pressed (`sweep.requested` on the Mesa
    // session MESA_SWEEPER_SESSION, default "sweeper") or the lead dropped the force flag; null on timeout.
    async forcedWithin(sec, stepSec = 25) {
      const end = Date.now() + sec * 1000;
      if (!registered) {
        registered = true;
        await http("/api/sessions", { method: "POST", body: { id: session, label: "sweeper" }, fetchImpl, base }).catch(() => {});
      }
      for (;;) {
        const f = takeForce(forcePath);
        if (f) return f;
        const left = (end - Date.now()) / 1000;
        if (left <= 0) return null;
        const step = Math.max(1, Math.round(Math.min(stepSec, left)));
        try {
          const r = await http(`/api/wait?session=${encodeURIComponent(session)}&timeout=${step}`, { fetchImpl, base, timeoutMs: (step + 10) * 1000 });
          const events = Array.isArray(r.data?.events) ? r.data.events : null;
          if (!events) throw new Error(`wait answered ${r.status}`);
          if (events.length) await http("/api/wait/ack", { method: "POST", body: { session, cursor: r.data.cursor }, fetchImpl, base }).catch(() => {});
          const ev = events.find((e) => e.kind === "sweep.requested");
          if (ev) return { sources: ev.payload?.sources ?? null };
        } catch {
          await new Promise((r) => setTimeout(r, Math.min(5000, Math.max(0, end - Date.now()))));
        }
      }
    },
  };
}

// ---------- commands ----------

export async function wait(config, store, { now = Date.now, maxSec = config.waitMaxSec } = {}) {
  const until = now() + maxSec * 1000;
  for (;;) {
    let state;
    try {
      state = await store.load();
    } catch (err) {
      return { due: false, reason: "mesa_down", error: err.message, store: store.kind };
    }
    const due = dueSources(config, state, now());
    if (due.length) return { due: true, forced: false, sources: due, intervalSec: intervalSec(config, state, now()), store: store.kind, watermarks: marks(state, due), ...scanInfo(config, state, due) };
    const left = until - now();
    if (left <= 0) return { due: false, reason: "timeout", store: store.kind };
    const next = Math.min(...Object.values(dueTimes(config, state, now())), until);
    const sec = Math.max(1, Math.min((next - now()) / 1000, left / 1000));
    const f = await store.forcedWithin(sec, config.longPollSec);
    if (f) {
      const st = await store.load();
      const forced = dueSources(config, st, now(), { forced: true }).filter((n) => !f.sources || f.sources.includes(n));
      return { due: forced.length > 0, forced: true, sources: forced, intervalSec: config.activeIntervalSec, store: store.kind, watermarks: marks(st, forced), ...scanInfo(config, st, forced) };
    }
  }
}

const marks = (state, names) => Object.fromEntries(names.map((n) => [n, splitMark(state.sources?.[n]?.watermark).probe]));

// Basecamp catch-up info for the sweeper: how often to run it and the "since" of the previous one: the scan part
// of the watermark, else the probe part (so the first catch-up after the scan window existed does not read every
// unread as new), else null (Basecamp never probed). Only when Basecamp is among `names`.
const scanInfo = (config, state, names) => {
  if (!names.includes("basecamp")) return {};
  const { scan, probe } = splitMark(state.sources?.basecamp?.watermark);
  return { fullScanEveryTicks: fullScanEveryTicks(config), scanSince: { basecamp: scan ?? probe ?? null } };
};

export async function report(config, store, name, rep, { now = Date.now } = {}) {
  if (!config.sources[name]) throw new Error(`unknown source ${name}`);
  const state = await store.load();
  const next = applyReport(config, state.sources?.[name], rep, now());
  next.cadenceS = intervalSec(config, { ...state, sources: { ...(state.sources ?? {}), [name]: next } }, now());
  await store.save(name, next);
  state.sources = { ...(state.sources ?? {}), [name]: next };
  return { ok: true, source: name, state: next, intervalSec: intervalSec(config, state, now()), store: store.kind };
}

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      opt[k] = k in opt ? [].concat(opt[k], v) : v;
    } else pos.push(argv[i]);
  }
  return { pos, opt };
}

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const store = makeStore();
  let out;
  if (pos[0] === "wait") out = await wait(config, store);
  else if (pos[0] === "report") {
    out = await report(config, store, pos[1], { new: opt.new, watermark: opt.watermark, scanSince: opt["scan-since"], error: opt.error === true ? "error" : opt.error, rateLimited: !!opt["rate-limited"] });
  } else if (pos[0] === "force") {
    out = writeForce([].concat(opt.source ?? []).filter((x) => x !== true));
  } else if (pos[0] === "status") {
    const state = await store.load();
    out = { state, intervalSec: intervalSec(config, state, Date.now()), due: dueTimes(config, state, Date.now()), inWorkHours: inWorkHours(config, Date.now()), store: store.kind, ...scanInfo(config, state, ["basecamp"]) };
  } else throw new Error("usage: sweep-tick.mjs wait | report <source> --new N [--watermark W] [--scan-since S] | report <source> --error MSG [--rate-limited] | status | force [--source S]");
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: err.message })}\n`);
    process.exit(1);
  });
}
