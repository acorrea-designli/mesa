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
    "POST /api/approvals": [201, { approval: { id: "ap1", rule, once: !rule } }],
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
function runGuard(input, env, { retired = [] } = {}) {
  return new Promise((resolve) => {
    const hits = [];
    const bodies = [];
    const server = createServer((req, res) => {
      hits.push(req.url);
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        try {
          bodies.push(raw ? JSON.parse(raw) : null);
        } catch {
          bodies.push(null);
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(req.url.includes("/grants/consume") ? { granted: true, approvalId: "ap_demo" } : req.url.startsWith("/api/team") ? { agents: retired.map((name) => ({ name })) } : {}));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const child = spawn(process.execPath, [GUARD], { env: { ...process.env, ...env, MESA_URL: `http://127.0.0.1:${server.address().port}` } });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => {
        server.close();
        resolve({ code, out, err, hits, bodies });
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

test("end to end, SendMessage (t150): a clean message gets the one-shot allow with the exact input; a G2 or G3 block stays blocked and never asks", async () => {
  const dir = tmp();
  try {
    const env = hintEnv(dir);
    writeFileSync(env.MESA_GRANT_HINT, "1");
    const mate = fakeAgent({ name: "dev-t150-4" }).input;
    const send = (tool_input, opts) => runGuard({ ...mate, tool_name: "SendMessage", tool_input }, env, opts);
    const asked = (r) => r.hits.filter((u) => u.includes("/grants/consume")).length;
    const clean = { to: "tl-t150-2", summary: "READY t150", message: "READY t150 PR https://x/pull/59 at abc1234" };
    const ok = await send(clean);
    assert.equal(ok.code, 0);
    assert.deepEqual(JSON.parse(ok.out), grantAllowOutput("ap_demo"));
    assert.equal(asked(ok), 1);
    const body = ok.bodies[ok.hits.findIndex((u) => u.includes("/grants/consume"))];
    assert.deepEqual(body, { tool: "SendMessage", toolInput: clean, caller: "dev-t150-4", sessionId: "sess-1" });
    // G3: over 12 non-empty lines.
    const long = await send({ ...clean, message: Array.from({ length: 13 }, (_, i) => `line ${i + 1}`).join("\n") });
    assert.equal(long.code, 2);
    assert.match(long.err, /guardrail G3/);
    assert.equal(long.out, "");
    assert.equal(asked(long), 0);
    // G3: an acknowledgement-only message.
    const ack = await send({ ...clean, message: "ok, thanks" });
    assert.equal(ack.code, 2);
    assert.match(ack.err, /guardrail G3/);
    assert.equal(asked(ack), 0);
    // G2: a retired recipient.
    const gone = await send({ ...clean, to: "reviewer-t12" }, { retired: ["reviewer-t12"] });
    assert.equal(gone.code, 2);
    assert.match(gone.err, /guardrail G2/);
    assert.equal(gone.out, "");
    assert.equal(asked(gone), 0);
    // Without the hint nothing is asked and nothing is answered, even for a clean message.
    rmSync(env.MESA_GRANT_HINT);
    const plain = await send(clean);
    assert.deepEqual([plain.code, plain.out, asked(plain)], [0, "", 0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the hook marks the grant hint after an allowed SendMessage card, like a command", async () => {
  const dir = tmp();
  try {
    const { input } = fakeAgent({ name: "dev-t150-4" });
    const env = hintEnv(dir);
    const mesa = decision("allow");
    const msg = { ...input, hook_event_name: "PermissionDenied", tool_name: "SendMessage", tool_input: { to: "tl-t150-2", message: "READY t150" }, reason: "Classifier unavailable", cwd: "G:/WorkSpace/designli" };
    assert.deepEqual(await denied(msg, { ...fast, env, fetchImpl: mesa.fetchImpl }), RETRY);
    assert.equal(grantHintFresh(env), true);
    assert.equal(mesa.calls[0].body.tool, "SendMessage");
    assert.deepEqual(mesa.calls[0].body.toolInput, msg.tool_input);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the hook trusts the server's `once`: a card the server cannot allow once returns at once and marks nothing", async () => {
  const dir = tmp();
  try {
    const { input } = fakeAgent({ name: "dev-t143-2" });
    const env = hintEnv(dir);
    const mesa = fakeMesa({
      "POST /api/approvals": [201, { approval: { id: "ap2", rule: "", once: false } }],
      "GET /api/approvals/ap2": { approval: { id: "ap2", status: "decided", decision: "allow", decidedBy: "andres" } },
    });
    const t0 = Date.now();
    assert.equal(await denied({ ...bash(input, "git status"), tool_name: "Read", tool_input: { file_path: "C:/x" } }, { ...fast, timeoutMs: 5000, env, fetchImpl: mesa.fetchImpl }), null);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(mesa.calls.length, 1); // only the POST: nothing to wait for
    assert.equal(grantHintFresh(env), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
