import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approve, closestRules, describe as describeCall, READ_CONFIG_MESSAGE } from "./mesa-approval.mjs";

const bash = (command, cwd = "") => ({ tool_name: "Bash", tool_input: { command }, cwd });

/** A fake Mesa: records the filed approval and answers polls with `final`. */
function fakeMesa(final, { failPost = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (failPost) throw new Error("ECONNREFUSED");
    const approval = { id: "ap_1", status: "pending", decision: null, note: "", decidedBy: null };
    if (init.method === "POST") return new Response(JSON.stringify({ approval }), { status: 201 });
    return new Response(JSON.stringify({ approval: { ...approval, ...final } }), { status: 200 });
  };
  return { calls, fetchImpl };
}

const home = mkdtempSync(join(tmpdir(), "mesa-hook-home-"));

describe("mesa-approval hook", () => {
  it("describes Bash and Edit calls", () => {
    assert.partialDeepStrictEqual(describeCall(bash("git push origin x", "/repo")), { tool: "Bash", summary: "git push origin x", detail: "$ git push origin x\n(cwd: /repo)" });
    const e = describeCall({ tool_name: "Edit", tool_input: { file_path: "a.ts", old_string: "a\nb", new_string: "a\nc" } });
    assert.equal(e.detail, " a\n-b\n+c");
  });

  it("ranks the closest allow rules", () => {
    const rules = ["Bash(git status:*)", "Bash(git push origin:*)", "Bash(pnpm test:*)", "Edit"];
    assert.deepEqual(closestRules(rules, { tool: "Bash", target: "git push origin feat/x" }), ["Bash(git push origin:*)", "Bash(git status:*)"]);
  });

  it("allow only on an explicit allow, with no updatedPermissions", async () => {
    const { fetchImpl, calls } = fakeMesa({ status: "decided", decision: "allow" });
    const out = await approve(bash("git push"), { base: "http://m", fetchImpl, timeoutMs: 5000, home, env: { MESA_AGENT: "dev-t1", MESA_TICKET: "t1" } });
    assert.deepEqual(out, { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
    assert.partialDeepStrictEqual(calls[0].body, { agent: "dev-t1", ticketRef: "t1", tool: "Bash" });
    assert.ok(!JSON.stringify(out).includes("updatedPermissions"));
  });

  it("read_config denies with the fixed message and the closest rule", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mesa-hook-"));
    mkdirSync(join(cwd, ".claude"));
    writeFileSync(join(cwd, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(git push origin:*)"] } }));
    const { fetchImpl, calls } = fakeMesa({ status: "decided", decision: "read_config" });
    const out = await approve(bash("git push --force", cwd), { base: "http://m", fetchImpl, timeoutMs: 5000, home, env: {} });
    assert.deepEqual(calls[0].body.hints, ["Bash(git push origin:*)"]);
    assert.equal(out.hookSpecificOutput.decision.behavior, "deny");
    assert.ok(out.hookSpecificOutput.decision.message.includes(READ_CONFIG_MESSAGE));
    assert.ok(out.hookSpecificOutput.decision.message.includes("Closest allow rule: Bash(git push origin:*)"));
  });

  it("deny carries the note; timeout tells the agent to ask in the ticket", async () => {
    const d = await approve(bash("rm -rf x"), { base: "http://m", fetchImpl: fakeMesa({ status: "decided", decision: "deny", note: "no", decidedBy: "andres" }).fetchImpl, timeoutMs: 5000, home, env: {} });
    assert.partialDeepStrictEqual(d.hookSpecificOutput.decision, { behavior: "deny" });
    assert.ok(d.hookSpecificOutput.decision.message.includes("Note: no"));
    const t = await approve(bash("rm -rf x"), { base: "http://m", fetchImpl: fakeMesa({ status: "expired" }).fetchImpl, timeoutMs: 5000, home, env: {} });
    assert.match(t.hookSpecificOutput.decision.message, /before the timeout\. Do not retry it\. Post a ticket question/);
  });

  it("denies when Mesa is unreachable or the input is bad", async () => {
    const u = await approve(bash("ls"), { base: "http://m", fetchImpl: fakeMesa({}, { failPost: true }).fetchImpl, timeoutMs: 5000, home, env: {} });
    assert.equal(u.hookSpecificOutput.decision.behavior, "deny");
    const b = await approve({}, { base: "http://m", fetchImpl: fakeMesa({}).fetchImpl, home, env: {} });
    assert.equal(b.hookSpecificOutput.decision.behavior, "deny");
  });
});
