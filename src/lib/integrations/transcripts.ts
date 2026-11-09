// Reads Claude Code transcripts for "tokens spent" (t45). Server only, read only.
//
// Claude Code writes `<config dir>/projects/<slug of the session's cwd>/<session>.jsonl` (the lead) and
// `<session>/subagents/agent-<id>.jsonl` (+ `.meta.json` with `agentType` and `description`) for every subagent.
// The folder comes from CLAUDE_CONFIG_DIR (default ~/.claude), never a hardcoded user path. The first scan only
// opens files touched since the start of last week; every later scan reads each file from its saved byte offset,
// so the cost is the new bytes, never the whole history. Only message usage is read: no credential file is opened.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isSandbox } from "../env";
import { addUsage, classifyRole, parseUsageLine, pruneDays, summarize, type Buckets, type Role, type TokenSummary } from "../domain/tokens";
import { addDays, localDay, weekOf } from "../domain/week";
import type { Db } from "../db/sqlite";
import { usageRepo } from "../repo/usage";

export interface FileState {
  /** Byte offset after the last complete line read. */
  offset: number;
  role: Role;
  /** `message.id` of the last counted message: one response is written once per content block. */
  lastId: string;
}

export interface TokenState {
  files: Record<string, FileState>;
  days: Buckets;
}

const CHUNK = 4 * 1024 * 1024;
/** Days of buckets kept: more than a week, so a scan never loses the start of the current one. */
const KEEP_DAYS = 14;
/** Scans closer together than this are skipped (the polling rail and /semana may both ask). */
export const MIN_SCAN_MS = 30_000;

const slug = (folder: string) => folder.replace(/[^A-Za-z0-9]/g, "-");

/** The folder Claude Code sessions of this board run in: the live one is the parent of this repo, the sandbox one its sibling. */
export function sessionsFolder(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  if (env.MESA_SESSIONS_DIR) return env.MESA_SESSIONS_DIR;
  return isSandbox(env) ? path.join(path.dirname(path.dirname(cwd)), "designli-sandbox") : path.dirname(cwd);
}

/** The transcripts folder of the sessions folder, or null when Claude Code has none there. The slug match ignores case (Windows). */
export function transcriptsDir(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string | null {
  if (env.MESA_TRANSCRIPTS_DIR) return env.MESA_TRANSCRIPTS_DIR;
  const projects = path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
  const want = slug(sessionsFolder(env, cwd)).toLowerCase();
  try {
    const hit = fs.readdirSync(/*turbopackIgnore: true*/ projects).find((d) => d.toLowerCase() === want);
    return hit ? path.join(projects, hit) : null;
  } catch {
    return null;
  }
}

interface Found {
  key: string;
  file: string;
  main: boolean;
  /** Absolute path of the `.meta.json` beside a subagent transcript. */
  meta?: string;
}

function listTranscripts(dir: string): Found[] {
  const out: Found[] = [];
  for (const e of fs.readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".jsonl")) out.push({ key: e.name, file: path.join(dir, e.name), main: true });
    if (!e.isDirectory()) continue;
    const sub = path.join(dir, e.name, "subagents");
    let names: string[];
    try {
      names = fs.readdirSync(/*turbopackIgnore: true*/ sub);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!/^agent-.+\.jsonl$/.test(n)) continue;
      out.push({ key: `${e.name}/subagents/${n}`, file: path.join(sub, n), main: false, meta: path.join(sub, n.replace(/\.jsonl$/, ".meta.json")) });
    }
  }
  return out;
}

function roleOf(f: Found): Role | null {
  if (f.main) return "lead";
  try {
    const m = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ f.meta!, "utf8")) as { agentType?: string; description?: string };
    return classifyRole({ main: false, agentType: m.agentType, description: m.description });
  } catch {
    return null; // no meta yet: try again on the next scan rather than counting it as "other" for good
  }
}

/** Reads the new complete lines of `f` into `state`. */
function readNew(f: Found, st: FileState, size: number, state: TokenState): void {
  const fd = fs.openSync(/*turbopackIgnore: true*/ f.file, "r");
  try {
    const buf = Buffer.alloc(CHUNK);
    let pos = st.offset;
    let carry: Buffer = Buffer.alloc(0);
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos);
      if (n <= 0) break;
      pos += n;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      const nl = data.lastIndexOf(0x0a);
      if (nl < 0) {
        carry = Buffer.from(data);
        continue;
      }
      carry = Buffer.from(data.subarray(nl + 1));
      for (const line of data.subarray(0, nl).toString("utf8").split("\n")) {
        const rec = parseUsageLine(line);
        if (!rec || (rec.id && rec.id === st.lastId)) continue;
        st.lastId = rec.id;
        addUsage(state.days, st.role, rec);
      }
      st.offset = pos - carry.length;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Brings `state` up to date with the transcripts under `dir` (mutates it). Returns whether anything changed.
 * Files untouched since before last week are skipped; a file seen before is read from its saved offset.
 */
export function scanTranscripts(dir: string, state: TokenState, now: Date): boolean {
  const cutoff = Date.parse(`${addDays(weekOf(now).monday, -1)}T00:00:00-05:00`);
  let changed = false;
  const seen = new Set<string>();
  for (const f of listTranscripts(dir)) {
    seen.add(f.key);
    let size: number;
    try {
      const s = fs.statSync(/*turbopackIgnore: true*/ f.file);
      if (s.mtimeMs < cutoff && !state.files[f.key]) continue;
      size = s.size;
    } catch {
      continue;
    }
    let st = state.files[f.key];
    if (st && size < st.offset) st = state.files[f.key] = { ...st, offset: 0, lastId: "" }; // rewritten in place
    if (st && size === st.offset) continue;
    if (!st) {
      const role = roleOf(f);
      if (!role) continue;
      st = state.files[f.key] = { offset: 0, role, lastId: "" };
    }
    try {
      readNew(f, st, size, state);
      changed = true;
    } catch {
      /* the file vanished or is locked: next scan */
    }
  }
  for (const k of Object.keys(state.files)) {
    if (!seen.has(k)) {
      delete state.files[k];
      changed = true;
    }
  }
  const before = Object.keys(state.days).length;
  pruneDays(state.days, addDays(localDay(now), -KEEP_DAYS));
  return changed || Object.keys(state.days).length !== before;
}

const lastScan = new WeakMap<Db, number>();

/**
 * Tokens spent today and this week for this board's sessions, or null when there is no transcripts folder.
 * Scans incrementally (at most every MIN_SCAN_MS) and keeps the result in the database, so a restart does not
 * start over.
 */
export function tokenSummary(db: Db, now: Date = new Date(), dir: string | null = transcriptsDir()): TokenSummary | null {
  if (!dir) return null;
  const repo = usageRepo(db);
  const state: TokenState = repo.tokenState() ?? { files: {}, days: {} };
  if (now.getTime() - (lastScan.get(db) ?? 0) >= MIN_SCAN_MS) {
    lastScan.set(db, now.getTime());
    try {
      if (scanTranscripts(dir, state, now)) repo.saveTokenState(state);
    } catch (err) {
      console.error("usage: transcript scan failed", err instanceof Error ? err.message : err);
    }
  }
  return summarize(state.days, now);
}
