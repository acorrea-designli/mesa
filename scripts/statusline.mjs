#!/usr/bin/env node
// Claude Code statusLine command for Mesa sessions (t45): shows the plan usage in the terminal and saves it to Mesa.
//
//   settings.json: { "statusLine": { "type": "command", "command": "\"<node>\" \"<repo>/scripts/statusline.mjs\" --url http://127.0.0.1:8790" } }
//
// Claude Code writes one JSON document to stdin on every refresh: `session_id`, `model.{id,display_name}` and, for
// subscription sessions, `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}` (resets_at in epoch
// seconds; the whole object is absent for API-key sessions, and it is an undocumented field, so every part of it is
// optional here). This script:
//   1. prints ONE line:  <model> · 5 h N% restante · semana N% restante   (exactly what Claude Code shows);
//   2. POSTs the figures to Mesa (/api/usage on --url, else $MESA_URL, else http://127.0.0.1:8790), with a short
//      timeout, so Mesa's rail can show them. A Mesa that is down, slow or answering an error changes nothing:
//      the line is printed first and the exit code is always 0.
// It reads no credential file and calls no Anthropic API: the only network call is a POST to a loopback Mesa.
import { pathToFileURL } from "node:url";

export const DEFAULT_URL = "http://127.0.0.1:8790";
const POST_TIMEOUT_MS = 1500;
const MAX_STDIN = 1_000_000;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Parses the stdin document; anything that is not a JSON object is `{}` (the line still prints). */
export function parseInput(text) {
  try {
    const v = JSON.parse(text);
    return isObj(v) ? v : {};
  } catch {
    return {};
  }
}

/** Epoch seconds out of a number, a numeric string or an ISO string; null when it is none of them. */
function epochSeconds(v) {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.floor(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return Math.floor(t / 1000);
  }
  return null;
}

function windowOf(w) {
  if (!isObj(w)) return null;
  const used = typeof w.used_percentage === "number" ? w.used_percentage : Number(w.used_percentage);
  const resetsAt = epochSeconds(w.resets_at);
  // A figure with no reset time cannot be shown as "remaining until", so it counts as absent.
  if (!Number.isFinite(used) || resetsAt === null) return null;
  return { usedPercentage: Math.min(1000, Math.max(0, used)), resetsAt };
}

const modelOf = (input) => {
  const m = isObj(input.model) ? input.model : {};
  return { id: typeof m.id === "string" ? m.id : "", displayName: typeof m.display_name === "string" ? m.display_name : "" };
};

/** The body for POST /api/usage, or null when the input has no rate_limits worth saving (nothing to overwrite good data with). */
export function buildPayload(input, now = new Date()) {
  const rl = isObj(input.rate_limits) ? input.rate_limits : {};
  const fiveHour = windowOf(rl.five_hour);
  const sevenDay = windowOf(rl.seven_day);
  if (!fiveHour && !sevenDay) return null;
  return {
    sessionId: typeof input.session_id === "string" ? input.session_id : "",
    model: modelOf(input),
    capturedAt: now.toISOString(),
    fiveHour,
    sevenDay,
  };
}

const remaining = (w) => `${Math.round(Math.min(100, Math.max(0, 100 - w.usedPercentage)))}% restante`;

/** "Opus 5.5 · 5 h 68% restante · semana 89% restante"; with no figures, "Opus 5.5 · uso sin dato". */
export function formatLine(input) {
  const m = modelOf(input);
  const parts = [m.displayName || m.id || "Claude"];
  const p = buildPayload(input);
  if (!p) return `${parts[0]} · uso sin dato`;
  if (p.fiveHour) parts.push(`5 h ${remaining(p.fiveHour)}`);
  if (p.sevenDay) parts.push(`semana ${remaining(p.sevenDay)}`);
  return parts.join(" · ");
}

/** Only a Mesa on this machine is ever called. */
export function isLoopback(url) {
  try {
    const h = new URL(url).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

export function mesaUrl(argv, env) {
  const i = argv.indexOf("--url");
  return (i >= 0 && argv[i + 1]) || env.MESA_URL || DEFAULT_URL;
}

/** POSTs the payload; resolves true when Mesa saved it and false on anything else. Never rejects. */
export async function postSnapshot(baseUrl, payload, { fetchFn = globalThis.fetch, timeoutMs = POST_TIMEOUT_MS } = {}) {
  if (!payload || !isLoopback(baseUrl)) return false;
  try {
    const res = await fetchFn(new URL("/api/usage", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function readStdin(stream) {
  if (!stream || stream.isTTY) return "";
  let text = "";
  for await (const chunk of stream) {
    text += chunk;
    if (text.length > MAX_STDIN) break;
  }
  return text;
}

/** The whole command. Returns the exit code, always 0. */
export async function main({ stdin = process.stdin, stdout = process.stdout, argv = process.argv.slice(2), env = process.env, fetchFn = globalThis.fetch, now = new Date() } = {}) {
  let input = {};
  try {
    input = parseInput(await readStdin(stdin));
  } catch {
    /* an unreadable stdin still prints a line */
  }
  stdout.write(`${formatLine(input)}\n`);
  try {
    await postSnapshot(mesaUrl(argv, env), buildPayload(input, now), { fetchFn });
  } catch {
    /* never fails the status line */
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdin.setEncoding("utf8");
  // Exit once stdout is flushed: a kept-alive socket must not hold the status line open.
  const done = () => process.stdout.write("", () => process.exit(0));
  main().then(done, done);
}
