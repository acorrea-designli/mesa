import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
    expect(describeCall(bash("git push origin x", "/repo"))).toMatchObject({ tool: "Bash", summary: "git push origin x", detail: "$ git push origin x\n(cwd: /repo)" });
    const e = describeCall({ tool_name: "Edit", tool_input: { file_path: "a.ts", old_string: "a\nb", new_string: "a\nc" } });
    expect(e.detail).toBe(" a\n-b\n+c");
  });

  it("ranks the closest allow rules", () => {
    const rules = ["Bash(git status:*)", "Bash(git push origin:*)", "Bash(pnpm test:*)", "Edit"];
    expect(closestRules(rules, { tool: "Bash", target: "git push origin feat/x" })).toEqual(["Bash(git push origin:*)", "Bash(git status:*)"]);
  });

  it("allow only on an explicit allow, with no updatedPermissions", async () => {
    const { fetchImpl, calls } = fakeMesa({ status: "decided", decision: "allow" });
    const out = await approve(bash("git push"), { base: "http://m", fetchImpl, timeoutMs: 5000, home, env: { MESA_AGENT: "dev-t1", MESA_TICKET: "t1" } });
    expect(out).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
    expect(calls[0].body).toMatchObject({ agent: "dev-t1", ticketRef: "t1", tool: "Bash" });
  });

  it("read_config denies with the fixed message and the closest rule", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mesa-hook-"));
    mkdirSync(join(cwd, ".claude"));
    writeFileSync(join(cwd, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(git push origin:*)"] } }));
    const { fetchImpl, calls } = fakeMesa({ status: "decided", decision: "read_config" });
    const out = await approve(bash("git push --force", cwd), { base: "http://m", fetchImpl, timeoutMs: 5000, home, env: {} });
    expect(calls[0].body.hints).toEqual(["Bash(git push origin:*)"]);
    expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(out.hookSpecificOutput.decision.message).toContain(READ_CONFIG_MESSAGE);
    expect(out.hookSpecificOutput.decision.message).toContain("Closest allow rule: Bash(git push origin:*)");
  });

  it("deny carries the note; timeout tells the agent to ask in the ticket", async () => {
    const d = await approve(bash("rm -rf x"), { base: "http://m", fetchImpl: fakeMesa({ status: "decided", decision: "deny", note: "no", decidedBy: "andres" }).fetchImpl, timeoutMs: 5000, home, env: {} });
    expect(d.hookSpecificOutput.decision).toMatchObject({ behavior: "deny" });
    expect(d.hookSpecificOutput.decision.message).toContain("Note: no");
    const t = await approve(bash("rm -rf x"), { base: "http://m", fetchImpl: fakeMesa({ status: "expired" }).fetchImpl, timeoutMs: 5000, home, env: {} });
    expect(t.hookSpecificOutput.decision.message).toMatch(/before the timeout\. Do not retry it\. Post a ticket question/);
  });

  it("denies when Mesa is unreachable or the input is bad", async () => {
    const u = await approve(bash("ls"), { base: "http://m", fetchImpl: fakeMesa({}, { failPost: true }).fetchImpl, timeoutMs: 5000, home, env: {} });
    expect(u.hookSpecificOutput.decision.behavior).toBe("deny");
    const b = await approve({}, { base: "http://m", fetchImpl: fakeMesa({}).fetchImpl, home, env: {} });
    expect(b.hookSpecificOutput.decision.behavior).toBe("deny");
  });
});
