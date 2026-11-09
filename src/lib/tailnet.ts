// The URL the phone opens: https://<this PC>.<tailnet>.ts.net (what `tailscale serve --https=443` publishes).
// MESA_TAILNET_URL wins; otherwise ask the local Tailscale CLI (`tailscale status --json`, Self.DNSName).
// Read only, short timeout, cached for 30 s; any failure (no CLI, logged out) is "not available" (null).
import { execFile } from "node:child_process";

export type Run = (file: string, args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string }>;

const CANDIDATES = ["tailscale", "C:\\Program Files\\Tailscale\\tailscale.exe", "/usr/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];

const run: Run = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === "number" ? ((err as NodeJS.ErrnoException).code as unknown as number) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? "") });
    });
  });

/** Normalize a configured URL: https only, no path, no trailing slash. */
export function normalizeTailnetUrl(raw: string | undefined | null): string | null {
  const s = raw?.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** `tailscale status --json` -> "https://pc.tail1234.ts.net", or null when logged out / stopped. */
export function tailnetUrlFromStatus(stdout: string): string | null {
  try {
    const j = JSON.parse(stdout) as { BackendState?: string; Self?: { DNSName?: string } };
    if (j.BackendState && j.BackendState !== "Running") return null;
    const dns = j.Self?.DNSName?.replace(/\.$/, "");
    return dns ? normalizeTailnetUrl(`https://${dns}`) : null;
  } catch {
    return null;
  }
}

let cache: { at: number; value: string | null } | null = null;

export async function tailnetUrl(env: NodeJS.ProcessEnv = process.env, exec: Run = run, now = Date.now()): Promise<string | null> {
  const configured = normalizeTailnetUrl(env.MESA_TAILNET_URL);
  if (configured) return configured;
  if (exec === run && cache && now - cache.at < 30_000) return cache.value;
  let value: string | null = null;
  for (const file of CANDIDATES) {
    const r = await exec(file, ["status", "--json"], 3000);
    if (r.code === 0 && r.stdout) {
      value = tailnetUrlFromStatus(r.stdout);
      break;
    }
  }
  if (exec === run) cache = { at: now, value };
  return value;
}
