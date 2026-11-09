#!/usr/bin/env node
// pnpm tunnel [status|up|down] [--json]: the phone tunnel. A named cloudflared tunnel publishes Mesa
// (http://127.0.0.1:8790) at the hostname of MESA_PUBLIC_URL; Cloudflare Access (a login with your email) sits in
// front of that hostname, and Mesa verifies the Access token again (src/lib/access.ts). Nothing is created here:
// installing cloudflared, `cloudflared tunnel login/create/route dns`, the Windows service and the Access app are
// one-time steps done by hand (docs/ARCHITECTURE.md § 11). The config this script writes lives in ~/.cloudflared,
// and no credential is ever read or written by it.
//   status  prints cloudflared, service, tunnel and the Access probe. It probes https://<host>/ WITHOUT credentials:
//           Cloudflare must answer (Access redirect or block). Exit 0 all good, 1 not ready, 3 Mesa answered directly.
//   up      writes the config, starts the tunnel (service, or a background process), then probes. If Mesa answers
//           directly it stops the tunnel again and exits 3; if it already did before starting, it refuses (3).
//   down    stops the service or the background process `up` started.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pidAlive as pidAliveAt, probePublic, runCloudflared, serviceState as serviceStateOf, stopRunningTunnel } from "./lib/cloudflared.mjs";
import { WINDOWS_SERVICE, buildConfig, describe, hostFromPublicUrl, parseTunnelList, reuseDecision, statusExitCode, tunnelName } from "./lib/tunnel.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const cmd = args.find((a) => !a.startsWith("--")) ?? "status";

if (!["status", "up", "down"].includes(cmd)) {
  console.error("usage: node scripts/tunnel.mjs [status|up|down] [--json]");
  process.exit(2);
}

try {
  process.loadEnvFile(join(REPO, ".env.local")); // MESA_PUBLIC_URL, MESA_CF_TUNNEL
} catch {
  /* no .env.local */
}

const hostname = hostFromPublicUrl(process.env.MESA_PUBLIC_URL);
const tunnel = tunnelName(process.env);
const CF_DIR = join(homedir(), ".cloudflared");
const CONFIG = join(CF_DIR, `${tunnel}-mesa.yml`);
const PIDFILE = join(CF_DIR, `${tunnel}-mesa.pid`);

const cf = (argv) => runCloudflared(argv);

const serviceState = () => serviceStateOf(WINDOWS_SERVICE);
const pidAlive = () => pidAliveAt(PIDFILE);

const probe = () => probePublic(hostname);

function lookupTunnel(found) {
  if (!found) return null;
  const r = cf(["tunnel", "list", "--name", tunnel, "--output", "json"]);
  return r.code === 0 ? parseTunnelList(r.stdout, tunnel) : null;
}

async function collect() {
  const v = cf(["--version"]);
  const installed = v.found && v.code === 0;
  const t = installed ? lookupTunnel(true) : null;
  return { installed, hostname, tunnel: t, service: serviceState(), pid: pidAlive(), probe: installed ? await probe() : "skipped" };
}

function report(s) {
  if (json) console.log(JSON.stringify({ installed: s.installed, hostname: s.hostname, tunnel: s.tunnel, service: s.service, pid: s.pid, probe: s.probe }));
  else for (const line of describe(s)) console.log(line);
}

const stopTunnel = () => stopRunningTunnel(PIDFILE, WINDOWS_SERVICE);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (cmd === "status") {
  const s = await collect();
  report(s);
  process.exit(statusExitCode(s));
}

if (cmd === "down") {
  const stopped = stopTunnel();
  console.log(stopped ? "Túnel detenido." : "No había túnel que detener (ni servicio ni proceso de `pnpm tunnel up`).");
  process.exit(0);
}

// ---- up
const fail = (msg, code = 1) => {
  console.error(msg);
  process.exit(code);
};
if (!cf(["--version"]).found) fail("cloudflared no está instalado en esta PC. Instálalo y haz `cloudflared tunnel login` primero.");
if (!hostname) fail("MESA_PUBLIC_URL no está puesta (https://mesa.<dominio>) en .env.local: sin dirección no hay túnel.");
const t = lookupTunnel(true);
if (!t) fail(`No encuentro el túnel "${tunnel}" (o no hay sesión de Cloudflare). Créalo una vez: cloudflared tunnel login; cloudflared tunnel create ${tunnel}`);
const credentialsFile = join(CF_DIR, `${t.id}.json`);
if (!existsSync(credentialsFile)) fail(`Falta el archivo de credenciales del túnel (${credentialsFile}). Se crea con \`cloudflared tunnel create ${tunnel}\` en esta PC.`);

const before = await probe();
if (before === "mesa") {
  console.error("tunnel: refusing to start: https://" + hostname + "/ already answers from Mesa without Cloudflare Access.");
  for (const line of describe({ installed: true, hostname, tunnel: t, service: serviceState(), pid: pidAlive(), probe: before })) console.error(line);
  process.exit(3);
}

mkdirSync(CF_DIR, { recursive: true });
writeFileSync(CONFIG, buildConfig({ tunnel, uuid: t.id, credentialsFile, hostname }));
console.log(`Config escrita en ${CONFIG}`);

const svc = serviceState();
let started = false;
const { reuse, staleRemote } = reuseDecision({ connections: t.connections, pidAlive: pidAlive(), service: svc });
if (reuse) {
  console.log("El túnel ya está conectado; no arranco otro.");
} else if (svc === "stopped") {
  const r = spawnSync("sc", ["start", WINDOWS_SERVICE], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) fail(`No pude iniciar el servicio ${WINDOWS_SERVICE} (¿terminal de administrador?): ${(r.stdout || r.stderr).trim()}`);
  started = true;
} else {
  if (staleRemote) console.log(`Cloudflare lista ${t.connections} conexión(es) pero no hay cloudflared local: parecen viejas; arranco el mío.`);
  const exe = cf(["--version"]).file;
  const child = spawn(exe, ["tunnel", "--config", CONFIG, "run", tunnel], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  mkdirSync(dirname(PIDFILE), { recursive: true });
  writeFileSync(PIDFILE, String(child.pid));
  started = true;
}

// Give the tunnel up to 30 s to connect, then look at what the world sees.
let after = "unreachable";
for (let i = 0; i < 10; i++) {
  await sleep(started ? 3000 : 0);
  after = await probe();
  if (after === "access" || after === "mesa") break;
}
const s = await collect();
s.probe = after;
report(s);
if (after === "mesa") {
  if (started) stopTunnel();
  console.error(`tunnel: Mesa answered https://${hostname}/ without Cloudflare Access. ${started ? "Túnel detenido." : "Detén el túnel."} Crea la app de Access primero.`);
  process.exit(3);
}
process.exit(statusExitCode(s));
