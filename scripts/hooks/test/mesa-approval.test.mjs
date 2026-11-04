import { test } from "node:test";
import assert from "node:assert/strict";
import { approve, describe, output } from "../mesa-approval.mjs";
import { fakeAgent, fakeMesa, unreachable } from "./helpers.mjs";

const bash = (agentInput, command) => ({ ...agentInput, tool_name: "Bash", tool_input: { command, description: "List PR files" }, cwd: "G:/WorkSpace/designli" });
const rules = [
  { rule: "Bash(gh api repos/*)", file: "settings.json" },
  { rule: "Bash(node G:/WorkSpace/designli/ops/bin/mesa *)", file: "settings.json" },
  { rule: "PowerShell(gh api repos/*)", file: "settings.json" },
];
const fast = { timeoutMs: 200, pollMs: 5, waitSec: 1, rules, env: {} };

const decided = (decision, extra = {}) =>
  fakeMesa({
    "POST /api/approvals": { approval: { id: "ap1" } },
    "GET /api/approvals/ap1": { approval: { id: "ap1", status: "decided", decision, ...extra } },
    "POST /api/approvals/ap1/decision": { ok: true },
  });

const assertShape = (r, behavior) => {
  assert.equal(r.hookSpecificOutput.hookEventName, "PermissionRequest");
  assert.equal(r.hookSpecificOutput.decision.behavior, behavior);
  assert.equal(r.hookSpecificOutput.decision.updatedPermissions, undefined);
  assert.equal(r.hookSpecificOutput.decision.updatedInput, undefined);
  assert.deepEqual(Object.keys(r), ["hookSpecificOutput"]);
};

test("output shape carries only behavior and message", () => {
  assert.deepEqual(output("allow"), { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
  assert.deepEqual(output("deny", "x").hookSpecificOutput.decision, { behavior: "deny", message: "x" });
});

test("Dar permiso allows this one call, with no standing rule", async () => {
  const { input } = fakeAgent({ name: "reviewer-t12" });
  const mesa = decided("allow");
  const r = await approve(bash(input, "cd x && gh api repos/a/b/pulls/1"), { ...fast, fetchImpl: mesa.fetchImpl });
  assertShape(r, "allow");
  const filed = mesa.calls[0].body;
  assert.equal(filed.ticketRef, "t12");
  assert.equal(filed.agent, "reviewer-t12");
  assert.equal(filed.role, "reviewer");
  assert.equal(filed.tool, "Bash");
  assert.match(filed.detail, /\$ cd x && gh api/);
  assert.ok(Date.parse(filed.expiresAt) > Date.now());
});

test("Lee tus configuraciones denies with the closest allow rule and shape advice", async () => {
  const { input } = fakeAgent({ name: "devops-t14" });
  const r = await approve(bash(input, "cd G:/x && gh api repos/a/b/pulls/1 | head"), { ...fast, fetchImpl: decided("read_config").fetchImpl });
  assertShape(r, "deny");
  const m = r.hookSpecificOutput.decision.message;
  assert.match(m, /Lee tus configuraciones/);
  assert.match(m, /settings\.local\.json/);
  assert.match(m, /Bash\(gh api repos\/\*\)/);
  assert.match(m, /drop the leading `cd`/);
  assert.match(m, /without `&&`, `;` or pipes/);
});

test("Denegar denies with Andrés's note", async () => {
  const { input } = fakeAgent({ name: "dev-t3" });
  const r = await approve(bash(input, "rm -rf build"), { ...fast, fetchImpl: decided("deny", { note: "usa git clean en tu worktree" }).fetchImpl });
  assertShape(r, "deny");
  assert.match(r.hookSpecificOutput.decision.message, /Denied by Andrés.*t3/);
  assert.match(r.hookSpecificOutput.decision.message, /usa git clean/);
  assert.match(r.hookSpecificOutput.decision.message, /Do not retry/);
});

test("timeout denies, leaves expiry to Mesa and points at a ticket question", async () => {
  const { input } = fakeAgent({ name: "tl-t5" });
  const mesa = fakeMesa({
    "POST /api/approvals": { approval: { id: "ap9" } },
    "GET /api/approvals/ap9": { approval: { id: "ap9", status: "pending", decision: null } },
    "POST /api/approvals/ap9/decision": { ok: true },
  });
  const r = await approve(bash(input, "terraform plan"), { ...fast, timeoutMs: 60, fetchImpl: mesa.fetchImpl });
  assertShape(r, "deny");
  assert.match(r.hookSpecificOutput.decision.message, /before the timeout/);
  assert.match(r.hookSpecificOutput.decision.message, /ticket reply/);
  assert.equal(mesa.calls.some((c) => c.key.includes("/decision")), false);
  assert.ok(mesa.calls.some((c) => c.key.startsWith("GET /api/approvals/ap9?wait=")));
});

test("a separately launched session is identified by MESA_AGENT and MESA_TICKET", async () => {
  const mesa = decided("allow");
  const lead = { tool_name: "Bash", tool_input: { command: "ls" }, transcript_path: "x.jsonl", session_id: "s" };
  await approve(lead, { ...fast, env: { MESA_AGENT: "researcher-t8" }, fetchImpl: mesa.fetchImpl });
  assert.equal(mesa.calls[0].body.ticketRef, "t8");
  const other = decided("allow");
  await approve(lead, { ...fast, env: { MESA_AGENT: "triage-am", MESA_TICKET: "t3" }, fetchImpl: other.fetchImpl });
  assert.deepEqual([other.calls[0].body.agent, other.calls[0].body.ticketRef], ["triage-am", "t3"]);
});

test("unreachable Mesa denies", async () => {
  const { input } = fakeAgent({ name: "writer-t2" });
  const r = await approve(bash(input, "node render.mjs"), { ...fast, fetchImpl: unreachable });
  assertShape(r, "deny");
  assert.match(r.hookSpecificOutput.decision.message, /Mesa is unreachable/);
  assert.match(r.hookSpecificOutput.decision.message, /BLOCKED/);
});

test("Mesa error status denies", async () => {
  const { input } = fakeAgent({ name: "writer-t2" });
  const mesa = fakeMesa({ "POST /api/approvals": [500, { error: { message: "db locked" } }] });
  const r = await approve(bash(input, "node render.mjs"), { ...fast, fetchImpl: mesa.fetchImpl });
  assertShape(r, "deny");
  assert.match(r.hookSpecificOutput.decision.message, /db locked/);
});

test("expired card denies", async () => {
  const { input } = fakeAgent({ name: "writer-t2" });
  const mesa = fakeMesa({
    "POST /api/approvals": { approval: { id: "ap2" } },
    "GET /api/approvals/ap2": { approval: { id: "ap2", status: "expired", decision: null } },
  });
  const r = await approve(bash(input, "x"), { ...fast, fetchImpl: mesa.fetchImpl });
  assertShape(r, "deny");
  assert.match(r.hookSpecificOutput.decision.message, /closed \(expired\)/);
});

test("bad input denies", async () => {
  const { input } = fakeAgent({ name: "dev-t3" });
  const r = await approve({ ...input, tool_name: "Bash", tool_input: {} }, { ...fast, fetchImpl: unreachable });
  assertShape(r, "deny");
  assert.match(r.hookSpecificOutput.decision.message, /could not read/);
});

test("the lead passes through untouched unless MESA_APPROVAL_LEAD=1", async () => {
  const lead = { tool_name: "Bash", tool_input: { command: "ls" }, transcript_path: "x.jsonl", session_id: "s" };
  assert.equal(await approve(lead, { ...fast, fetchImpl: unreachable }), null);
  const r = await approve(lead, { ...fast, env: { MESA_APPROVAL_LEAD: "1" }, fetchImpl: decided("allow").fetchImpl });
  assertShape(r, "allow");
});

const leadInput = { tool_name: "Bash", tool_input: { command: "ls" }, transcript_path: "x.jsonl", session_id: "s" };
const withFocus = (ticketRef) =>
  fakeMesa({
    "GET /api/lead/focus": { ticketRef },
    "POST /api/approvals": { approval: { id: "ap1" } },
    "GET /api/approvals/ap1": { approval: { id: "ap1", status: "decided", decision: "allow" } },
  });

test("the lead's prompt is filed to the ticket named with `mesa lead focus`", async () => {
  const mesa = withFocus("t10");
  assertShape(await approve(leadInput, { ...fast, env: { MESA_APPROVAL_LEAD: "1" }, fetchImpl: mesa.fetchImpl }), "allow");
  const filed = mesa.calls.find((c) => c.key === "POST /api/approvals").body;
  assert.equal(filed.ticketRef, "t10");
  assert.equal(filed.agent, "lead");
  assert.equal(filed.role, "lead");
});

test("with no focus (or an unreachable focus) the lead's prompt has no ticket and shows in Hoy, Permisos", async () => {
  const none = withFocus(null);
  await approve(leadInput, { ...fast, env: { MESA_APPROVAL_LEAD: "1" }, fetchImpl: none.fetchImpl });
  assert.equal(none.calls.find((c) => c.key === "POST /api/approvals").body.ticketRef, null);
  const down = fakeMesa({
    "POST /api/approvals": { approval: { id: "ap1" } },
    "GET /api/approvals/ap1": { approval: { id: "ap1", status: "decided", decision: "allow" } },
  });
  await approve(leadInput, { ...fast, env: { MESA_APPROVAL_LEAD: "1" }, fetchImpl: down.fetchImpl });
  assert.equal(down.calls.find((c) => c.key === "POST /api/approvals").body.ticketRef, null);
});

test("an agent keeps its own ticket whatever the lead's focus is, and the lead pass-through never reads it", async () => {
  const { input } = fakeAgent({ name: "dev-t12" });
  const mesa = withFocus("t10");
  await approve(bash(input, "ls"), { ...fast, fetchImpl: mesa.fetchImpl });
  assert.equal(mesa.calls.find((c) => c.key === "POST /api/approvals").body.ticketRef, "t12");
  assert.equal(mesa.calls.some((c) => c.key.includes("/lead/focus")), false);
  const pass = withFocus("t10");
  assert.equal(await approve(leadInput, { ...fast, fetchImpl: pass.fetchImpl }), null);
  assert.deepEqual(pass.calls, []);
});

test("the hook decides nothing itself: it only files the card and reads it back", async () => {
  const { input } = fakeAgent({ name: "dev-t12" });
  const mesa = decided("allow");
  await approve(bash(input, "ls"), { ...fast, fetchImpl: mesa.fetchImpl });
  assert.deepEqual(
    mesa.calls.filter((c) => !c.key.startsWith("GET ")).map((c) => c.key),
    ["POST /api/approvals"],
  );
});

test("describe shows Edit and MCP calls", () => {
  assert.match(describe({ tool_name: "Edit", tool_input: { file_path: "a.ts", old_string: "x", new_string: "y" } }).detail, /--- old\nx\n\+\+\+ new\ny/);
  assert.equal(describe({ tool_name: "mcp__basecamp__get_todo", tool_input: { id: 1 } }).summary, "mcp__basecamp__get_todo");
});
