// Tunnel autostart for `pnpm start` (scripts/serve.mjs): the cloudflared tunnel comes up as a CHILD of the board's
// process once the server is listening, and goes down with it. Never a reason for the board to fail: every problem
// is ONE log line and the board keeps running.
//
// Same rules as `pnpm tunnel up` (scripts/tunnel.mjs), so the two agree:
//  - the Access probe guard: if https://<host>/ answers from Mesa without Cloudflare Access, nothing is exposed;
//    a tunnel this process started is stopped, a running one is stopped too (service or pidfile);
//  - a tunnel with a LOCAL connector (a live cloudflared in the pidfile from `pnpm tunnel up`, or the Windows
//    service) is reused, not doubled, and is not ours to stop when the board exits. Connections that only Cloudflare
//    lists never count: they linger ~1 min after a connector dies, so then we start our own child.
// Everything with side effects arrives through `deps`, so the tests use fakes and touch neither cloudflared, the
// network nor ~/.cloudflared.
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { pidAlive, probePublic, runCloudflared, serviceState, stopRunningTunnel } from "./cloudflared.mjs";
import { WINDOWS_SERVICE, buildConfig, hostFromPublicUrl, parseTunnelList, reuseDecision, tunnelName } from "./tunnel.mjs";

const PROBE_TRIES = 10;
const PROBE_EVERY_MS = 3000;

/**
 * Should this run start the tunnel? `mode` is "dev" or "start" (serve.mjs).
 *  - MESA_TUNNEL=off: never. MESA_TUNNEL=on: also in dev, and without MESA_CF_TUNNEL (the name defaults to "mesa").
 *  - `start`: needs MESA_PUBLIC_URL (an https hostname) and MESA_CF_TUNNEL.
 *  - `dev`: only with MESA_TUNNEL=on (and the public URL).
 */
export function autostartPlan(env, mode) {
  const flag = env.MESA_TUNNEL?.trim().toLowerCase();
  if (flag === "off") return { enabled: false, reason: "MESA_TUNNEL=off" };
  if (mode !== "start" && flag !== "on") return { enabled: false, reason: "dev without MESA_TUNNEL=on" };
  const hostname = hostFromPublicUrl(env.MESA_PUBLIC_URL);
  if (!hostname) return { enabled: false, reason: "no https MESA_PUBLIC_URL" };
  if (!env.MESA_CF_TUNNEL?.trim() && flag !== "on") return { enabled: false, reason: "no MESA_CF_TUNNEL" };
  return { enabled: true, hostname, tunnel: tunnelName(env) };
}

/** Where the config and the pidfile live: the same files `pnpm tunnel up` uses. MESA_CF_DIR exists for the tests. */
export function cloudflaredPaths(env, tunnel, home = homedir()) {
  const dir = env.MESA_CF_DIR?.trim() || join(home, ".cloudflared");
  return { dir, config: join(dir, `${tunnel}-mesa.yml`), pidfile: join(dir, `${tunnel}-mesa.pid`) };
}

/** Resolves true once something accepts TCP on host:port, false after `timeoutMs`. */
export async function waitListening(port, host, { timeoutMs = 120_000, everyMs = 500, connect = tryConnect, sleep = delay } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await connect(port, host)) return true;
    if (Date.now() >= end) return false;
    await sleep(everyMs);
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function tryConnect(port, host) {
  return new Promise((resolve) => {
    const s = net.connect({ port: Number(port), host });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => (s.destroy(), resolve(false)));
  });
}

function realDeps(env, paths) {
  return {
    cf: (argv) => runCloudflared(argv),
    probe: (hostname) => probePublic(hostname),
    spawn: nodeSpawn,
    exists: existsSync,
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    write: writeFileSync,
    read: (p) => readFileSync(p, "utf8"),
    remove: (p) => rmSync(p, { force: true }),
    pidAlive: () => pidAlive(paths.pidfile),
    serviceState: () => serviceState(WINDOWS_SERVICE),
    stopExisting: () => stopRunningTunnel(paths.pidfile, WINDOWS_SERVICE),
    waitListening,
    sleep: delay,
  };
}

/**
 * Starts the tunnel for an enabled plan. Returns at once with { stop(), done }: `stop()` is safe to call any time
 * (before the server listens, mid-probe, after) and kills the child this call started; `done` resolves when the
 * startup sequence ended, whatever the outcome, and never rejects.
 */
export function startTunnel({ plan, env = process.env, port, host = "127.0.0.1", log = console.log, deps: override = {} }) {
  const paths = cloudflaredPaths(env, plan.tunnel);
  const d = { ...realDeps(env, paths), ...override };
  const ctl = { child: null, stopped: false };
  const say = (msg) => log(`tunnel: ${msg}`);

  const stop = () => {
    ctl.stopped = true;
    const child = ctl.child;
    ctl.child = null;
    if (child) {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      removeOwnPidfile(child.pid);
    }
  };

  function removeOwnPidfile(pid) {
    try {
      if (pid && d.exists(paths.pidfile) && String(d.read(paths.pidfile)).trim() === String(pid)) d.remove(paths.pidfile);
    } catch {
      /* best effort */
    }
  }

  async function run() {
    if (!(await d.waitListening(port, host))) return say(`the board never started listening on ${host}:${port}; not starting the tunnel`);
    if (ctl.stopped) return;

    const v = d.cf(["--version"]);
    if (!v.found || v.code !== 0) return say("cloudflared not found; the board runs without the tunnel");

    const list = d.cf(["tunnel", "list", "--name", plan.tunnel, "--output", "json"]);
    if (list.code !== 0) return say(`cloudflared could not list tunnels (not logged in?); the board runs without the tunnel`);
    const t = parseTunnelList(list.stdout, plan.tunnel);
    if (!t) return say(`tunnel "${plan.tunnel}" not found in this Cloudflare account; the board runs without the tunnel`);
    const credentialsFile = join(paths.dir, `${t.id}.json`);
    if (!d.exists(credentialsFile)) return say(`credentials file for "${plan.tunnel}" missing in ${paths.dir}; the board runs without the tunnel`);

    const { reuse: running, staleRemote } = reuseDecision({ connections: t.connections, pidAlive: d.pidAlive(), service: d.serviceState() });
    const before = await d.probe(plan.hostname);
    if (ctl.stopped) return;
    if (before === "mesa") {
      if (running) d.stopExisting();
      return say(`https://${plan.hostname}/ answers from Mesa without Cloudflare Access: ${running ? "stopped the running tunnel" : "not starting the tunnel"}; create the Access app first`);
    }
    if (running) return say(`reusing the tunnel "${plan.tunnel}" that is already connected (${plan.hostname})`);
    if (staleRemote) say(`Cloudflare lists ${t.connections} connection(s) for "${plan.tunnel}" but no local cloudflared runs: they look stale; starting our own`);

    d.mkdir(paths.dir);
    d.write(paths.config, buildConfig({ tunnel: plan.tunnel, uuid: t.id, credentialsFile, hostname: plan.hostname }));

    const exe = v.file ?? "cloudflared";
    const child = d.spawn(exe, ["tunnel", "--config", paths.config, "run", plan.tunnel], { stdio: "ignore", windowsHide: true });
    ctl.child = child;
    child.on("error", (e) => {
      if (ctl.child === child) ctl.child = null;
      say(`could not start cloudflared (${e?.code ?? e?.message ?? "error"}); the board keeps running`);
    });
    child.on("exit", (code) => {
      removeOwnPidfile(child.pid);
      if (ctl.child === child) {
        ctl.child = null;
        say(`cloudflared exited (code ${code ?? "?"}); the board keeps running without the tunnel`);
      }
    });
    if (child.pid) d.write(paths.pidfile, String(child.pid));
    if (ctl.stopped) return stop();

    let after = "unreachable";
    for (let i = 0; i < PROBE_TRIES; i++) {
      await d.sleep(PROBE_EVERY_MS);
      if (ctl.stopped || ctl.child !== child) return;
      after = await d.probe(plan.hostname);
      if (after === "access" || after === "mesa") break;
    }
    if (ctl.stopped || ctl.child !== child) return;
    if (after === "mesa") {
      stop();
      return say(`https://${plan.hostname}/ answered from Mesa without Cloudflare Access; tunnel stopped; create the Access app first`);
    }
    say(after === "access" ? `up at https://${plan.hostname}, behind Cloudflare Access` : `started, but https://${plan.hostname} is not confirmed yet (probe: ${after})`);
  }

  const done = run().catch((e) => say(`could not start (${e?.message ?? e}); the board keeps running`));
  return { stop, done };
}

/** One call for serve.mjs: plan, start, and the log line when the plan says no (silent: not configured is not news). */
export function maybeStartTunnel({ env = process.env, mode, port, host, log = console.log, deps }) {
  const plan = autostartPlan(env, mode);
  if (!plan.enabled) return { stop() {}, done: Promise.resolve(), plan };
  return { ...startTunnel({ plan, env, port, host, log, deps }), plan };
}

