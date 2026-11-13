import { describe, expect, it } from "vitest";
import { canonicalJson, grantable, grantHash, identityOf } from "./approval-grant";

describe("grantHash", () => {
  const cmd = { command: "git push --dry-run origin x", description: "Dry run the push", timeout: 120000 };
  it("ignores description, timeout and run_in_background on a shell call (the retry rewords the description)", () => {
    const h = grantHash("Bash", cmd);
    expect(grantHash("Bash", { ...cmd, description: "Retry the dry-run push" })).toBe(h);
    expect(grantHash("Bash", { command: cmd.command })).toBe(h);
    expect(grantHash("Bash", { ...cmd, timeout: 5, run_in_background: true })).toBe(h);
    expect(grantHash("PowerShell", cmd)).not.toBe(h); // the tool is part of the identity
  });
  it("changes with the command, character by character, and with dangerouslyDisableSandbox (absent = false)", () => {
    const h = grantHash("Bash", cmd);
    expect(grantHash("Bash", { ...cmd, command: "git push --dry-run origin y" })).not.toBe(h);
    expect(grantHash("Bash", { ...cmd, command: `${cmd.command} ` })).not.toBe(h);
    expect(grantHash("Bash", { ...cmd, dangerouslyDisableSandbox: true })).not.toBe(h);
    expect(grantHash("Bash", { ...cmd, dangerouslyDisableSandbox: false })).toBe(h);
  });
  it("covers the whole canonical input of any other tool, keys sorted", () => {
    const a = { b: 1, a: { y: [1, 2], x: "z" } };
    expect(grantHash("mcp__engram__mem_save", a)).toBe(grantHash("mcp__engram__mem_save", { a: { x: "z", y: [1, 2] }, b: 1 }));
    expect(grantHash("mcp__engram__mem_save", a)).not.toBe(grantHash("mcp__engram__mem_save", { ...a, b: 2 }));
    expect(grantHash("mcp__engram__mem_save", a)).not.toBe(grantHash("mcp__engram__mem_search", a));
    // a description is only ignored for a shell call
    expect(grantHash("mcp__x__y", { q: 1, description: "a" })).not.toBe(grantHash("mcp__x__y", { q: 1, description: "b" }));
    expect(grantHash("Write", { file_path: "a", content: "1" })).not.toBe(grantHash("Write", { file_path: "a", content: "2" }));
  });
  it("is a sha-256 hex string and canonicalJson sorts recursively and drops undefined", () => {
    expect(grantHash("Bash", cmd)).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalJson({ b: [{ d: 1, c: undefined }], a: null })).toBe('{"a":null,"b":[{"d":1}]}');
    expect(identityOf("Bash", { command: "x" })).toEqual({ command: "x", dangerouslyDisableSandbox: false });
  });
});

describe("grantable", () => {
  it("needs a tool, an input, and a command for a shell call", () => {
    expect(grantable("Bash", { command: "ls" }).ok).toBe(true);
    expect(grantable("mcp__x__y", { a: 1 }).ok).toBe(true);
    for (const [t, i] of [["", { a: 1 }], ["Bash", {}], ["Bash", { command: "  " }], ["mcp__x__y", null], ["mcp__x__y", []]] as const) expect(grantable(t, i).ok).toBe(false);
  });
});
