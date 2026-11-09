import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { autostartPlan, cloudflaredPaths, startTunnel, waitListening } from "../lib/autostart.mjs";
import { buildEnv, gitShortSha } from "../lib/build-info.mjs";

const ID = "608cbd6c-7484-4018-b048-ac60239ac7b9";
const ENV = { MESA_PUBLIC_URL: "https://mesa.example.com", MESA_CF_TUNNEL: "mesa", MESA_CF_DIR: "/cf" };
const listJson = (connections = 0) => JSON.stringify([{ id: ID, name: "mesa", deleted_at: "0001-01-01T00:00:00Z", connections: Array.from({ length: connections }, () => ({})) }]);

test("autostartPlan: pnpm start with the public URL and the tunnel name", () => {
  assert.deepEqual(autostartPlan(ENV, "start"), { enabled: true, hostname: "mesa.example.com", tunnel: "mesa" });
});

test("autostartPlan: not configured means off, quietly", () => {
  assert.equal(autostartPlan({}, "start").enabled, false);
  assert.equal(autostartPlan({ MESA_PUBLIC_URL: "https://mesa.example.com" }, "start").enabled, false, "no MESA_CF_TUNNEL");
  assert.equal(autostartPlan({ MESA_CF_TUNNEL: "mesa" }, "start").enabled, false, "no MESA_PUBLIC_URL");
  assert.equal(autostartPlan({ ...ENV, MESA_PUBLIC_URL: "http://mesa.example.com" }, "start").enabled, false, "https only");
});

test("autostartPlan: pnpm dev only with MESA_TUNNEL=on; MESA_TUNNEL=off beats everything", () => {
  assert.equal(autostartPlan(ENV, "dev").enabled, false);
  assert.equal(autostartPlan({ ...ENV, MESA_TUNNEL: "on" }, "dev").enabled, true);
  assert.equal(autostartPlan({ MESA_PUBLIC_URL: ENV.MESA_PUBLIC_URL, MESA_TUNNEL: "ON" }, "dev").tunnel, "mesa", "name defaults to mesa");
  assert.equal(autostartPlan({ ...ENV, MESA_TUNNEL: "off" }, "start").enabled, false);
  assert.equal(autostartPlan({ ...ENV, MESA_TUNNEL: "off" }, "dev").enabled, false);
});

test("cloudflaredPaths: ~/.cloudflared by default, MESA_CF_DIR for tests", () => {
  assert.equal(cloudflaredPaths({}, "mesa", "/home/a").config.replace(/\\/g, "/"), "/home/a/.cloudflared/mesa-mesa.yml");
  const p = cloudflaredPaths({ MESA_CF_DIR: "/tmp/x" }, "mesa");
  assert.match(p.pidfile.replace(/\\/g, "/"), /^\/tmp\/x\/mesa-mesa\.pid$/);
});

test("waitListening: true as soon as the port accepts, false after the timeout", async () => {
  let n = 0;
  assert.equal(await waitListening(1, "127.0.0.1", { connect: async () => ++n >= 3, sleep: async () => {}, timeoutMs: 1000 }), true);
  assert.equal(n, 3);
  assert.equal(await waitListening(1, "127.0.0.1", { connect: async () => false, sleep: async () => {}, timeoutMs: 0 }), false);
});

/** A fake world: scripted cloudflared, probe and child process; records every side effect. */
function world(over = {}) {
  const w = {
    lines: [],
    spawned: [],
    killed: 0,
    writes: [],
    removed: [],
    stoppedExisting: 0,
    probes: [],
    files: new Map(),
    child: null,
    cfCalls: [],
    ...over,
  };
  const deps = {
    waitListening: async () => w.listening ?? true,
    cf: (argv) => {
      w.cfCalls.push(argv.join(" "));
      if (argv[0] === "--version") return w.noCf ? { found: false, code: 127 } : { found: true, file: "cloudflared", code: 0, stdout: "cloudflared 2026.1.0" };
      return { found: true, code: w.listCode ?? 0, stdout: w.listOut ?? listJson(w.connections ?? 0), stderr: "" };
    },
    exists: (p) => (p.endsWith(`${ID}.json`) ? !w.noCreds : w.files.has(p)),
    mkdir: () => {},
    write: (p, text) => (w.writes.push(p), w.files.set(p, String(text))),
    read: (p) => w.files.get(p) ?? "",
    remove: (p) => (w.removed.push(p), w.files.delete(p)),
    pidAlive: () => w.pidAlive ?? false,
    serviceState: () => w.service ?? "absent",
    stopExisting: () => void w.stoppedExisting++,
    probe: async () => {
      w.probes.push(1);
      const seq = w.probeSeq ?? ["access"];
      return seq[Math.min(w.probes.length - 1, seq.length - 1)];
    },
    sleep: async () => {},
    spawn: (exe, args, opts) => {
      const child = Object.assign(new EventEmitter(), { pid: 4242, kill: () => void w.killed++ });
      w.child = child;
      w.spawned.push({ exe, args, opts });
      if (w.spawnThrows) throw new Error("spawn EACCES");
      return child;
    },
  };
  return { w, deps, run: (plan = { enabled: true, hostname: "mesa.example.com", tunnel: "mesa" }) => startTunnel({ plan, env: ENV, port: 8799, log: (l) => w.lines.push(l), deps }) };
}

test("starts cloudflared as a child after the server listens, and reports Access in front", async () => {
  const { w, run } = world();
  const t = run();
  await t.done;
  assert.equal(w.spawned.length, 1);
  assert.deepEqual(w.spawned[0].args.slice(0, 1), ["tunnel"]);
  assert.deepEqual(w.spawned[0].args.slice(-2), ["run", "mesa"]);
  assert.equal(w.spawned[0].opts.detached, undefined, "a child, never detached");
  assert.ok(w.writes.some((p) => p.endsWith("mesa-mesa.yml")), "config written");
  assert.equal(w.lines.length, 1);
  assert.match(w.lines[0], /^tunnel: up at https:\/\/mesa\.example\.com, behind Cloudflare Access/);
  t.stop();
  assert.equal(w.killed, 1, "stop kills the child");
  assert.ok(w.removed.some((p) => p.endsWith("mesa-mesa.pid")), "pidfile removed");
});

test("does nothing before the server listens, and stop() before then starts nothing", async () => {
  const a = world({ listening: false });
  const ta = a.run();
  await ta.done;
  assert.equal(a.w.spawned.length, 0);
  assert.equal(a.w.cfCalls.length, 0);
  assert.match(a.w.lines[0], /never started listening/);

  const b = world();
  const tb = b.run();
  tb.stop(); // synchronously, before the first await resolves
  await tb.done;
  assert.equal(b.w.spawned.length, 0);
});

test("reuses a tunnel with a local connector: no second one, not stopped with the board", async () => {
  for (const over of [{ pidAlive: true }, { service: "running" }, { connections: 2, pidAlive: true }, { connections: 2, service: "running" }]) {
    const { w, run } = world(over);
    const t = run();
    await t.done;
    assert.equal(w.spawned.length, 0, JSON.stringify(over));
    assert.match(w.lines[0], /reusing the tunnel/);
    assert.equal(w.lines.length, 1, "no stale line when a local connector is alive");
    t.stop();
    assert.equal(w.killed, 0, "a tunnel we did not start is not ours to kill");
    assert.equal(w.stoppedExisting, 0);
  }
});

test("connections listed by Cloudflare with no local connector look stale: own child, one stale line, stops with the board", async () => {
  const { w, run } = world({ connections: 2 });
  const t = run();
  await t.done;
  assert.equal(w.spawned.length, 1, "a second connector is allowed");
  const stale = w.lines.filter((l) => /look stale/.test(l));
  assert.equal(stale.length, 1);
  assert.match(stale[0], /2 connection\(s\)/);
  assert.ok(!w.lines.some((l) => /reusing/.test(l)));
  t.stop();
  assert.equal(w.killed, 1, "the child stops with the board");
});

test("no connections and no local connector: own child, no stale line", async () => {
  const { w, run } = world({ connections: 0 });
  const t = run();
  await t.done;
  assert.equal(w.spawned.length, 1);
  assert.ok(!w.lines.some((l) => /stale/.test(l)));
  t.stop();
});

test("Access probe guard: Mesa answering the public URL before start blocks the tunnel", async () => {
  const { w, run } = world({ probeSeq: ["mesa"] });
  const t = run();
  await t.done;
  assert.equal(w.spawned.length, 0);
  assert.equal(w.lines.length, 1);
  assert.match(w.lines[0], /without Cloudflare Access/);
});

test("Access probe guard: a running local tunnel that exposes Mesa is stopped", async () => {
  for (const over of [{ pidAlive: true }, { service: "running" }]) {
    const { w, run } = world({ connections: 1, probeSeq: ["mesa"], ...over });
    const t = run();
    await t.done;
    assert.equal(w.stoppedExisting, 1);
    assert.match(w.lines[0], /stopped the running tunnel/);
  }
});

test("Access probe guard: remote connections alone stop nothing local and start nothing", async () => {
  const { w, run } = world({ connections: 1, probeSeq: ["mesa"] });
  const t = run();
  await t.done;
  assert.equal(w.stoppedExisting, 0);
  assert.equal(w.spawned.length, 0);
  assert.match(w.lines[0], /not starting the tunnel/);
});

test("Access probe guard: if Mesa answers once our child is up, the child is stopped (one line)", async () => {
  const { w, run } = world({ probeSeq: ["unreachable", "unreachable", "mesa"] });
  const t = run();
  await t.done;
  assert.equal(w.spawned.length, 1);
  assert.equal(w.killed, 1);
  assert.equal(w.lines.length, 1);
  assert.match(w.lines[0], /tunnel stopped/);
});

test("a tunnel that never shows Access keeps running with one honest line", async () => {
  const { w, run } = world({ probeSeq: ["unreachable"] });
  const t = run();
  await t.done;
  assert.equal(w.killed, 0);
  assert.equal(w.lines.length, 1);
  assert.match(w.lines[0], /not confirmed yet \(probe: unreachable\)/);
  t.stop();
});

test("never fails the board: every problem is one log line, no throw", async () => {
  const cases = [
    [{ noCf: true }, /cloudflared not found/],
    [{ listCode: 1 }, /could not list tunnels/],
    [{ listOut: "[]" }, /not found in this Cloudflare account/],
    [{ noCreds: true }, /credentials file/],
    [{ spawnThrows: true }, /could not start \(spawn EACCES\)/],
  ];
  for (const [over, re] of cases) {
    const { w, run } = world(over);
    const t = run();
    await t.done;
    assert.equal(w.lines.length, 1, JSON.stringify(over));
    assert.match(w.lines[0], re);
    assert.equal(w.spawned.filter(() => !over.spawnThrows).length, 0, JSON.stringify(over));
  }
});

test("cloudflared exiting later is one line and the board is untouched", async () => {
  const { w, run } = world();
  const t = run();
  await t.done;
  w.child.emit("exit", 1);
  assert.equal(w.lines.length, 2);
  assert.match(w.lines[1], /cloudflared exited \(code 1\)/);
  t.stop();
  assert.equal(w.killed, 0, "already gone: nothing to kill");
});

test("a spawn error event (cloudflared vanished) is one line", async () => {
  const { w, run } = world({ probeSeq: ["unreachable"] });
  const t = run();
  await t.done;
  w.child.emit("error", Object.assign(new Error("x"), { code: "ENOENT" }));
  assert.ok(w.lines.some((l) => /could not start cloudflared \(ENOENT\)/.test(l)));
});

test("buildEnv: git sha + start time, explicit env wins, git failure reads as empty", () => {
  const spawn = () => ({ status: 0, stdout: "07e984f\n" });
  const e = buildEnv({}, "/repo", new Date("2026-11-09T18:00:00Z"), spawn);
  assert.deepEqual(e, { MESA_BUILD_SHA: "07e984f", MESA_STARTED_AT: "2026-11-09T18:00:00.000Z" });
  assert.equal(buildEnv({ MESA_BUILD_SHA: "abc1234" }, "/repo", new Date(), spawn).MESA_BUILD_SHA, "abc1234");
  assert.equal(gitShortSha("/repo", () => ({ status: 128, stdout: "" })), "");
  assert.equal(gitShortSha("/repo", () => ({ status: 0, stdout: "not a sha" })), "");
  assert.equal(gitShortSha("/repo", () => { throw new Error("no git"); }), "");
});
