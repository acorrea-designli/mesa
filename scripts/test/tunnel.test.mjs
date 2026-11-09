import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isLoopbackBind, pickHost } from "../lib/host.mjs";
import { isCloudflaredImage, pidAlive } from "../lib/cloudflared.mjs";
import { MESA_TARGET, buildConfig, classifyProbe, describe, hostFromPublicUrl, parseServiceState, parseTunnelList, reuseDecision, statusExitCode, tunnelName } from "../lib/tunnel.mjs";

const ID = "6ff42ae2-765d-4adf-8112-31c55c1551ef";

test("reuseDecision: only a local connector means reuse; remote connections alone are stale", () => {
  assert.deepEqual(reuseDecision({ connections: 0, pidAlive: true }), { reuse: true, staleRemote: false });
  assert.deepEqual(reuseDecision({ connections: 0, service: "running" }), { reuse: true, staleRemote: false });
  assert.deepEqual(reuseDecision({ connections: 3, pidAlive: true }), { reuse: true, staleRemote: false });
  assert.deepEqual(reuseDecision({ connections: 3, service: "stopped" }), { reuse: false, staleRemote: true });
  assert.deepEqual(reuseDecision({ connections: 0 }), { reuse: false, staleRemote: false });
});

const tasklist = (stdout) => () => ({ status: 0, stdout });

test("isCloudflaredImage: the tasklist row must name cloudflared with that PID", () => {
  assert.equal(isCloudflaredImage(4242, { spawn: tasklist('"cloudflared.exe","4242","Console","1","30,000 K"\r\n') }), true);
  assert.equal(isCloudflaredImage(4242, { spawn: tasklist('"chrome.exe","4242","Console","1","30,000 K"\r\n') }), false, "PID reused by another program");
  assert.equal(isCloudflaredImage(4242, { spawn: tasklist("INFO: No tasks are running which match the specified criteria.\r\n") }), false);
  assert.equal(isCloudflaredImage(4242, { spawn: () => { throw new Error("no tasklist"); } }), false);
});

test("pidAlive: windows needs a live cloudflared image; elsewhere kill 0 is enough", () => {
  const read = () => "4242";
  const kill = () => true;
  const dead = () => { throw Object.assign(new Error("ESRCH"), { code: "ESRCH" }); };
  const cf = tasklist('"cloudflared.exe","4242","Console","1","30,000 K"\n');
  const other = tasklist('"notepad.exe","4242","Console","1","30,000 K"\n');
  assert.equal(pidAlive("p", { read, kill, platform: "win32", spawn: cf }), true);
  assert.equal(pidAlive("p", { read, kill, platform: "win32", spawn: other }), false, "live PID that is not cloudflared");
  assert.equal(pidAlive("p", { read, kill: dead, platform: "win32", spawn: cf }), false);
  assert.equal(pidAlive("p", { read, kill, platform: "linux", spawn: other }), true);
  assert.equal(pidAlive("p", { read: () => "", kill, platform: "linux" }), false);
});

test("hostFromPublicUrl: the hostname of MESA_PUBLIC_URL, https only", () => {
  assert.equal(hostFromPublicUrl("https://mesa.example.com"), "mesa.example.com");
  assert.equal(hostFromPublicUrl(" https://mesa.example.com/ "), "mesa.example.com");
  for (const bad of [undefined, "", "  ", "http://mesa.example.com", "mesa.example.com", "https://localhost", "junk"]) {
    assert.equal(hostFromPublicUrl(bad), null, String(bad));
  }
});

test("tunnelName: MESA_CF_TUNNEL, default mesa", () => {
  assert.equal(tunnelName({}), "mesa");
  assert.equal(tunnelName({ MESA_CF_TUNNEL: "  " }), "mesa");
  assert.equal(tunnelName({ MESA_CF_TUNNEL: "andres-mesa" }), "andres-mesa");
});

test("buildConfig: hostname -> Mesa on loopback, then a catch-all 404, credentials by path only", () => {
  const cfg = buildConfig({ tunnel: "mesa", uuid: ID, credentialsFile: "C:\\Users\\a\\.cloudflared\\" + ID + ".json", hostname: "mesa.example.com" });
  assert.match(cfg, new RegExp(`^tunnel: '${ID}'$`, "m"));
  assert.match(cfg, /^credentials-file: 'C:\\Users\\a\\\.cloudflared\\[0-9a-f-]+\.json'$/m);
  const lines = cfg.split("\n");
  const rule = lines.indexOf("  - hostname: 'mesa.example.com'");
  assert.ok(rule > 0);
  assert.equal(lines[rule + 1], `    service: ${MESA_TARGET}`);
  assert.equal(lines[rule + 2], "  - service: http_status:404"); // the catch-all is last
  assert.equal(lines.filter((l) => l.includes("service:")).length, 2);
  assert.ok(!/TunnelSecret|AccountTag|token/i.test(cfg), "no credential content");
});

test("parseTunnelList: finds the live tunnel by name and counts connections", () => {
  const list = JSON.stringify([
    { id: "x", name: "old", connections: [] },
    { id: ID, name: "mesa", connections: [{ colo_name: "mia01" }, { colo_name: "mia02" }] },
  ]);
  assert.deepEqual(parseTunnelList(list, "mesa"), { id: ID, name: "mesa", connections: 2 });
  assert.equal(parseTunnelList(list, "nope"), null);
  assert.equal(parseTunnelList(JSON.stringify([{ id: ID, name: "mesa", deleted_at: "2026-01-01" }]), "mesa"), null);
  assert.deepEqual(parseTunnelList(JSON.stringify([{ id: ID, name: "mesa" }]), "mesa"), { id: ID, name: "mesa", connections: 0 });
  assert.deepEqual(parseTunnelList(JSON.stringify([{ id: ID, name: "mesa", deleted_at: "0001-01-01T00:00:00Z", connections: [] }]), "mesa"), { id: ID, name: "mesa", connections: 0 });
  assert.equal(parseTunnelList("not json", "mesa"), null);
  assert.equal(parseTunnelList("{}", "mesa"), null);
});

test("parseServiceState: sc query output", () => {
  assert.equal(parseServiceState("SERVICE_NAME: Cloudflared\n        TYPE : 10  WIN32_OWN_PROCESS\n        STATE              : 4  RUNNING", 0), "running");
  assert.equal(parseServiceState("        STATE              : 1  STOPPED", 0), "stopped");
  assert.equal(parseServiceState("        STATE              : 2  START_PENDING", 0), "other");
  assert.equal(parseServiceState("[SC] EnumQueryServicesStatus:OpenService FAILED 1060:\nThe specified service does not exist as an installed service.", 1060), "absent");
  assert.equal(parseServiceState("", 1), "absent");
});

test("classifyProbe: an Access redirect or a Cloudflare 403 is the only good answer", () => {
  const redirect = { status: 302, headers: { server: "cloudflare" }, location: "https://acme.cloudflareaccess.com/cdn-cgi/access/login/mesa.example.com?kid=abc" };
  assert.equal(classifyProbe(redirect), "access");
  assert.equal(classifyProbe({ status: 302, headers: {}, location: "https://mesa.example.com/cdn-cgi/access/login/x" }), "access");
  assert.equal(classifyProbe({ status: 403, headers: { server: "cloudflare" } }), "access");
});

test("classifyProbe: any answer from Mesa is bad", () => {
  assert.equal(classifyProbe({ status: 403, headers: { "x-mesa-guard": "1", server: "cloudflare" } }), "mesa"); // our guard, even through Cloudflare
  assert.equal(classifyProbe({ status: 401, headers: { "x-mesa-guard": "1" } }), "mesa");
  assert.equal(classifyProbe({ status: 200, headers: { "x-powered-by": "Next.js" } }), "mesa");
  assert.equal(classifyProbe({ status: 200, headers: {} }), "mesa");
  assert.equal(classifyProbe({ status: 404, headers: { "x-powered-by": "Next.js" } }), "mesa");
  // a redirect that is not Access's does not count as Access
  assert.equal(classifyProbe({ status: 302, headers: {}, location: "https://elsewhere.example/" }), "unknown");
});

test("classifyProbe: no answer or Cloudflare tunnel errors mean the tunnel is not up", () => {
  assert.equal(classifyProbe({ error: true }), "unreachable");
  assert.equal(classifyProbe(null), "unreachable");
  for (const status of [502, 530]) assert.equal(classifyProbe({ status, headers: { server: "cloudflare" } }), "unreachable");
  assert.equal(classifyProbe({ status: 404, headers: { server: "cloudflare" } }), "unknown"); // the catch-all 404: no Access in front proven
});

test("statusExitCode: 0 only when installed, connected and Access is proven; 3 when Mesa answers directly", () => {
  const ok = { installed: true, hostname: "mesa.example.com", tunnel: { connections: 2 }, service: "absent", pid: false, probe: "access" };
  assert.equal(statusExitCode(ok), 0);
  assert.equal(statusExitCode({ ...ok, tunnel: { connections: 0 }, service: "running" }), 0);
  assert.equal(statusExitCode({ ...ok, tunnel: null, pid: true }), 0);
  assert.equal(statusExitCode({ ...ok, tunnel: { connections: 0 } }), 1); // nothing connected
  assert.equal(statusExitCode({ ...ok, installed: false }), 1);
  assert.equal(statusExitCode({ ...ok, hostname: null }), 1);
  for (const probe of ["unreachable", "unknown", "skipped"]) assert.equal(statusExitCode({ ...ok, probe }), 1, probe);
  assert.equal(statusExitCode({ ...ok, probe: "mesa" }), 3);
  assert.equal(statusExitCode({ ...ok, installed: false, probe: "mesa" }), 3);
});

test("describe: says when cloudflared is missing and shouts when Mesa answers without Access", () => {
  assert.match(describe({ installed: false })[0], /no está instalado/);
  const lines = describe({ installed: true, hostname: "mesa.example.com", tunnel: { name: "mesa", connections: 1 }, service: "running", probe: "mesa" });
  assert.ok(lines.some((l) => l.includes("MESA RESPONDE SIN ACCESS")));
  assert.ok(lines.some((l) => l.includes("https://mesa.example.com")));
  assert.ok(describe({ installed: true, hostname: null, tunnel: null, service: "absent", probe: "skipped" }).some((l) => l.includes("MESA_PUBLIC_URL")));
});

test("pickHost: loopback by default, MESA_HOST overrides", () => {
  assert.equal(pickHost({}), "127.0.0.1");
  assert.equal(pickHost({ MESA_HOST: "  " }), "127.0.0.1");
  assert.equal(pickHost({ MESA_HOST: "0.0.0.0" }), "0.0.0.0");
  assert.equal(isLoopbackBind("127.0.0.1"), true);
  assert.equal(isLoopbackBind("0.0.0.0"), false);
});

test("pnpm tunnel with an unknown command exits 2", () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("../tunnel.mjs", import.meta.url)), "bogus"], { encoding: "utf8" });
  assert.equal(r.status, 2);
});
