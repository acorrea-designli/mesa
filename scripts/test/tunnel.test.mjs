import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isLoopbackBind, pickHost } from "../lib/host.mjs";
import { MESA_TARGET, SERVE_ARGS, analyzeServe, describe, statusExitCode } from "../lib/tunnel.mjs";

const serveJson = (extra = {}) =>
  JSON.stringify({
    TCP: { 443: { HTTPS: true } },
    Web: { "pc.tail1234.ts.net:443": { Handlers: { "/": { Proxy: MESA_TARGET } } } },
    ...extra,
  });

test("analyzeServe: Mesa served, Funnel off", () => {
  const s = analyzeServe(serveJson());
  assert.equal(s.mesa, true);
  assert.equal(s.funnel, false);
  assert.equal(s.serving[0].host, "pc.tail1234.ts.net:443");
});

test("analyzeServe: Funnel on is detected", () => {
  const s = analyzeServe(serveJson({ AllowFunnel: { "pc.tail1234.ts.net:443": true } }));
  assert.equal(s.funnel, true);
  assert.deepEqual(s.funnelHosts, ["pc.tail1234.ts.net:443"]);
  assert.equal(statusExitCode({ ...s, installed: true, running: true }), 3);
});

test("analyzeServe: AllowFunnel false and empty config are not Funnel", () => {
  assert.equal(analyzeServe(serveJson({ AllowFunnel: { "pc.tail1234.ts.net:443": false } })).funnel, false);
  const empty = analyzeServe("{}");
  assert.equal(empty.mesa, false);
  assert.equal(empty.funnel, false);
  assert.equal(analyzeServe("").mesa, false);
});

test("analyzeServe: another target is not Mesa, junk is reported", () => {
  const other = analyzeServe(JSON.stringify({ Web: { "h:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } } }));
  assert.equal(other.mesa, false);
  assert.ok(analyzeServe("{nope").error);
});

test("statusExitCode: 0 only when installed, running and serving Mesa with Funnel off", () => {
  const ok = { installed: true, running: true, mesa: true, funnel: false };
  assert.equal(statusExitCode(ok), 0);
  assert.equal(statusExitCode({ ...ok, mesa: false }), 1);
  assert.equal(statusExitCode({ ...ok, running: false }), 1);
  assert.equal(statusExitCode({ ...ok, installed: false }), 1);
  assert.equal(statusExitCode({ ...ok, funnel: true }), 3);
});

test("describe: warns loudly about Funnel and says when Tailscale is missing", () => {
  assert.match(describe({ installed: false })[0], /no está instalado/);
  const lines = describe({ installed: true, running: true, url: "https://pc.tail1234.ts.net", mesa: true, funnel: true, funnelHosts: ["h:443"] });
  assert.ok(lines.some((l) => l.includes("FUNNEL ENCENDIDO")));
});

test("serve command targets loopback only, on tailnet https", () => {
  assert.deepEqual(SERVE_ARGS, ["serve", "--bg", "--https=443", "http://127.0.0.1:8790"]);
  assert.ok(!SERVE_ARGS.some((a) => /funnel/i.test(a)));
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
