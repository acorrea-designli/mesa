// The gh CLI, run server side with Andrés's own login. Mesa never stores a token: when
// MESA_GH_USER is set (default acorrea-designli) the token is read from gh's keyring for
// that account at runtime and passed only to the child process, so a different active
// gh account on this PC does not change who Mesa reads as.
import { execFile } from "node:child_process";

export const GH_USER = process.env.MESA_GH_USER ?? "acorrea-designli";

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GhRunner = (args: string[], opts?: { timeoutMs?: number; input?: string }) => Promise<GhResult>;

export type GhErrorKind = "missing" | "auth" | "scope" | "rate_limit" | "not_found" | "other";

export class GhError extends Error {
  constructor(
    public kind: GhErrorKind,
    message: string,
    public resetAt: string | null = null,
  ) {
    super(message);
    this.name = "GhError";
  }
}

function exec(file: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number, input?: string): Promise<GhResult> {
  return new Promise((resolve) => {
    const child = execFile(file, args, { env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: string | number }) | null;
      if (e && e.code === "ENOENT") return resolve({ code: 127, stdout: "", stderr: "gh: command not found" });
      const code = e ? (typeof e.code === "number" ? e.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

const g = globalThis as unknown as { __mesaGhToken?: { value: string; at: number } };
const TOKEN_TTL_MS = 10 * 60_000;

/** The default runner: `gh` on PATH, as GH_USER, with prompts disabled. */
export const runGh: GhRunner = async (args, opts = {}) => {
  const env: NodeJS.ProcessEnv = { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1", GH_NO_UPDATE_NOTIFIER: "1" };
  if (GH_USER && !process.env.GH_TOKEN) {
    const cached = g.__mesaGhToken;
    if (cached && Date.now() - cached.at < TOKEN_TTL_MS) env.GH_TOKEN = cached.value;
    else {
      const t = await exec("gh", ["auth", "token", "-u", GH_USER], env, 10_000);
      if (t.code === 0 && t.stdout.trim()) {
        g.__mesaGhToken = { value: t.stdout.trim(), at: Date.now() };
        env.GH_TOKEN = g.__mesaGhToken.value;
      }
    }
  }
  return exec("gh", args, env, opts.timeoutMs ?? 30_000, opts.input);
};

/** Classify a failed gh call from its output. */
export function classify(r: GhResult, status?: number, headers: Record<string, string> = {}): GhError {
  const text = `${r.stderr}\n${r.stdout}`;
  const reset = headers["x-ratelimit-reset"] ? new Date(Number(headers["x-ratelimit-reset"]) * 1000).toISOString() : null;
  if (r.code === 127) return new GhError("missing", "gh is not installed or not on PATH");
  if (/rate limit|secondary rate|abuse detection/i.test(text) || status === 429 || (status === 403 && headers["x-ratelimit-remaining"] === "0")) {
    return new GhError("rate_limit", "GitHub API rate limit", reset);
  }
  if (/INSUFFICIENT_SCOPES|required scopes|missing required scope|scope.*project|auth refresh -s/i.test(text)) {
    return new GhError("scope", "gh token lacks a required scope (run: gh auth refresh -s project)");
  }
  if (/not logged in|gh auth login|authentication|Bad credentials|HTTP 401/i.test(text) || status === 401) {
    return new GhError("auth", "gh is not logged in");
  }
  if (/HTTP 404|Could not resolve|not found/i.test(text) || status === 404) return new GhError("not_found", firstLine(text));
  return new GhError("other", firstLine(text) || `gh exited ${r.code}`);
}

const firstLine = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 300) ?? "";

/** Run gh and parse JSON stdout; throws GhError on failure. */
export async function ghJson<T>(gh: GhRunner, args: string[], input?: string): Promise<T> {
  const r = await gh(args, input === undefined ? undefined : { input });
  if (r.code !== 0) throw classify(r);
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    throw new GhError("other", `gh ${args[0]} returned invalid JSON`);
  }
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>; // lower-case names
  body: string;
}

/** Parse `gh api -i` output: status line, headers, blank line, body. */
export function parseHttp(stdout: string): HttpResponse | null {
  const m = /^HTTP\/[\d.]+\s+(\d{3})[^\n]*\n/.exec(stdout);
  if (!m) return null;
  const rest = stdout.slice(m[0].length);
  const split = /\r?\n\r?\n/.exec(rest);
  const head = split ? rest.slice(0, split.index) : rest;
  const body = split ? rest.slice(split.index + split[0].length) : "";
  const headers: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { status: Number(m[1]), headers, body };
}

/**
 * `gh api -i <path>` with extra headers. gh exits non-zero on 304 and 4xx, so the
 * status comes from the response itself. Throws GhError when there is no response
 * or the status is an error other than 304.
 */
export async function ghApi(gh: GhRunner, path: string, headers: Record<string, string> = {}): Promise<HttpResponse> {
  const args = ["api", "-i", path];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  const r = await gh(args);
  const res = parseHttp(r.stdout);
  if (!res) throw classify(r);
  if (res.status >= 400) throw classify({ ...r, stdout: res.body }, res.status, res.headers);
  return res;
}

/** A GraphQL call through `gh api graphql --input -` (variables may be arrays of objects). */
export async function ghGraphql<T>(gh: GhRunner, query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await ghJson<{ data?: T; errors?: { message: string; type?: string }[] }>(gh, ["api", "graphql", "--input", "-"], JSON.stringify({ query, variables }));
  if (r.errors?.length) {
    const msg = r.errors.map((e) => e.message).join("; ");
    throw classify({ code: 1, stdout: "", stderr: `${r.errors.map((e) => e.type ?? "").join(" ")} ${msg}` });
  }
  if (!r.data) throw new GhError("other", "empty GraphQL response");
  return r.data;
}
