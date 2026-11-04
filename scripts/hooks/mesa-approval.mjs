#!/usr/bin/env node
// PermissionRequest hook for Claude Code: a tool call that needs permission becomes an
// approval card on Mesa (inside its ticket thread, or on Hoy without a ticket), and the
// call waits until Andrés presses one of:
//   Dar permiso              -> allow this one call (no standing rule)
//   Lee tus configuraciones  -> deny: read your allow rules and retry with an allowed shape
//   Denegar                  -> deny, with his optional note
//
//   stdin : hook JSON { tool_name, tool_input, cwd, agent_id?, agent_type?, ... }
//   stdout: { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior, message? } } }
//
// Allow comes only from an explicit "allow" on Mesa. Timeout, an unreachable board, bad
// input or any crash print deny. The output never carries updatedInput or
// updatedPermissions, so approving one call creates no standing rule.
//
// env: MESA_URL (default http://127.0.0.1:8790), MESA_TOKEN (non-local URLs only),
//      MESA_AGENT, MESA_TICKET (set by the team layer for each agent),
//      MESA_APPROVAL_TIMEOUT_MS (default 540000; keep it under the hook's registered timeout).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_DETAIL = 300_000;
const WAIT_S = 25;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const output = (behavior, message) => ({
  hookSpecificOutput: {
    hookEventName: "PermissionRequest",
    decision: message ? { behavior, message } : { behavior },
  },
});
const deny = (message) => output("deny", message);

// ---------- what the card shows ----------

const split = (s) => (s === "" ? [] : String(s).split("\n"));

/** A plain line diff: shared head and tail collapse, the changed middle is "-" old then "+" new. */
export function lineDiff(before, after, context = 3) {
  const a = split(before);
  const b = split(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const out = [];
  if (head > context) out.push(`@@ ${head - context} unchanged lines @@`);
  out.push(...a.slice(Math.max(0, head - context), head).map((l) => ` ${l}`));
  out.push(...a.slice(head, a.length - tail).map((l) => `-${l}`));
  out.push(...b.slice(head, b.length - tail).map((l) => `+${l}`));
  out.push(...a.slice(a.length - tail, a.length - tail + context).map((l) => ` ${l}`));
  if (tail > context) out.push(`@@ ${tail - context} unchanged lines @@`);
  return out.join("\n");
}

const clip = (s) => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL)}\n[cut: ${s.length - MAX_DETAIL} more characters]` : s);

function readFileOrNull(cwd, file) {
  try {
    return readFileSync(resolve(cwd || process.cwd(), file), "utf8");
  } catch {
    return null;
  }
}

/** { tool, summary, detail, target } for the approval card. Throws on unusable input. */
export function describe(input) {
  const tool = String(input?.tool_name ?? "");
  if (!tool) throw new Error("hook input has no tool_name");
  const ti = input.tool_input ?? {};
  if (tool === "Bash" || tool === "PowerShell") {
    const command = String(ti.command ?? "");
    if (!command) throw new Error("hook input has no command");
    const first = command.split("\n")[0];
    const summary = String(ti.description ?? "") || (first.length > 120 ? `${first.slice(0, 120)}…` : first);
    return { tool, summary, target: command, detail: clip(`$ ${command}${input.cwd ? `\n(cwd: ${input.cwd})` : ""}`) };
  }
  const file = String(ti.file_path ?? ti.notebook_path ?? ti.path ?? "");
  if (tool === "Edit") {
    const d = lineDiff(ti.old_string ?? "", ti.new_string ?? "") + (ti.replace_all ? "\n(replace_all)" : "");
    return { tool, summary: file, target: file, detail: clip(d) };
  }
  if (tool === "MultiEdit" && Array.isArray(ti.edits)) {
    const d = ti.edits.map((e) => lineDiff(e.old_string ?? "", e.new_string ?? "")).join("\n@@ next edit @@\n");
    return { tool, summary: file, target: file, detail: clip(d) };
  }
  if (tool === "Write") {
    const was = readFileOrNull(input.cwd, file);
    return { tool, summary: file, target: file, detail: clip((was === null ? "(new file)\n" : "") + lineDiff(was ?? "", ti.content ?? "")) };
  }
  const json = JSON.stringify(ti, null, 2);
  return { tool, summary: file || (json.length > 120 ? `${json.slice(0, 120)}…` : json), target: file || json, detail: clip(json) };
}

// ---------- closest allow rules (for "Lee tus configuraciones") ----------

/** allow rules from project and user settings. */
export function readAllowRules(cwd, home = homedir()) {
  const files = [
    join(cwd || process.cwd(), ".claude", "settings.json"),
    join(cwd || process.cwd(), ".claude", "settings.local.json"),
    join(home, ".claude", "settings.json"),
  ];
  if (process.env.CLAUDE_PROJECT_DIR) {
    files.push(join(process.env.CLAUDE_PROJECT_DIR, ".claude", "settings.json"), join(process.env.CLAUDE_PROJECT_DIR, ".claude", "settings.local.json"));
  }
  const rules = new Set();
  for (const f of files) {
    try {
      const allow = JSON.parse(readFileSync(f, "utf8"))?.permissions?.allow;
      if (Array.isArray(allow)) allow.forEach((r) => typeof r === "string" && rules.add(r));
    } catch {
      /* missing or invalid settings file */
    }
  }
  return [...rules];
}

const tokens = (s) => String(s).trim().split(/\s+/).filter(Boolean);

/** Up to `limit` allow rules closest to this call, best first. */
export function closestRules(rules, { tool, target }, limit = 3) {
  const scored = [];
  for (const rule of rules) {
    const m = /^([\w-]+)(?:\((.*)\))?$/.exec(rule.trim());
    if (!m || m[1] !== tool) continue;
    const spec = m[2];
    if (spec === undefined) {
      scored.push([0.5, rule]);
      continue;
    }
    if (tool === "Bash" || tool === "PowerShell") {
      const want = tokens(spec.replace(/:\*$|\s*\*$/, ""));
      const have = tokens(target);
      let k = 0;
      while (k < want.length && k < have.length && want[k] === have[k]) k++;
      if (k > 0) scored.push([k + (k === want.length ? 0.25 : 0), rule]);
    } else {
      const want = spec.replace(/\*+$/, "").replace(/\\/g, "/");
      const have = String(target).replace(/\\/g, "/");
      let k = 0;
      while (k < want.length && k < have.length && want[k] === have[k]) k++;
      if (k > 2) scored.push([k / 10, rule]);
    }
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, r]) => r);
}

// ---------- decision messages ----------

export const READ_CONFIG_MESSAGE =
  "Denied on Mesa (Lee tus configuraciones): do not ask for this. Read your own allow rules in .claude/settings.json and " +
  ".claude/settings.local.json (project and ~/.claude) and retry with a command shape they already allow.";

export function decisionOutput(approval, { tool, summary, hints }) {
  const what = `${tool} ${summary}`;
  if (approval.status === "decided" && approval.decision === "allow") return output("allow");
  if (approval.status === "decided" && approval.decision === "read_config") {
    const hint = hints.length ? ` Closest allow rule: ${hints[0]}.` : " No allow rule is close to this call.";
    const note = approval.note ? ` Andrés: ${approval.note}` : "";
    return deny(`${READ_CONFIG_MESSAGE}${hint}${note}`);
  }
  if (approval.status === "decided") {
    return deny(`Denied on Mesa by ${approval.decidedBy ?? "Andrés"}: ${what} was not approved.${approval.note ? ` Note: ${approval.note}` : ""}`);
  }
  return deny(
    `Denied: nobody approved ${what} on Mesa (${approval.id}) before the timeout. Do not retry it. ` +
      "Post a ticket question instead (mesa ticket reply <ref> --body ...) saying what you need and why.",
  );
}

// ---------- the flow ----------

/** Files the approval, waits for the decision, returns the hook output. Never throws; never allows by default. */
export async function approve(input, { base, token, timeoutMs = 540_000, fetchImpl = fetch, env = process.env, home } = {}) {
  const deadline = Date.now() + timeoutMs;
  let card;
  try {
    card = describe(input);
  } catch (err) {
    return deny(`Denied: the Mesa approval hook could not read this request (${err.message}).`);
  }
  const hints = closestRules(readAllowRules(input.cwd, home), card);
  const headers = { "content-type": "application/json", ...(token ? { "x-mesa-token": token } : {}) };
  const call = async (path, body, timeout = 5000) => {
    const res = await fetchImpl(`${base}${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message ?? `Mesa answered ${res.status}`);
    return data;
  };

  let approval;
  try {
    ({ approval } = await call("/api/approvals", {
      ticketRef: env.MESA_TICKET || null,
      agent: env.MESA_AGENT || input.agent_type || input.agent_id || "lead",
      tool: card.tool,
      summary: card.summary,
      detail: card.detail,
      cwd: input.cwd ?? "",
      hints,
      expiresAt: new Date(deadline).toISOString(),
    }));
  } catch (err) {
    return deny(`Denied: Mesa is unreachable, so nobody could approve ${card.tool} ${card.summary} (${err.message}).`);
  }

  // Long-poll; a board restart while we wait still gets the real decision. Mesa refuses
  // any decision after expiresAt, so a call we deny on timeout can never be allowed later.
  while (Date.now() < deadline) {
    const wait = Math.max(1, Math.min(WAIT_S, Math.ceil((deadline - Date.now()) / 1000)));
    try {
      ({ approval } = await call(`/api/approvals/${approval.id}?wait=${wait}`, undefined, (wait + 5) * 1000));
      if (approval.status !== "pending") break;
    } catch {
      await sleep(2000);
    }
  }
  return decisionOutput(approval, { ...card, hints });
}

async function main() {
  let result;
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    result = await approve(input, {
      base: (process.env.MESA_URL ?? "http://127.0.0.1:8790").replace(/\/$/, ""),
      token: process.env.MESA_TOKEN,
      timeoutMs: Number(process.env.MESA_APPROVAL_TIMEOUT_MS || 540_000),
    });
  } catch (err) {
    result = deny(`Denied: the Mesa approval hook failed (${err.message}).`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
