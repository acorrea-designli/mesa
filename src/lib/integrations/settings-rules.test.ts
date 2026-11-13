import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addAllowRule, DEFAULT_SETTINGS_LOCAL, SettingsRuleError, settingsLocalPath } from "./settings-rules";

const ROOT = "G:/WorkSpace/designli-wt";
const RULE = "Edit(//g/WorkSpace/designli-wt/dev-t128-2/scripts/hooks/**)";
let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-settings-"));
  file = path.join(dir, ".claude", "settings.local.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const read = () => JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
const write = (s: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, s);
};

describe("addAllowRule", () => {
  it("keeps everything else in the file and appends the rule to permissions.allow", () => {
    write(JSON.stringify({ env: { A: "1" }, permissions: { allow: ["Bash(node x)"], ask: ["Bash(git push *)"], deny: ["Read(.env)"] }, hooks: { Stop: [] } }, null, 2));
    expect(addAllowRule(file, RULE, ROOT)).toBe(true);
    expect(read()).toEqual({ env: { A: "1" }, permissions: { allow: ["Bash(node x)", RULE], ask: ["Bash(git push *)"], deny: ["Read(.env)"] }, hooks: { Stop: [] } });
  });
  it("is idempotent: the second call changes nothing", () => {
    write("{}");
    expect(addAllowRule(file, RULE, ROOT)).toBe(true);
    const once = fs.readFileSync(file, "utf8");
    expect(addAllowRule(file, RULE, ROOT)).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(once);
    expect((read().permissions as { allow: string[] }).allow).toEqual([RULE]);
  });
  it("creates the file (and its folder) when it does not exist, and fills a missing permissions or allow", () => {
    expect(addAllowRule(file, RULE, ROOT)).toBe(true);
    expect(read()).toEqual({ permissions: { allow: [RULE] } });
    write(JSON.stringify({ permissions: { ask: [] } }));
    addAllowRule(file, RULE, ROOT);
    expect(read()).toEqual({ permissions: { ask: [], allow: [RULE] } });
  });
  it("keeps the indentation and the line ending of the file, and leaves no temp file", () => {
    write('{\r\n    "permissions": {\r\n        "allow": []\r\n    }\r\n}\r\n');
    addAllowRule(file, RULE, ROOT);
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain('\r\n    "permissions": {');
    expect(text.endsWith("}\r\n")).toBe(true);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["settings.local.json"]);
  });
  it("accepts a file with a BOM", () => {
    write(`\uFEFF${JSON.stringify({ permissions: { allow: ["a"] } })}`);
    addAllowRule(file, RULE, ROOT);
    expect(read()).toEqual({ permissions: { allow: ["a", RULE] } });
  });
  it.each([
    ["not JSON", "{ nope"],
    ["an array", "[]"],
    ["permissions as a string", JSON.stringify({ permissions: "x" })],
    ["allow as a string", JSON.stringify({ permissions: { allow: "x" } })],
  ])("never overwrites a file that is %s", (_n, text) => {
    write(text);
    expect(() => addAllowRule(file, RULE, ROOT)).toThrow(SettingsRuleError);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });
  it.each(["Edit(**)", "Edit(//g/**)", "Edit(//g/WorkSpace/designli-wt/dev-t1/**)", "Bash(*)", "Edit(//g/WorkSpace/designli/ops/src/**)", ""])("refuses to write %s", (rule) => {
    expect(() => addAllowRule(file, rule, ROOT)).toThrow(SettingsRuleError);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("settingsLocalPath", () => {
  it("comes from MESA_SETTINGS_LOCAL, else the sessions folder's file", () => {
    expect(settingsLocalPath({ MESA_SETTINGS_LOCAL: "X:/a/settings.local.json" })).toBe("X:/a/settings.local.json");
    expect(settingsLocalPath({})).toBe(DEFAULT_SETTINGS_LOCAL);
    expect(settingsLocalPath({ MESA_SESSIONS_DIR: "D:/work/ana" })).toBe("D:/work/ana/.claude/settings.local.json");
  });
  it("is refused on the sandbox board unless a path is given", () => {
    expect(() => settingsLocalPath({ MESA_ENV: "sandbox" })).toThrow(/sandbox/);
    expect(settingsLocalPath({ MESA_ENV: "sandbox", MESA_SETTINGS_LOCAL: "X:/s.json" })).toBe("X:/s.json");
  });
});
