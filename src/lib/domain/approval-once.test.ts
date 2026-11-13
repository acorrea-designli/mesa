import { describe, expect, it } from "vitest";
import { grantHash } from "./approval-grant";
import { MAX_SHOWN_CHARS, onceEligible, shownCall, visible } from "./approval-once";

describe("onceEligible", () => {
  it("is Bash, PowerShell and mcp__* only", () => {
    for (const t of ["Bash", "PowerShell", "mcp__engram__mem_save", "mcp__x"]) expect(onceEligible(t)).toBe(true);
    for (const t of ["Edit", "Write", "Read", "Glob", "Agent", "WebFetch", "bash", "mcp_x", ""]) expect(onceEligible(t)).toBe(false);
  });
});

describe("visible: nothing in the shown call can hide", () => {
  it("turns bidi controls, zero-width characters and every other Cc/Cf into \\u{XXXX}, keeping newline and tab", () => {
    const raw = ["\u202A", "\u202B", "\u202C", "\u202D", "\u202E", "\u2066", "\u2067", "\u2068", "\u2069", "\u200B", "\u200C", "\u200D", "\uFEFF", "\u00AD", "\u0000", "\u001B", "\u007F", "\r", "\u2028", "\u2029"];
    for (const ch of raw) {
      const out = visible(`a${ch}b`);
      expect(out).not.toContain(ch);
      expect(out).toMatch(/^a\\u\{[0-9A-F]{4,}\}b$/);
    }
    expect(visible("a\u202Eb")).toBe("a\\u{202E}b");
    expect(visible("a\u200Bb")).toBe("a\\u{200B}b");
    expect(visible("a\nb\tc")).toBe("a\nb\tc");
    expect(visible("plain ascii and ñ, é, 日本語 and Windows C:\\x\\y")).toBe("plain ascii and ñ, é, 日本語 and Windows C:\\x\\y");
  });
});

describe("shownCall", () => {
  it("a one-line command keeps the short summary", () => {
    expect(shownCall("Bash", { command: "git status" })).toEqual({ summary: "Bash: git status", detail: "$ git status" });
  });
  it("padding with newlines cannot push the dangerous line out of sight: the summary carries the line count", () => {
    const command = `git status${"\n".repeat(60)}git push origin HEAD:main`;
    const s = shownCall("Bash", { command });
    expect(s.summary).toBe("Bash (61 líneas): git status …");
    expect(s.detail).toBe(`$ ${command}`); // the whole call, nothing cut
  });
  it("bidi and zero-width characters in a command are shown, in the summary and the detail, and the hash still covers the raw input", () => {
    for (const ch of ["\u202E", "\u200B"]) {
      const command = `echo safe ${ch}; git push origin HEAD:main`;
      const s = shownCall("PowerShell", { command });
      const esc = ch === "\u202E" ? "\\u{202E}" : "\\u{200B}";
      expect(s.detail).toBe(`$ echo safe ${esc}; git push origin HEAD:main`);
      expect(s.summary).toBe(`PowerShell: echo safe ${esc}; git push origin HEAD:main`);
      expect(s.detail).not.toContain(ch);
      expect(grantHash("PowerShell", { command })).not.toBe(grantHash("PowerShell", { command: command.replace(ch, "") })); // raw, not the shown text
    }
  });
  it("an MCP call is shown with its hidden characters made visible too", () => {
    const s = shownCall("mcp__x__y", { b: "a\u202Eb", a: "c\u200Bd" });
    expect(s.detail).toBe('{\n  "a": "c\\u{200B}d",\n  "b": "a\\u{202E}b"\n}');
  });
  it("the sandbox flag is stated, and the limit is generous but finite", () => {
    expect(shownCall("Bash", { command: "ls", dangerouslyDisableSandbox: true }).detail).toBe("$ ls\n[sin sandbox: dangerouslyDisableSandbox]");
    expect(MAX_SHOWN_CHARS).toBeGreaterThan(1000);
  });
});
