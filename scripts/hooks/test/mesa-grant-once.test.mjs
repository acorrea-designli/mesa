// "Permitir esta vez" (t143 PR5), the hook side: the denied hook marks the grant hint after Andres allows a call, and the
// PreToolUse hook consumes a grant only after every G-rule passed. node:test, no network except a local fake Mesa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { denied, RETRY } from "../mesa-denied.mjs";
import { grantAllow, grantAllowOutput } from "../mesa-guardrails.mjs";
import { callerName, grantHintFresh, markGrantHint } from "../lib.mjs";
import { fakeAgent, fakeMesa, unreachable } from "./helpers.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "mesa-grant-"));
const hintEnv = (dir) => ({ MESA_GRANT_HINT: join(dir, "hint") });
const fast = { timeoutMs: 200, pollMs: 5, waitSec: 1 };
const GUARD = fileURLToPath(new URL("../mesa-guardrails.mjs", import.meta.url));

const bash = (input, command, extra = {}) => ({ ...input, hook_event_name: "PermissionDenied", tool_name: "Bash", tool_input: { command, ...extra }, reason: "[Irreversible Local Destruction]", cwd: "G:/WorkSpace/designli" });
const decision = (decision, rule = "") =>
  fakeMesa({
    "POST /api/approvals": [201, { approval: { id: "ap1", rule } }],
    "GET /api/approvals/ap1": { approval: { id: "ap1", status: "decided", decision, decidedBy: "andres" } },
  });

test("Permitir esta vez on a command prints retry: true and marks the grant hint", async () => {
  const dir = tmp();
  try {
    const { input } = fakeAgent({ name: "dev-t143-2" });
    const env = hintEnv(dir);
    assert.equal(grantHintFresh(env), false);
    const mesa = decision("allow");
    assert.deepEqual(await denied(bash(input, "git push --dry-run origin x"), { ...fast, env, fetchImpl: mesa.fetchImpl }), RETRY);
    assert.equal(grantHintFresh(env), true);
    assert.equal(mesa.calls[0].body.sessionId, "sess-1");
    assert.equal(mesa.calls.some((c) => /grants|\/approve/.test(c.key)), false); // the hook never creates or sends a grant
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a deny, an Edit rule allow and a missing decision leave the hint alone", async () => {
  const dir = tmp();
  try {
    const { input } = fakeAgent({ name: "dev-t143-2" });
    const env = hintEnv(dir);
    assert.equal(await denied(bash(input, "x"), { ...fast, env, fetchImpl: decision("deny").fetchImpl }), null);
    const rule = "Edit(//g/WorkSpace/designli-wt/dev-t143-2/scripts/hooks/**)";
    const edit = { ...input, tool_name: "Edit", tool_input: { file_path: "G:/WorkSpace/designli-wt/dev-t143-2/scripts/hooks/a.mjs", old_string: "a", new_string: "b" }, reason: "[Self-Modification]" };
    assert.deepEqual(await denied(edit, { ...fast, env, fetchImpl: decision("allow", rule).fetchImpl }), RETRY);
    assert.equal(grantHintFresh(env), false); // an Edit is allowed by its rule, not by a grant
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the hint goes stale after six minutes", () => {
  const dir = tmp();
  try {
    const env = hintEnv(dir);
    markGrantHint(env);
    assert.equal(grantHintFresh(env), true);
    assert.equal(grantHintFresh(env, Date.now() + 7 * 60_000), false);
    const old = new Date(Date.now() - 7 * 60_000);
    utimesSync(env.MESA_GRANT_HINT, old, old);
    assert.equal(grantHintFresh(env), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("callerName is the agent's name, MESA_AGENT for a separate session, and lead for the main thread", () => {
  assert.equal(callerName(fakeAgent({ name: "dev-t143-2" }).input, {}), "dev-t143-2");
  assert.equal(callerName({ transcript_path: "x.jsonl", session_id: "s" }, {}), "lead");
  assert.equal(callerName({ transcript_path: "x.jsonl", session_id: "s" }, { MESA_AGENT: "researcher-t8" }), "researcher-t8");
});

test("grantAllow asks Mesa only while the hint is fresh, with the call, the caller and the session", async () => {
  const dir = tmp();
  try {
    const env = hintEnv(dir);
    const { input } = fakeAgent({ name: "dev-t143-2" });
    const call = { ...input, tool_name: "Bash", tool_input: { command: "git push --dry-run origin x", description: "Dry run" } };
    const mesa = fakeMesa({ "POST /api/approvals/grants/consume": { granted: true, approvalId: "ap1" } });
    assert.equal(await grantAllow(call, { env, fetchImpl: mesa.fetchImpl }), null);
    assert.equal(mesa.calls.length, 0); // no hint: an ordinary call costs no round trip
    markGrantHint(env);
    assert.deepEqual(await grantAllow(call, { env, fetchImpl: mesa.fetchImpl }), grantAllowOutput("ap1"));
    assert.deepEqual(mesa.calls[0].body, { tool: "Bash", toolInput: call.tool_input, caller: "dev-t143-2", sessionId: "sess-1" });
    assert.equal("hash" in mesa.calls[0].body, false); // the server hashes the call itself
    const lead = await grantAllow({ transcript_path: "x.jsonl", session_id: "L", tool_name: "mcp__x__y", tool_input: { a: 1 } }, { env, fetchImpl: mesa.fetchImpl });
    assert.equal(lead?.hookSpecificOutput.permissionDecision, "allow");
    assert.deepEqual([mesa.calls[1].body.caller, mesa.calls[1].body.sessionId], ["lead", "L"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no grant, an unreachable Mesa and a malformed answer all answer nothing", async () => {
  const dir = tmp();
  try {
    const env = hintEnv(dir);
    markGrantHint(env);
    const call = { transcript_path: "x.jsonl", session_id: "s", tool_name: "Bash", tool_input: { command: "x" } };
    assert.equal(await grantAllow(call, { env, fetchImpl: fakeMesa({ "POST /api/approvals/grants/consume": { granted: false } }).fetchImpl }), null);
    assert.equal(await grantAllow(call, { env, fetchImpl: fakeMesa({ "POST /api/approvals/grants/consume": { granted: true } }).fetchImpl }), null);
    assert.equal(await grantAllow(call, { env, fetchImpl: unreachable }), null);
    assert.equal(await grantAllow({ ...call, tool_input: [] }, { env, fetchImpl: unreachable }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The real hook as Claude Code runs it: stdin JSON in, exit code and stdout out, against a local fake Mesa that
// always grants. A G-rule block must still win, and the grant must not even be asked for then.
function runGuard(input, env) {
  return new Promise((resolve) => {
    const hits = [];
    const server = createServer((req, res) => {
      hits.push(req.url);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url.includes("/grants/consume") ? { granted: true, approvalId: "ap_demo" } : {}));
    });
    server.listen(0, "127.0.0.1", () => {
      const child = spawn(process.execPath, [GUARD], { env: { ...process.env, ...env, MESA_URL: `http://127.0.0.1:${server.address().port}` } });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => {
        server.close();
        resolve({ code, out, err, hits });
      });
      child.stdin.end(JSON.stringify(input));
    });
  });
}

test("end to end: a call a G-rule blocks stays blocked and never asks for the grant; a clean call is allowed", async () => {
  const dir = tmp();
  try {
    const env = hintEnv(dir);
    writeFileSync(env.MESA_GRANT_HINT, "1");
    const lead = { transcript_path: join(dir, "sess.jsonl"), session_id: "sess" };
    // G7: a bare force push is blocked, grant or not.
    const blocked = await runGuard({ ...lead, tool_name: "Bash", tool_input: { command: "git push --force origin main" } }, env);
    assert.equal(blocked.code, 2);
    assert.match(blocked.err, /guardrail G7/);
    assert.equal(blocked.out, "");
    assert.equal(blocked.hits.some((u) => u.includes("/grants/consume")), false);
    // G4 (a teammate writing to GitHub) wins too.
    const mate = fakeAgent({ name: "dev-t143-2" }).input;
    const g4 = await runGuard({ ...mate, tool_name: "Bash", tool_input: { command: "gh pr merge 5" } }, env);
    assert.equal(g4.code, 2);
    assert.equal(g4.hits.some((u) => u.includes("/grants/consume")), false);
    // A call no rule blocks gets the one-shot allow.
    const ok = await runGuard({ ...lead, tool_name: "Bash", tool_input: { command: "git push --dry-run origin x" } }, env);
    assert.equal(ok.code, 0);
    assert.deepEqual(JSON.parse(ok.out), grantAllowOutput("ap_demo"));
    assert.equal(ok.hits.filter((u) => u.includes("/grants/consume")).length, 1);
    // Without the hint nothing is asked and nothing is answered.
    rmSync(env.MESA_GRANT_HINT);
    const plain = await runGuard({ ...lead, tool_name: "Bash", tool_input: { command: "git status" } }, env);
    assert.deepEqual([plain.code, plain.out, plain.hits.length], [0, "", 0]);
    assert.equal(existsSync(env.MESA_GRANT_HINT), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
