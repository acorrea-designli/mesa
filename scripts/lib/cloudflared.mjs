// Side-effecting helpers shared by `pnpm tunnel` (scripts/tunnel.mjs) and the autostart under `pnpm start`
// (scripts/lib/autostart.mjs): find cloudflared, run it, probe the public URL. Pure rules stay in ./tunnel.mjs.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { classifyProbe, parseServiceState } from "./tunnel.mjs";

export const CLOUDFLARED_CANDIDATES = [
  "cloudflared",
  "C:\Program Files (x86)\cloudflared\cloudflared.exe",
  "C:\Program Files\cloudflared\cloudflared.exe",
  "/usr/local/bin/cloudflared",
  "/opt/homebrew/bin/cloudflared",
];

/** Runs `cloudflared <argv>` synchronously: { found, file, code, stdout, stderr }. `found` is false when no candidate exists. */
export function runCloudflared(argv, { candidates = CLOUDFLARED_CANDIDATES, exists = existsSync, spawn = spawnSync } = {}) {
  for (const file of candidates) {
    if (file !== "cloudflared" && !exists(file)) continue;
    const r = spawn(file, argv, { encoding: "utf8", timeout: 20000, windowsHide: true });
    if (r.error && r.error.code === "ENOENT") continue;
    return { found: true, file, code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }
  return { found: false, file: null, code: 127, stdout: "", stderr: "" };
}

/** GET https://<hostname>/ with no cookie and no token, redirects not followed -> "access" | "mesa" | "unreachable" | "unknown" | "skipped". */
export async function probePublic(hostname, fetchFn = fetch) {
  if (!hostname) return "skipped";
  try {
    const res = await fetchFn(`https://${hostname}/`, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "user-agent": "mesa-tunnel-probe", accept: "text/html" } });
    const headers = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
    await res.body?.cancel();
    return classifyProbe({ status: res.status, headers, location: headers.location });
  } catch {
    return classifyProbe({ error: true });
  }
}

/** The state of the Windows service cloudflared installs: "running" | "stopped" | "absent" | "other" ("absent" off Windows). */
export function serviceState(serviceName, { platform = process.platform, spawn = spawnSync } = {}) {
  if (platform !== "win32") return "absent";
  const r = spawn("sc", ["query", serviceName], { encoding: "utf8", timeout: 10000, windowsHide: true });
  return parseServiceState(r.stdout ?? "", r.status ?? 1);
}

/** Windows: is `pid` a running cloudflared? `tasklist` CSV row: "cloudflared.exe","1234",... (a reused PID names another image). */
export function isCloudflaredImage(pid, { spawn = spawnSync } = {}) {
  try {
    const r = spawn("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 10000, windowsHide: true });
    const row = String(r.stdout ?? "").split(/\r?\n/).find((l) => l.trim().startsWith('"'));
    if (!row) return false;
    const [image, id] = row.split('","').map((c) => c.replace(/^"|"$/g, ""));
    return /^cloudflared(\.exe)?$/i.test(image ?? "") && Number(id) === Number(pid);
  } catch {
    return false;
  }
}

/**
 * Is the process named in `pidfile` (written by `pnpm tunnel up` or the autostart) a live LOCAL cloudflared?
 * kill(pid, 0) alone is not enough on Windows, where a stale pidfile's PID can be reused by any program: there the
 * image name must be cloudflared too.
 */
export function pidAlive(pidfile, { read = readFileSync, kill = process.kill, platform = process.platform, spawn = spawnSync } = {}) {
  try {
    const pid = Number(read(pidfile, "utf8"));
    if (!pid) return false;
    kill(pid, 0);
    return platform === "win32" ? isCloudflaredImage(pid, { spawn }) : true;
  } catch {
    return false;
  }
}

/** Stops the Windows service (when running) and the pidfile's process; removes the pidfile. True when something was stopped. */
export function stopRunningTunnel(pidfile, serviceName, { spawn = spawnSync, read = readFileSync, kill = process.kill, remove = rmSync } = {}) {
  let stopped = false;
  if (serviceState(serviceName, { spawn }) === "running") {
    spawn("sc", ["stop", serviceName], { encoding: "utf8", windowsHide: true });
    stopped = true;
  }
  if (pidAlive(pidfile, { read, kill, spawn })) {
    try {
      kill(Number(read(pidfile, "utf8")));
      stopped = true;
    } catch {
      /* already gone */
    }
  }
  remove(pidfile, { force: true });
  return stopped;
}
