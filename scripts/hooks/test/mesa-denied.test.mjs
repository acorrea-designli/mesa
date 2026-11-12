import { test } from "node:test";
import assert from "node:assert/strict";
import { denied, RETRY } from "../mesa-denied.mjs";
import { fakeAgent, fakeMesa, unreachable } from "./helpers.mjs";

const FILE = "G:/WorkSpace/designli-wt/dev-t128-2/scripts/hooks/calendar-body.mjs";
const RULE = "Edit(//g/WorkSpace/designli-wt/dev-t128-2/scripts/hooks/**)";
const edit = (agentInput, over = {}) => ({
  ...agentInput,
  hook_event_name: "PermissionDenied",
  tool_name: "Edit",
  tool_input: { file_path: FILE, old_string: "a", new_string: "b" },
  tool_use_id: "toolu_1",
  reason: "[Self-Modification]",
  cwd: "G:/WorkSpace/designli",
  ...over,
});
const fast = { timeoutMs: 200, pollMs: 5, waitSec: 1, env: {} };

const decided = (decision, extra = {}) =>
  fakeMesa({
    "POST /api/approvals": [201, { approval: { id: "ap1", rule: RULE } }],
    "GET /api/approvals/ap1": { approval: { id: "ap1", status: "decided", decision, decidedBy: "andres", ...extra } },
  });

test("the retry output carries only retry: true, never a rule or a permission update", () => {
  assert.deepEqual(RETRY, { hookSpecificOutput: { hookEventName: "PermissionDenied", retry: true } });
});

test("Permitir esta regla prints retry: true", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  const mesa = decided("allow");
  const r = await denied(edit(input), { ...fast, fetchImpl: mesa.fetchImpl });
  assert.deepEqual(r, RETRY);
});

test("the card is filed in the agent's ticket with the call, the reason and no rule", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  const mesa = decided("allow");
  await denied(edit(input), { ...fast, fetchImpl: mesa.fetchImpl });
  const filed = mesa.calls[0].body;
  assert.equal(mesa.calls[0].key, "POST /api/approvals");
  assert.equal(filed.kind, "denied");
  assert.equal(filed.ticketRef, "t128");
  assert.equal(filed.agent, "dev-t128-2");
  assert.equal(filed.role, "dev");
  assert.equal(filed.tool, "Edit");
  assert.equal(filed.reason, "[Self-Modification]");
  assert.equal(filed.cwd, "G:/WorkSpace/designli");
  assert.match(filed.summary, /^Edit G:\/WorkSpace\/designli-wt\/dev-t128-2\/scripts\/hooks\/calendar-body\.mjs$/);
  assert.match(filed.detail, /--- old\na\n\+\+\+ new\nb/);
  assert.deepEqual(filed.toolInput, { file_path: FILE, old_string: "a", new_string: "b" });
  assert.ok(Date.parse(filed.expiresAt) > Date.now());
  assert.equal("rule" in filed, false); // the server derives it
  assert.equal(mesa.calls.some((c) => c.key.includes("/approve") || c.key.includes("/deny")), false); // the hook never decides
});

test("Denegar leaves the denial standing (no output)", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  assert.equal(await denied(edit(input), { ...fast, fetchImpl: decided("deny", { note: "no" }).fetchImpl }), null);
});

test("Lee tus configuraciones is not an allow", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  assert.equal(await denied(edit(input), { ...fast, fetchImpl: decided("read_config").fetchImpl }), null);
});

test("a timeout leaves the denial standing and decides nothing", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  const mesa = fakeMesa({
    "POST /api/approvals": [201, { approval: { id: "ap9", rule: RULE } }],
    "GET /api/approvals/ap9": { approval: { id: "ap9", status: "pending", decision: null } },
  });
  assert.equal(await denied(edit(input), { ...fast, timeoutMs: 60, fetchImpl: mesa.fetchImpl }), null);
  assert.ok(mesa.calls.some((c) => c.key.startsWith("GET /api/approvals/ap9?wait=")));
  assert.equal(mesa.calls.filter((c) => c.key.startsWith("POST")).length, 1);
});

test("an expired card leaves the denial standing", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  const mesa = fakeMesa({
    "POST /api/approvals": [201, { approval: { id: "ap2", rule: RULE } }],
    "GET /api/approvals/ap2": { approval: { id: "ap2", status: "expired", decision: null } },
  });
  assert.equal(await denied(edit(input), { ...fast, fetchImpl: mesa.fetchImpl }), null);
});

test("an unreachable Mesa leaves the denial standing, without throwing", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  assert.equal(await denied(edit(input), { ...fast, fetchImpl: unreachable }), null);
});

test("a Mesa error when filing the card leaves the denial standing", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  const mesa = fakeMesa({ "POST /api/approvals": [409, { error: { message: "ticket closed" } }] });
  assert.equal(await denied(edit(input), { ...fast, fetchImpl: mesa.fetchImpl }), null);
});

test("Mesa going away while it waits still ends at the deadline with no retry", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  let n = 0;
  const fetchImpl = async (...a) => {
    if (n++ === 0) return fakeMesa({ "POST /api/approvals": [201, { approval: { id: "ap3", rule: RULE } }] }).fetchImpl(...a);
    throw new TypeError("fetch failed");
  };
  assert.equal(await denied(edit(input), { ...fast, timeoutMs: 80, fetchImpl }), null);
});

test("a decision not stamped by Andrés never retries, even an allow", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  assert.equal(await denied(edit(input), { ...fast, fetchImpl: decided("allow", { decidedBy: "dev-t12" }).fetchImpl }), null);
});

test("bad input leaves the denial standing and files nothing", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  const mesa = decided("allow");
  assert.equal(await denied({ ...input, tool_name: "" }, { ...fast, fetchImpl: mesa.fetchImpl }), null);
  assert.equal(await denied({ ...input, tool_name: "Edit", tool_input: "x" }, { ...fast, fetchImpl: mesa.fetchImpl }), null);
  assert.equal(await denied({ ...input, tool_name: "Edit", tool_input: {} }, { ...fast, fetchImpl: mesa.fetchImpl }), null);
  assert.equal(mesa.calls.length, 0);
});

test("a Bash denial is filed too (the server then offers only Denegar)", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  const mesa = decided("deny");
  await denied({ ...input, tool_name: "Bash", tool_input: { command: "rm -rf build", description: "Clean" }, reason: "[Irreversible Local Destruction]" }, { ...fast, fetchImpl: mesa.fetchImpl });
  assert.equal(mesa.calls[0].body.tool, "Bash");
  assert.match(mesa.calls[0].body.detail, /\$ rm -rf build/);
});

test("a separately launched session is identified by MESA_AGENT and MESA_TICKET", async () => {
  const mesa = decided("allow");
  const bare = { tool_name: "Edit", tool_input: { file_path: FILE }, reason: "[Self-Modification]", transcript_path: "x.jsonl", session_id: "s" };
  await denied(bare, { ...fast, env: { MESA_AGENT: "researcher-t8" }, fetchImpl: mesa.fetchImpl });
  assert.equal(mesa.calls[0].body.ticketRef, "t8");
  const other = decided("allow");
  await denied(bare, { ...fast, env: { MESA_AGENT: "triage-am", MESA_TICKET: "t3" }, fetchImpl: other.fetchImpl });
  assert.deepEqual([other.calls[0].body.agent, other.calls[0].body.ticketRef], ["triage-am", "t3"]);
});

test("the lead passes through untouched unless MESA_APPROVAL_LEAD=1, then it is filed to its focus ticket", async () => {
  const lead = { tool_name: "Edit", tool_input: { file_path: FILE }, reason: "[Self-Modification]", transcript_path: "x.jsonl", session_id: "s" };
  assert.equal(await denied(lead, { ...fast, fetchImpl: unreachable }), null);
  const mesa = fakeMesa({
    "GET /api/lead/focus": { ticketRef: "t128" },
    "POST /api/approvals": [201, { approval: { id: "ap1", rule: RULE } }],
    "GET /api/approvals/ap1": { approval: { id: "ap1", status: "decided", decision: "allow", decidedBy: "andres" } },
  });
  assert.deepEqual(await denied(lead, { ...fast, env: { MESA_APPROVAL_LEAD: "1" }, fetchImpl: mesa.fetchImpl }), RETRY);
  const filed = mesa.calls.find((c) => c.key === "POST /api/approvals").body;
  assert.deepEqual([filed.ticketRef, filed.agent, filed.role], ["t128", "lead", "lead"]);
});

test("a card with no rule can only be denied: the hook returns at once, without polling", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  for (const approval of [{ id: "ap7", rule: "" }, { id: "ap7" }, { id: "ap7", rule: null }]) {
    const mesa = fakeMesa({
      "POST /api/approvals": [201, { approval }],
      "GET /api/approvals/ap7": { approval: { id: "ap7", status: "decided", decision: "allow", decidedBy: "andres" } },
    });
    const t0 = Date.now();
    assert.equal(await denied({ ...input, tool_name: "Bash", tool_input: { command: "rm x" }, reason: "[Irreversible Local Destruction]" }, { ...fast, timeoutMs: 5000, fetchImpl: mesa.fetchImpl }), null);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(mesa.calls.length, 1); // only the POST: the card stays visible and expires on its own
  }
});

test("a card with a rule still waits for the decision", async () => {
  const { input } = fakeAgent({ name: "dev-t128-2" });
  let polls = 0;
  const mesa = fakeMesa({
    "POST /api/approvals": [201, { approval: { id: "ap8", rule: RULE } }],
    "GET /api/approvals/ap8": () => {
      polls++;
      return { approval: polls < 3 ? { id: "ap8", status: "pending", decision: null } : { id: "ap8", status: "decided", decision: "allow", decidedBy: "andres" } };
    },
  });
  assert.deepEqual(await denied(edit(input), { ...fast, timeoutMs: 5000, fetchImpl: mesa.fetchImpl }), RETRY);
  assert.equal(polls, 3);
});
