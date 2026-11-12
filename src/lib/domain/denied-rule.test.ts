import { describe, expect, it } from "vitest";
import { deniedRule, isDerivedRule } from "./denied-rule";

const ROOT = "G:/WorkSpace/designli-wt";
const edit = (file_path: string, tool = "Edit") => deniedRule(tool, { file_path }, ROOT);

describe("deniedRule", () => {
  it("proposes the edit rule for the directory of the file, in the Windows absolute form", () => {
    expect(edit("G:/WorkSpace/designli-wt/dev-t128-2/scripts/hooks/calendar-body.mjs")).toEqual({
      ok: true,
      rule: "Edit(//g/WorkSpace/designli-wt/dev-t128-2/scripts/hooks/**)",
      dir: "g/WorkSpace/designli-wt/dev-t128-2/scripts/hooks",
    });
  });
  it("reads backslash and Git Bash spellings of the same path, in any letter case for the drive and the folders", () => {
    const want = "Edit(//g/WorkSpace/designli-wt/dev-t128/src/lib/**)";
    for (const p of [
      "G:\\WorkSpace\\designli-wt\\dev-t128\\src\\lib\\x.ts",
      "g:/WorkSpace/designli-wt/dev-t128/src/lib/x.ts",
      "/g/WorkSpace/designli-wt/dev-t128/src/lib/x.ts",
      "G:/workspace/DESIGNLI-WT/dev-t128/src/lib/x.ts",
      "G:/WorkSpace/designli-wt/dev-t128/src/./lib/x.ts",
    ])
      expect(edit(p), p).toMatchObject({ ok: true, rule: want });
  });
  it.each(["Write", "MultiEdit"])("covers %s through the same Edit rule", (tool) => {
    expect(edit("G:/WorkSpace/designli-wt/dev-t1/src/a.ts", tool)).toMatchObject({ ok: true, rule: "Edit(//g/WorkSpace/designli-wt/dev-t1/src/**)" });
  });
  it("reads notebook_path for NotebookEdit", () => {
    expect(deniedRule("NotebookEdit", { notebook_path: "G:/WorkSpace/designli-wt/dev-t1/nb/a.ipynb" }, ROOT)).toMatchObject({ ok: true, rule: "Edit(//g/WorkSpace/designli-wt/dev-t1/nb/**)" });
    expect(deniedRule("NotebookEdit", { file_path: "G:/WorkSpace/designli-wt/dev-t1/nb/a.ipynb" }, ROOT).ok).toBe(false);
  });

  it.each([
    ["a path outside the worktrees folder", "G:/WorkSpace/designli/ops/src/a.ts"],
    ["the real ops checkout", "G:/WorkSpace/designli/scripts/hooks/x.mjs"],
    ["another drive", "C:/WorkSpace/designli-wt/dev-t1/src/a.ts"],
    ["a sibling folder with the same prefix", "G:/WorkSpace/designli-wt-old/dev-t1/src/a.ts"],
    ["the worktrees folder itself", "G:/WorkSpace/designli-wt/a.ts"],
    ["a file in a worktree root", "G:/WorkSpace/designli-wt/dev-t1/package.json"],
    ["a relative path", "src/a.ts"],
    ["a UNC path", "//server/share/dev-t1/src/a.ts"],
    ["a .. segment", "G:/WorkSpace/designli-wt/dev-t1/src/../../../designli/x.ts"],
    ["a .claude folder", "G:/WorkSpace/designli-wt/dev-t1/.claude/skills/a.md"],
    ["a nested .claude folder", "G:/WorkSpace/designli-wt/dev-t1/docs/.CLAUDE/a.md"],
    ["a .git folder", "G:/WorkSpace/designli-wt/dev-t1/.git/hooks/pre-commit"],
    ["a .vscode folder", "G:/WorkSpace/designli-wt/dev-t1/.vscode/tasks.json"],
    ["a .idea folder", "G:/WorkSpace/designli-wt/dev-t1/.idea/workspace.xml"],
    ["a .husky folder", "G:/WorkSpace/designli-wt/dev-t1/.husky/pre-commit"],
    ["a .cargo folder", "G:/WorkSpace/designli-wt/dev-t1/.cargo/config.toml"],
    ["a .devcontainer folder", "G:/WorkSpace/designli-wt/dev-t1/.devcontainer/devcontainer.json"],
    ["a .yarn folder", "G:/WorkSpace/designli-wt/dev-t1/.yarn/releases/yarn.cjs"],
    ["a .mvn folder", "G:/WorkSpace/designli-wt/dev-t1/.mvn/wrapper/a.properties"],
    ["a .config/git folder", "G:/WorkSpace/designli-wt/dev-t1/.config/git/config"],
    ["a protected folder in another letter case", "G:/WorkSpace/designli-wt/dev-t1/src/.VSCode/a.json"],
    ["settings.json", "G:/WorkSpace/designli-wt/dev-t1/app/settings.json"],
    ["settings.local.json", "G:/WorkSpace/designli-wt/dev-t1/app/Settings.local.json"],
    ["a glob character", "G:/WorkSpace/designli-wt/dev-t1/src/*/a.ts"],
    ["a bracket (Next route folder)", "G:/WorkSpace/designli-wt/dev-t1/src/app/[id]/route.ts"],
    ["a parenthesis", "G:/WorkSpace/designli-wt/dev-t1/src/(group)/a.ts"],
    ["a space", "G:/WorkSpace/designli-wt/dev-t1/my docs/a.md"],
  ])("proposes no rule for %s", (_why, file) => {
    const r = edit(file);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why.length).toBeGreaterThan(10);
  });

  it.each([
    ["Bash", { command: "rm -rf G:/WorkSpace/designli-wt/x" }],
    ["PowerShell", { command: "Remove-Item G:/WorkSpace/designli-wt/x" }],
    ["mcp__claude_ai_Slack__slack_send_message", { text: "hola" }],
    ["Read", { file_path: "G:/WorkSpace/designli-wt/dev-t1/src/a.ts" }],
  ])("proposes no rule for %s", (tool, input) => expect(deniedRule(tool, input, ROOT).ok).toBe(false));

  it("proposes no rule without a path or a usable input", () => {
    for (const input of [null, undefined, "x", [], {}, { file_path: 3 }, { file_path: "  " }]) expect(deniedRule("Edit", input, ROOT).ok, JSON.stringify(input)).toBe(false);
  });

  it("never produces *, **, a drive root or a worktree root", () => {
    for (const p of ["G:/*", "G:/**", "G:/", "G:/WorkSpace/designli-wt/dev-t1/", "G:/WorkSpace/designli-wt/**/a.ts", "G:/WorkSpace/designli-wt/dev-t1/a.ts"]) expect(edit(p).ok, p).toBe(false);
  });

  it("follows a configured root", () => {
    expect(deniedRule("Edit", { file_path: "D:/wt/dev-t9/src/a.ts" }, "D:/wt")).toMatchObject({ ok: true, rule: "Edit(//d/wt/dev-t9/src/**)" });
  });
});

describe("isDerivedRule", () => {
  it("accepts what deniedRule produces", () => {
    const r = edit("G:/WorkSpace/designli-wt/dev-t128-2/scripts/hooks/calendar-body.mjs");
    expect(r.ok && isDerivedRule(r.rule, ROOT)).toBe(true);
  });
  it.each([
    "Edit(**)",
    "Edit(//g/**)",
    "Edit(//g/WorkSpace/designli-wt/**)",
    "Edit(//g/WorkSpace/designli-wt/dev-t1/**)",
    "Edit(//g/WorkSpace/designli-wt/**/scripts/hooks/**/mesa-denied*)",
    "Edit(//g/WorkSpace/designli-wt/dev-t1/.claude/**)",
    "Edit(//g/WorkSpace/designli-wt/dev-t1/src/.vscode/**)",
    "Edit(//g/WorkSpace/designli-wt/dev-t1/.config/git/**)",
    "Edit(//g/WorkSpace/designli-wt/dev-t1/src/../**)",
    "Edit(//g/WorkSpace/designli/ops/src/**)",
    "Bash(rm *)",
    "Edit(//g/WorkSpace/designli-wt/dev-t1/src/**",
    "",
  ])("refuses %s", (rule) => expect(isDerivedRule(rule, ROOT)).toBe(false));
});
