#!/usr/bin/env node
// Stop / SubagentStop hook: a teammate does not stop without a handoff for its ticket in Mesa (preamble rule 6).
// Agents are ephemeral and nothing may depend on a context window, so the handoff is the only thing the next
// instance gets. The stop is refused once (the `stop_hook_active` guard prevents a loop) when:
//
//   H1  the agent has no handoff at all for its ticket, or
//   H2  its last word is DONE / SPENT (the task is over) and its newest handoff is not `done` or is older than
//       MESA_HANDOFF_FRESH_MIN (default 15) minutes, or
//   H3  Mesa is unreachable: the agent must put the handoff in engram and in a HANDOFF message to team-lead instead.
//
// The lead (no agent id) and agents whose name does not follow <role>-<ticket> are never blocked.
// stdout: { decision: "block", reason } or nothing.
import { pathToFileURL } from "node:url";
import { agentTranscriptPath, lastUtterance, mesaCall, readStdinJson, resolveAgent } from "./lib.mjs";

const MESA = "node G:/WorkSpace/designli/ops/bin/mesa";

const handoffCmd = (a, status) =>
  `\`${MESA} handoff ${a.ticketRef} --agent ${a.name} --status ${status} --body - <<'EOF'\` (what is done, what is left, ` +
  "where: file:line / PR / URLs, open questions, the next step for whoever resumes) `EOF`";

export async function check(input, { fetchImpl = fetch, base, now = Date.now(), env = process.env } = {}) {
  if (input?.stop_hook_active) return null;
  const agent = resolveAgent(input);
  if (!agent?.ticketRef) return null;

  let handoffs;
  try {
    const data = await mesaCall(`/api/handoffs?agent=${encodeURIComponent(agent.name)}`, { fetchImpl, base, timeoutMs: 4000 });
    handoffs = (data.handoffs ?? data ?? []).filter((h) => !h.ticketRef || h.ticketRef === agent.ticketRef);
  } catch (err) {
    return {
      decision: "block",
      reason:
        `Rule 6 (H3): Mesa is unreachable (${err.message}), so your handoff for ${agent.ticketRef} cannot be checked. ` +
        `Save it to engram (mem_save, topic_key mesa/${agent.ticketRef}/handoff/${agent.name}, type decision) and send it to ` +
        `team-lead as one message starting "HANDOFF ${agent.ticketRef} ${agent.name}", then stop.`,
    };
  }

  if (!handoffs.length) {
    return {
      decision: "block",
      reason: `Rule 6 (H1): ${agent.name} has no handoff for ${agent.ticketRef}. Before you stop, write it: ${handoffCmd(agent, "paused")}. Use --status done when your task is finished.`,
    };
  }

  const said = lastUtterance(agentTranscriptPath(input) ?? input?.transcript_path).trim();
  if (/^(DONE|SPENT)\b/.test(said)) {
    const newest = [...handoffs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    const ageMin = (now - Date.parse(newest.createdAt ?? 0)) / 60000;
    const fresh = Number(env.MESA_HANDOFF_FRESH_MIN ?? 15);
    if (newest.status !== "done" || !(ageMin <= fresh)) {
      return {
        decision: "block",
        reason: `Rule 6 (H2): you said DONE but your newest handoff for ${agent.ticketRef} is ${newest.status !== "done" ? `status ${newest.status ?? "unknown"}` : `${Math.round(ageMin)} min old`}. Write the final one: ${handoffCmd(agent, "done")}.`,
      };
    }
  }
  return null;
}

async function main() {
  let input;
  try {
    input = await readStdinJson();
  } catch {
    return; // unreadable input: never block on a broken guard
  }
  const r = await check(input).catch(() => null);
  if (r) process.stdout.write(`${JSON.stringify(r)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
