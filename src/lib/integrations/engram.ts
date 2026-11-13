// Read-only engram search through its CLI, for the "Memoria · engram" panel. Titles and
// types only, never bodies. Any failure (CLI missing, timeout, crash) is "offline" so the
// panel shows its "sin conexión" state and signing is never blocked. Mesa never writes to engram.
import { execFile } from "node:child_process";

export interface EngramObservation {
  id: string;
  type: string;
  title: string;
  createdAt: string | null;
  project: string;
}

export interface EngramSearch {
  status: "connected" | "offline";
  observations: EngramObservation[];
}

export type EngramRunner = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export const ENGRAM_BIN = process.env.MESA_ENGRAM_BIN?.trim() || "engram";

export const runEngram: EngramRunner = (args) =>
  new Promise((resolve) => {
    execFile(ENGRAM_BIN, args, { timeout: 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: string | number; killed?: boolean }) | null;
      const code = !e ? 0 : e.code === "ENOENT" ? 127 : typeof e.code === "number" ? e.code : 1;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

// "[1] #2901 (learning) — CI runners look offline …"
const HEAD = /^\[\d+\]\s+#(\S+)\s+\(([^)]+)\)\s+[—-]\s+(.*)$/;
// "    2026-11-03 03:56:32 | project: medix-platform | scope: project"
const FOOT = /^\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)\s*\|\s*project:\s*([^|]*?)\s*(?:\||$)/;

/** Parse `engram search` text output (v3: no JSON flag). Engram stores UTC. */
export function parseSearch(stdout: string): EngramObservation[] {
  const out: EngramObservation[] = [];
  let cur: EngramObservation | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const h = HEAD.exec(line.trim());
    if (h) {
      if (cur) out.push(cur);
      cur = { id: h[1]!, type: h[2]!, title: h[3]!.trim(), createdAt: null, project: "" };
      continue;
    }
    const f = cur && FOOT.exec(line);
    if (cur && f) {
      cur.createdAt = new Date(`${f[1]!.replace(" ", "T")}Z`).toISOString();
      cur.project = f[2]!.trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}

const cache = new Map<string, { at: number; value: EngramSearch }>();
const CACHE_MS = 30_000;

export async function searchEngram(
  q: string,
  o: { project?: string | null; limit?: number } = {},
  run: EngramRunner = runEngram,
  now = Date.now(),
): Promise<EngramSearch> {
  const query = q.trim();
  const limit = Math.min(Math.max(o.limit ?? 5, 1), 20);
  if (!query) return { status: "connected", observations: [] };
  const key = `${o.project ?? "*"}\u0000${limit}\u0000${query}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const args = ["search", query, ...(o.project ? ["--project", o.project] : ["--all"]), "--limit", String(limit)];
  const r = await run(args);
  const text = `${r.stdout}\n${r.stderr}`;
  let value: EngramSearch;
  // engram exits 1 for a project with no memories yet: that is an empty answer, not an outage.
  if (r.code !== 127 && /unknown project|No memories found/i.test(text)) value = { status: "connected", observations: [] };
  else if (r.code !== 0) value = { status: "offline", observations: [] };
  else value = { status: "connected", observations: parseSearch(r.stdout).slice(0, limit) };
  if (value.status === "connected") cache.set(key, { at: now, value });
  return value;
}

export function clearEngramCache(): void {
  cache.clear();
}
