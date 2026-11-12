// Shared helpers for the Mesa team hooks. Node builtins only (no install step), so the hooks run from any checkout.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

// Agent names: <role>-<ticketRef>[-k], e.g. reviewer-t12, reviewer-t12-2, tl-t14. Never reused.
export const ROLES = ["tl", "reviewer", "dev", "devops", "researcher", "writer"];
export const NAME_RE = new RegExp(`^(${ROLES.join("|")})-(t\\d+)(?:-(\\d+))?$`);

// Sandbox (docs/SANDBOX.md): MESA_ENV=sandbox from the settings env, or `--env sandbox` on the hook command, which
// the installer adds for a sandbox folder so the hooks know even when the env does not reach them.
export function hookSandbox(env = process.env, argv = process.argv) {
  const i = argv.indexOf("--env");
  if (i >= 0 && argv[i + 1]) return argv[i + 1] === "sandbox";
  return String(env.MESA_ENV ?? "").trim().toLowerCase() === "sandbox";
}

// The board the hooks talk to: MESA_URL, else the sandbox board in sandbox, else the live one.
export const mesaBase = () => (process.env.MESA_URL ?? (hookSandbox() ? "http://127.0.0.1:8796" : "http://127.0.0.1:8790")).replace(/\/$/, "");

export async function readStdinJson() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

// One JSON call to Mesa. Throws on network errors, non-2xx and { ok: false }.
export async function mesaCall(path, { method, body, fetchImpl = fetch, base = mesaBase(), timeoutMs = 5000 } = {}) {
  const headers = { "x-mesa-client": "cli", ...(body ? { "content-type": "application/json" } : {}) }; // not Andrés's interaction
  if (process.env.MESA_TOKEN) headers["x-mesa-token"] = process.env.MESA_TOKEN;
  const res = await fetchImpl(`${base}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const msg = data?.error?.message ?? data?.error ?? `Mesa answered ${res.status}`;
    throw new Error(String(msg));
  }
  return data ?? {};
}

// The sweeper is the one role without a ticket: sweeper-<n>, one at a time, respawned as n+1.
export const SWEEPER_RE = /^sweeper-\d+$/;

export function parseName(name) {
  const s = String(name ?? "");
  if (SWEEPER_RE.test(s)) return { name: s, role: "sweeper", ticketRef: null };
  const m = NAME_RE.exec(s);
  return m ? { name: m[0], role: m[1], ticketRef: m[2] } : { name: s, role: null, ticketRef: null };
}

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

// First user message of a JSONL transcript.
export function firstUserText(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return "";
  for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.type !== "user") continue;
    const c = m.message?.content;
    return Array.isArray(c) ? c.map((x) => x.text ?? "").join("\n") : String(c ?? "");
  }
  return "";
}

// Where the agent's own transcript lives. Claude Code keeps subagent transcripts at
// <dir>/<session_id>/subagents/agent-<agent_id>.jsonl, next to a .meta.json that carries the spawn name.
export function agentTranscriptPath(input) {
  if (input?.agent_transcript_path) return String(input.agent_transcript_path);
  const tp = String(input?.transcript_path ?? "");
  if (/[\\/]subagents[\\/]agent-[^\\/]+\.jsonl$/.test(tp)) return tp;
  if (!input?.agent_id || !tp) return null;
  const session = input.session_id ?? basename(tp, ".jsonl");
  return join(dirname(tp), session, "subagents", `agent-${input.agent_id}.jsonl`);
}

// Who is calling: null for the lead (main thread), otherwise { name, role, ticketRef } (role/ticketRef null when the
// name does not follow the convention). Sources, first hit wins: explicit name fields, the .meta.json name, the
// agent id (named agents get "a<name>-<16 hex>"), the "You are `<name>`" first line of the spawn prompt.
export function resolveAgent(input) {
  const explicit = input?.agent_name ?? input?.teammate_name;
  if (explicit) return parseName(explicit);
  const tp = agentTranscriptPath(input);
  const idFromPath = tp ? (/agent-([^\\/]+)\.jsonl$/.exec(tp) ?? [])[1] : undefined;
  const agentId = input?.agent_id ?? idFromPath;
  if (!agentId && !tp) return null;
  if (tp) {
    const meta = readJson(tp.replace(/\.jsonl$/, ".meta.json"));
    if (meta?.name) return parseName(meta.name);
  }
  const fromId = /^a([a-z][a-z0-9-]*?)-[0-9a-f]{16}$/.exec(String(agentId ?? ""));
  if (fromId && (NAME_RE.test(fromId[1]) || SWEEPER_RE.test(fromId[1]))) return parseName(fromId[1]);
  const said = /You are `([a-z0-9-]+)`/.exec(firstUserText(tp));
  if (said) return parseName(said[1]);
  if (fromId) return parseName(fromId[1]);
  return agentId ? { name: String(agentId), role: null, ticketRef: null } : null;
}

// The last thing the agent said: its last assistant text or the message of its last SendMessage, whichever is later.
export function lastUtterance(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return "";
  let last = "";
  for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.type !== "assistant") continue;
    const content = Array.isArray(m.message?.content) ? m.message.content : [];
    for (const c of content) {
      if (c.type === "text" && c.text?.trim()) last = c.text;
      if (c.type === "tool_use" && c.name === "SendMessage" && typeof c.input?.message === "string") last = c.input.message;
    }
  }
  return last;
}

// permissions.allow from the project and user settings files, tagged with the file they came from.
export function loadAllowRules(cwd, env = process.env) {
  const project = env.CLAUDE_PROJECT_DIR ?? cwd ?? process.cwd();
  const userDir = env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const files = [
    join(project, ".claude", "settings.json"),
    join(project, ".claude", "settings.local.json"),
    join(userDir, "settings.json"),
  ];
  const rules = [];
  for (const f of files) {
    const allow = readJson(f)?.permissions?.allow;
    if (Array.isArray(allow)) for (const r of allow) rules.push({ rule: String(r), file: f });
  }
  return rules;
}

const ruleParts = (rule) => {
  const m = /^([A-Za-z_][\w-]*)(?:\((.*)\))?$/.exec(rule.trim());
  return m ? { tool: m[1], pattern: m[2] ?? "" } : { tool: rule, pattern: "" };
};
const prefixOf = (pattern) => pattern.replace(/(:\*|\s\*|\*)+$/, "").trim();
const commonPrefix = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

// The command without the wrappers that break prefix matching: a leading `cd X &&`, env assignments.
export function bareCommand(cmd) {
  return String(cmd ?? "")
    .trim()
    .replace(/^(cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*)+/, "")
    .replace(/^([A-Z_][A-Z0-9_]*=("[^"]*"|'[^']*'|\S+)\s+)+/, "");
}

// Closest allow rules to a blocked call, plus plain-language shape advice. Pure; used by mesa-approval.mjs.
export function closestRules(input, rules) {
  const tool = String(input?.tool_name ?? "");
  const ti = input?.tool_input ?? {};
  const advice = [];
  const scored = [];
  if (tool === "Bash" || tool === "PowerShell") {
    const raw = String(ti.command ?? "");
    const cmd = bareCommand(raw);
    if (cmd !== raw.trim()) advice.push("drop the leading `cd`/env prefix: allow rules match the bare command by prefix");
    if (/&&|\|\||;|\|/.test(cmd.replace(/"[^"]*"|'[^']*'/g, ""))) advice.push("run one command per call, without `&&`, `;` or pipes");
    if (/\s2>&1|\s>\s*\S|\s2>\s*\S/.test(cmd)) advice.push("drop the redirection");
    const first = cmd.split(/\s+/)[0];
    for (const r of rules) {
      const { tool: rt, pattern } = ruleParts(r.rule);
      if (rt !== "Bash" && rt !== "PowerShell") continue;
      const p = prefixOf(pattern);
      if (!p || p.split(/\s+/)[0] !== first) continue;
      const score = commonPrefix(cmd, p) / Math.max(p.length, 1) + (rt === tool ? 0.01 : 0);
      scored.push({ ...r, score, otherTool: rt !== tool });
    }
  } else if (tool.startsWith("mcp__")) {
    const server = tool.split("__").slice(0, 2).join("__");
    for (const r of rules) {
      if (r.rule === tool || r.rule === `${server}__*` || r.rule === server) scored.push({ ...r, score: 1 });
      else if (r.rule.startsWith(server)) scored.push({ ...r, score: 0.5 });
    }
  } else {
    for (const r of rules) if (ruleParts(r.rule).tool === tool) scored.push({ ...r, score: 0.5 });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0.3).slice(0, 3);
  if (top.some((t) => t.otherTool) && !top.some((t) => !t.otherTool && t.score >= 1)) {
    advice.push(`the closest rule is for the ${tool === "Bash" ? "PowerShell" : "Bash"} tool: rules are per tool`);
  }
  return { rules: top.map((t) => `${t.rule}  (${t.file})`), advice };
}
