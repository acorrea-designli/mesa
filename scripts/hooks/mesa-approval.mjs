#!/usr/bin/env node
// PermissionRequest hook: a call an agent is not allowed to make becomes an approval card inside its Mesa ticket,
// and the call waits until Andrés presses one of three buttons there (docs/TEAM.md § Permissions, preamble rule 9):
//
//   allow        "Dar permiso"            -> allow this one call. Never updatedPermissions, never updatedInput.
//   read_config  "Lee tus configuraciones"-> deny, telling the agent to read its allow rules and reshape the call.
//   deny         "Denegar"                -> deny, with Andrés's optional note.
//
// A timeout, an unreachable Mesa, an expired card, bad input or any crash is a deny that tells the agent to post a
// ticket question instead of retrying. The lead session (no agent id) is passed through untouched (no output), so
// Andrés keeps his normal terminal prompt there; MESA_APPROVAL_LEAD=1 routes the lead to Mesa too: to the ticket it
// named with `mesa lead focus <ref>` (GET /api/lead/focus), else to Hoy, Permisos (no ticket).
//
//   stdin  : hook JSON { tool_name, tool_input, cwd, agent_id?, transcript_path, session_id, ... }
//   stdout : { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior, message? } } }
//
// env: MESA_URL (default http://127.0.0.1:8790), MESA_TOKEN, MESA_AGENT / MESA_TICKET (separately launched sessions
//      only), MESA_APPROVAL_TIMEOUT_MS (default 540000; keep it under the
//      registered hook timeout of 600 s), MESA_APPROVAL_POLL_MS (default 2000).
import { pathToFileURL } from "node:url";
import { closestRules, loadAllowRules, mesaCall, parseName, readStdinJson, resolveAgent } from "./lib.mjs";

const MAX_DETAIL = 20_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const output = (behavior, message) => ({
  hookSpecificOutput: {
    hookEventName: "PermissionRequest",
    decision: message ? { behavior, message } : { behavior },
  },
});
const deny = (message) => output("deny", message);

const NO_RETRY =
  "Do not retry this call and do not try another route to the same effect. Post a ticket question instead " +
  "(`node G:/WorkSpace/designli/ops/bin/mesa ticket reply <ticket> --body -` with A/B options and your recommendation) " +
  "or send `BLOCKED <ticket> <why>` to team-lead, then continue with whatever does not need this call.";

const cut = (s) => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL)}\n[cut: ${s.length - MAX_DETAIL} more characters]` : s);

// What the card shows: one summary line and the exact call.
export function describe(input) {
  const tool = String(input?.tool_name ?? "");
  const ti = input?.tool_input ?? {};
  if (!tool) throw new Error("hook input has no tool_name");
  if (tool === "Bash" || tool === "PowerShell") {
    const command = String(ti.command ?? "");
    if (!command.trim()) throw new Error("hook input has no command");
    const first = command.split("\n")[0];
    const summary = String(ti.description ?? "") || (first.length > 80 ? `${first.slice(0, 80)}...` : first);
    return { tool, summary, detail: cut(`$ ${command}${input.cwd ? `\n(cwd: ${input.cwd})` : ""}`) };
  }
  const file = ti.file_path ?? ti.notebook_path ?? ti.path;
  if (tool === "Edit" && file) {
    return { tool, summary: `Edit ${file}`, detail: cut(`--- old\n${ti.old_string ?? ""}\n+++ new\n${ti.new_string ?? ""}`) };
  }
  if (tool === "Write" && file) {
    return { tool, summary: `Write ${file}`, detail: cut(String(ti.content ?? "")) };
  }
  return { tool, summary: file ? `${tool} ${file}` : tool, detail: cut(JSON.stringify(ti, null, 2)) };
}

export function readConfigMessage(hints, ticketRef) {
  const lines = [
    `Andrés answered "Lee tus configuraciones" on ${ticketRef ?? "Mesa"}: this call is denied because an allowed shape already exists.`,
    "Read your own allow rules (permissions.allow in .claude/settings.json and .claude/settings.local.json at the project root, and the user settings.json) and the command sheet in your role definition, then retry with an allowed shape. Do not ask again for this call.",
  ];
  if (hints.rules.length) lines.push(`Closest allow rules: ${hints.rules.join("; ")}`);
  if (hints.advice.length) lines.push(`Shape: ${hints.advice.join("; ")}.`);
  return lines.join("\n");
}

async function leadFocus(opts) {
  try {
    const data = await mesaCall("/api/lead/focus", { ...opts, timeoutMs: 3000 });
    return typeof data.ticketRef === "string" && data.ticketRef ? data.ticketRef : null;
  } catch {
    return null;
  }
}

// Files the card, waits for the decision, returns the hook output (or null to pass the lead through).
// Never throws and never allows by default.
export async function approve(
  input,
  { timeoutMs = 540_000, pollMs = 2000, waitSec = 25, fetchImpl = fetch, base, env = process.env, rules } = {},
) {
  let agent;
  let call;
  let hints;
  try {
    agent = resolveAgent(input);
    // A separately launched session (claude -p) carries its identity in MESA_AGENT / MESA_TICKET. In-process
    // teammates share the lead's environment, so for them the name from the transcript always wins.
    if ((!agent || !agent.role) && env.MESA_AGENT) {
      const named = parseName(env.MESA_AGENT);
      agent = { ...named, ticketRef: named.ticketRef ?? env.MESA_TICKET ?? null };
    }
    if (!agent && env.MESA_APPROVAL_LEAD !== "1") return null;
    call = describe(input);
    hints = closestRules(input, rules ?? loadAllowRules(input?.cwd, env));
  } catch (err) {
    return deny(`Denied: the Mesa approval hook could not read this request (${err.message}). ${NO_RETRY}`);
  }
  const who = agent?.name ?? "lead";
  const deadline = Date.now() + timeoutMs;
  const opts = { fetchImpl, base };
  // The lead has no ticket of its own: while it names one ("mesa lead focus <ref>"), its prompts are filed there.
  // No focus, a closed ticket or an unreachable Mesa all read as null, and the card stays in Hoy, Permisos.
  const ticketRef = agent ? (agent.ticketRef ?? null) : await leadFocus(opts);

  let id;
  try {
    const data = await mesaCall("/api/approvals", {
      ...opts,
      body: {
        ticketRef,
        agent: who,
        role: agent?.role ?? (agent ? null : "lead"),
        tool: call.tool,
        summary: call.summary,
        detail: call.detail,
        cwd: input.cwd ?? null,
        hints: [...hints.rules, ...hints.advice],
        expiresAt: new Date(deadline).toISOString(),
      },
    });
    id = data.approval?.id ?? data.id;
    if (!id) throw new Error("Mesa returned no approval id");
  } catch (err) {
    return deny(`Denied: Mesa is unreachable, so nobody could approve ${call.tool} (${call.summary}) (${err.message}). ${NO_RETRY}`);
  }

  // Long-poll (GET /api/approvals/:id?wait=N, N <= 55). Mesa expires the card at expiresAt and refuses any decision
  // after it, so a call this hook denies on timeout can never be allowed later.
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
    if (a.decision === "allow") return output("allow");
    if (a.decision === "read_config") return deny(readConfigMessage(hints, ticketRef));
    if (a.decision === "deny") {
      const note = a.note ? ` Note from Andrés: ${a.note}` : "";
      return deny(`Denied by Andrés in Mesa (${ticketRef ?? "approval"} ${id}): ${call.tool} (${call.summary}) was not approved.${note} ${NO_RETRY}`);
    }
    if (a.status && a.status !== "pending") {
      return deny(`Denied: approval ${id} was closed (${a.status}) without a decision. ${NO_RETRY}`);
    }
  }
  return deny(`Denied: nobody answered approval ${id} for ${call.tool} (${call.summary}) before the timeout. ${NO_RETRY}`);
}

async function main() {
  let result;
  try {
    const input = await readStdinJson();
    result = await approve(input, {
      timeoutMs: Number(process.env.MESA_APPROVAL_TIMEOUT_MS || 540_000),
      pollMs: Number(process.env.MESA_APPROVAL_POLL_MS || 2000),
    });
  } catch (err) {
    result = deny(`Denied: the Mesa approval hook failed (${err.message}). ${NO_RETRY}`);
  }
  if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
