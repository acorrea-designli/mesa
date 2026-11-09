#!/usr/bin/env node
// pnpm dev / pnpm start: the board on 127.0.0.1:8790. Loopback only, so nothing on the LAN reaches the port;
// the phone gets in through the Cloudflare Tunnel (pnpm tunnel), cloudflared, which runs on this PC. MESA_HOST overrides the
// address (for example 0.0.0.0, which is an explicit decision: it opens :8790 to the LAN).
//   node scripts/serve.mjs dev|start
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const child = spawn(process.execPath, [next, mode, "--hostname", host, "--port", PORT], { cwd: REPO, env: process.env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
