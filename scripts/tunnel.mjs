#!/usr/bin/env node
// pnpm tunnel [status|up|down] [--json]: the phone tunnel. Tailscale Serve publishes http://127.0.0.1:8790 as
// https://<pc>.<tailnet>.ts.net for your own devices only. Funnel (public internet) is never turned on, and
// `up` refuses to run while it is on.
//   status  prints Tailscale, serve and Funnel state. Exit 0 serving with Funnel off, 1 not ready, 3 Funnel ON.
//   up      tailscale serve --bg --https=443 http://127.0.0.1:8790 (after the Funnel check)
//   down    tailscale serve --https=443 off
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { MESA_TARGET, SERVE_ARGS, SERVE_OFF_ARGS, analyzeServe, describe, statusExitCode } from "./lib/tunnel.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const cmd = args.find((a) => !a.startsWith("--")) ?? "status";

const CANDIDATES = ["tailscale", "C:\\Program Files\\Tailscale\\tailscale.exe", "/usr/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];

function ts(argv) {
  for (const file of CANDIDATES) {
    if (file !== "tailscale" && !existsSync(file)) continue;
    const r = spawnSync(file, argv, { encoding: "utf8", timeout: 15000, windowsHide: true });
    if (r.error && r.error.code === "ENOENT") continue;
    return { found: true, code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }
  return { found: false, code: 127, stdout: "", stderr: "" };
}

function collect() {
  const st = ts(["status", "--json"]);
  if (!st.found) return { installed: false, running: false, url: null, serving: [], funnel: false, funnelHosts: [], mesa: false };
  let running = false;
  let url = null;
  try {
    const j = JSON.parse(st.stdout);
    running = j.BackendState === "Running";
    const dns = j.Self?.DNSName?.replace(/\.$/, "");
    url = running && dns ? `https://${dns}` : null;
  } catch {
    /* not logged in or stopped */
  }
  const sv = running ? ts(["serve", "status", "--json"]) : { stdout: "{}" };
  return { installed: true, running, url, ...analyzeServe(sv.stdout) };
}

function report(s) {
  if (json) console.log(JSON.stringify({ installed: s.installed, running: s.running, url: s.url, serving: s.mesa, funnel: s.funnel, funnelHosts: s.funnelHosts }));
  else for (const line of describe(s)) console.log(line);
}

if (cmd === "status") {
  const s = collect();
  report(s);
  process.exit(statusExitCode(s));
}

if (cmd === "up" || cmd === "down") {
  const before = collect();
  if (!before.installed) {
    console.error("Tailscale no está instalado en esta PC. Instálalo e inicia sesión primero.");
    process.exit(1);
  }
  if (before.funnel) {
    for (const line of describe(before)) console.error(line);
    console.error(`tunnel: refusing to ${cmd}: Funnel is on.`);
    process.exit(3);
  }
  if (!before.running) {
    console.error("Tailscale no está conectado. Inicia sesión y vuelve a intentar.");
    process.exit(1);
  }
  const r = ts(cmd === "up" ? SERVE_ARGS : SERVE_OFF_ARGS);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (r.code !== 0) process.exit(r.code);
  const after = collect();
  report(after);
  if (after.funnel) process.exit(3);
  if (cmd === "up" && !after.mesa) {
    console.error(`tunnel: serve is not pointing at ${MESA_TARGET}`);
    process.exit(1);
  }
  process.exit(0);
}

console.error("usage: node scripts/tunnel.mjs [status|up|down] [--json]");
process.exit(2);
