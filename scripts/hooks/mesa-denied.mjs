#!/usr/bin/env node
// PermissionDenied hook (t128 part H, docs/TEAM.md § 6.7): a call that auto mode already denied becomes a
// "Bloqueado por el modo automático" card inside the agent's Mesa ticket (Bash, PowerShell, MCP, Edit, any tool). The hook
// waits up to 120 s for Andrés, except for a file edit that no rule can cover (it can only be denied: it returns at once
// and the card expires on its own):
//
//   Permitir esta regla (an Edit card) -> the Mesa server (never this hook, never Claude) derives one narrow Edit rule
//                          from the stored call and appends it to settings.local.json; this hook then prints retry: true
//                          so the agent may retry the exact call once.
//   Permitir esta vez (any other call) -> the Mesa server stores a one-shot grant for exactly that call, bound to the
//                          caller and session; this hook marks the grant hint and prints retry: true, and on the retry
//                          the PreToolUse hook (mesa-guardrails.mjs, after every G-rule) consumes the grant and allows
//                          that one call. The same call a second time, or any other call, is denied as before.
//   Denegar, a timeout, an expired card, an unreachable Mesa, bad input or any crash -> no output: the denial stands.
//
// The hook never sends, computes or writes a rule or a grant, and it never edits a settings file. The denial itself cannot be undone
// from a hook; `retry: true` only tells the model it may try again (and the CLI ignores it when the classifier gave no
// verdict). The lead session (no agent id) is passed through untouched, like mesa-approval.mjs, unless
// MESA_APPROVAL_LEAD=1: then its denials are filed to the ticket named with `mesa lead focus <ref>`, else to Hoy.
//
//   stdin  : hook JSON { tool_name, tool_input, reason, cwd, agent_id?, transcript_path, session_id, ... }
//   stdout : { hookSpecificOutput: { hookEventName: "PermissionDenied", retry: true } }   (only after an allow)
//
// env: MESA_URL (default http://127.0.0.1:8790), MESA_TOKEN, MESA_AGENT / MESA_TICKET (separately launched sessions
//      only), MESA_DENIED_TIMEOUT_MS (default 120000; keep it under the registered hook timeout of 150 s),
//      MESA_DENIED_POLL_MS (default 2000).
import { pathToFileURL } from "node:url";
import { markGrantHint, mesaCall, parseName, readStdinJson, resolveAgent } from "./lib.mjs";
import { describe } from "./mesa-approval.mjs";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const RETRY = { hookSpecificOutput: { hookEventName: "PermissionDenied", retry: true } };

async function leadFocus(opts) {
  try {
    const data = await mesaCall("/api/lead/focus", { ...opts, timeoutMs: 3000 });
    return typeof data.ticketRef === "string" && data.ticketRef ? data.ticketRef : null;
  } catch {
    return null;
  }
}

// Files the card, waits for the decision, returns RETRY after Andrés's allow and null in every other case (or to pass
// the lead through). Never throws and never retries by default.
export async function denied(input, { timeoutMs = 120_000, pollMs = 2000, waitSec = 25, fetchImpl = fetch, base, env = process.env } = {}) {
  let agent;
  let call;
  try {
    agent = resolveAgent(input);
    if ((!agent || !agent.role) && env.MESA_AGENT) {
      const named = parseName(env.MESA_AGENT);
      agent = { ...named, ticketRef: named.ticketRef ?? env.MESA_TICKET ?? null };
    }
    if (!agent && env.MESA_APPROVAL_LEAD !== "1") return null;
    call = describe(input);
    const ti = input.tool_input;
    if (!ti || typeof ti !== "object" || Array.isArray(ti) || !Object.keys(ti).length) return null;
  } catch {
    return null;
  }
  const who = agent?.name ?? "lead";
  const deadline = Date.now() + timeoutMs;
  const opts = { fetchImpl, base };
  const ticketRef = agent ? (agent.ticketRef ?? null) : await leadFocus(opts);

  let id;
  try {
    const data = await mesaCall("/api/approvals", {
      ...opts,
      body: {
        kind: "denied",
        ticketRef,
        agent: who,
        role: agent?.role ?? (agent ? null : "lead"),
        tool: call.tool,
        summary: call.summary.slice(0, 500),
        detail: call.detail,
        cwd: input.cwd ?? null,
        reason: String(input.reason ?? "").slice(0, 2000),
        toolInput: input.tool_input,
        sessionId: String(input.session_id ?? ""),
        expiresAt: new Date(deadline).toISOString(),
      },
    });
    id = data.approval?.id ?? data.id;
    if (!id) return null;
    // A file edit the server can derive no rule for (a path outside the worktrees, .claude, settings...) can only be
    // denied, so there is nothing to wait for: it stays visible and expires on its own. Every other call can be allowed
    // once, so the hook waits for the decision.
    if (EDIT_TOOLS.has(call.tool) && !data.approval?.rule) return null;
  } catch {
    return null;
  }

  // Long-poll (GET /api/approvals/:id?wait=N, N <= 55). Mesa expires the card at expiresAt and refuses any decision
  // after it, so a denial this hook let stand on timeout can never be allowed later.
  while (Date.now() < deadline) {
    const wait = Math.max(1, Math.min(waitSec, Math.ceil((deadline - Date.now()) / 1000)));
    let a;
    try {
      const data = await mesaCall(`/api/approvals/${encodeURIComponent(id)}?wait=${wait}`, { ...opts, timeoutMs: (wait + 5) * 1000 });
      a = data.approval ?? data;
    } catch {
      await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
      continue; // a Mesa restart while we wait still gets its real decision; the deadline ends it
    }
    // Only a decision stamped by his UI routes counts (see mesa-approval.mjs and docs/TEAM.md § 6.6).
    if (a.decision && a.decidedBy !== "andres") return null;
    if (a.decision === "allow") {
      if (!EDIT_TOOLS.has(call.tool)) markGrantHint(env);
      return RETRY;
    }
    if (a.decision) return null;
    if (a.status && a.status !== "pending") return null;
  }
  return null;
}

async function main() {
  let result = null;
  try {
    const input = await readStdinJson();
    result = await denied(input, {
      timeoutMs: Number(process.env.MESA_DENIED_TIMEOUT_MS || 120_000),
      pollMs: Number(process.env.MESA_DENIED_POLL_MS || 2000),
    });
  } catch {
    result = null;
  }
  if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
