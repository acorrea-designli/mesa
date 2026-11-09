#!/usr/bin/env node
// pnpm dev / pnpm start: the board on 127.0.0.1:8790 (and, for pnpm start, its cloudflared tunnel as a child). Loopback only, so nothing on the LAN reaches the port;
// the phone gets in through the Cloudflare Tunnel (pnpm tunnel), cloudflared, which runs on this PC. MESA_HOST overrides the
// address (for example 0.0.0.0, which is an explicit decision: it opens :8790 to the LAN).
//   node scripts/serve.mjs dev|start
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { maybeStartTunnel } from "./lib/autostart.mjs";
import { buildEnv } from "./lib/build-info.mjs";
import { isLoopbackBind, pickHost } from "./lib/host.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.MESA_PORT?.trim() || "8790"; // never 8770 or 8771: other boards use them. MESA_PORT is for tests.

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  console.error("usage: node scripts/serve.mjs dev|start");
  process.exit(2);
}
try {
  process.loadEnvFile(join(REPO, ".env.local")); // MESA_HOST may live there (Next reads .env.local too late for --hostname)
} catch {
  /* no .env.local */
}
const host = pickHost(process.env);
if (!isLoopbackBind(host)) {
  console.warn(`serve: MESA_HOST=${host}. Mesa is reachable beyond this PC; the token guard still applies, but prefer 127.0.0.1 and pnpm tunnel.`);
}
const next = join(REPO, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [next, mode, "--hostname", host, "--port", PORT], { cwd: REPO, env: { ...process.env, ...buildEnv(process.env, REPO) }, stdio: "inherit" });

// The phone tunnel (cloudflared) is a child of this process: it starts once the board listens (pnpm start with
// MESA_PUBLIC_URL and MESA_CF_TUNNEL set, or MESA_TUNNEL=on) and stops with it. A problem is one log line, never a failed start.
const tunnel = maybeStartTunnel({ env: process.env, mode, port: PORT, host: host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host });
const stopTunnel = () => tunnel.stop();
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopTunnel();
    child.kill(sig);
  });
}
for (const sig of ["SIGHUP", "SIGBREAK"]) process.on(sig, stopTunnel);
process.on("exit", stopTunnel);
child.on("exit", (code) => {
  stopTunnel();
  process.exit(code ?? 0);
});
