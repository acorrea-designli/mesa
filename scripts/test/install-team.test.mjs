import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALLOW, ENV, hookEntries, install, mergeSettings } from "../install-team.mjs";

const hooks = hookEntries("G:/WorkSpace/designli/ops", "C:/node.exe");

test("merge keeps existing keys and adds every Mesa hook once", () => {
  const current = {
    model: "opus",
    env: { MESA_SESSION: "custom" },
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node other.mjs" }] }] },
    permissions: { allow: ["Bash(ls)"], deny: ["Bash(rm *)"] },
  };
  const { settings, added } = mergeSettings(current, { hooks, env: ENV, allow: ALLOW });
  assert.equal(settings.model, "opus");
  assert.equal(settings.env.MESA_SESSION, "custom");
  assert.equal(settings.env.MESA_URL, "http://127.0.0.1:8790");
  assert.equal(settings.hooks.PreToolUse.length, 2);
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, "node other.mjs");
  assert.deepEqual(settings.permissions.deny, ["Bash(rm *)"]);
  assert.ok(settings.permissions.allow.includes("Bash(ls)"));
  for (const e of ["PermissionRequest", "Stop", "SubagentStop"]) assert.equal(settings.hooks[e].length, 1);
  assert.equal(settings.hooks.PermissionRequest[0].hooks[0].timeout, 600);
  assert.ok(added.length > 5);
  const again = mergeSettings(settings, { hooks, env: ENV, allow: ALLOW });
  assert.deepEqual(again.added, []);
  assert.deepEqual(again.settings, settings);
});

test("merge without --allow touches no permissions", () => {
  const { settings } = mergeSettings({}, { hooks, env: ENV, allow: [] });
  assert.equal(settings.permissions, undefined);
});

test("install links skills, agents and the preamble and writes a backup", () => {
  const target = mkdtempSync(join(tmpdir(), "mesa-install-"));
  mkdirSync(join(target, ".claude"));
  writeFileSync(join(target, ".claude", "settings.json"), JSON.stringify({ theme: "dark" }));
  const log = [];
  install({ target, node: "C:/node.exe", log: (l) => log.push(l) });
  const skills = readdirSync(join(target, ".claude", "skills"));
  assert.ok(skills.includes("mesa-start") && skills.includes("mesa-review"));
  assert.ok(lstatSync(join(target, ".claude", "skills", "mesa-start")).isSymbolicLink());
  assert.ok(existsSync(join(target, ".claude", "agents", "reviewer.md")));
  assert.ok(existsSync(join(target, ".claude", "mesa", "spawn-preamble.md")));
  const s = JSON.parse(readFileSync(join(target, ".claude", "settings.json"), "utf8"));
  assert.equal(s.theme, "dark");
  assert.match(s.hooks.Stop[0].hooks[0].command, /mesa-handoff-guard\.mjs/);
  assert.ok(readdirSync(join(target, ".claude")).some((f) => f.startsWith("settings.json.bak-")));
  const second = [];
  install({ target, node: "C:/node.exe", log: (l) => second.push(l) });
  assert.ok(second.every((l) => l.startsWith("ok")), second.join("\n"));
});

test("install leaves a real agents folder's differing files alone", () => {
  const target = mkdtempSync(join(tmpdir(), "mesa-install-"));
  mkdirSync(join(target, ".claude", "agents"), { recursive: true });
  writeFileSync(join(target, ".claude", "agents", "tl.md"), "mine");
  writeFileSync(join(target, ".claude", "agents", "other.md"), "keep");
  const log = [];
  install({ target, node: "C:/node.exe", log: (l) => log.push(l) });
  assert.equal(readFileSync(join(target, ".claude", "agents", "tl.md"), "utf8"), "mine");
  assert.equal(readFileSync(join(target, ".claude", "agents", "other.md"), "utf8"), "keep");
  assert.ok(existsSync(join(target, ".claude", "agents", "writer.md")));
  assert.ok(log.some((l) => /SKIP .*tl\.md differs/.test(l)));
});

test("dry run writes nothing", () => {
  const target = mkdtempSync(join(tmpdir(), "mesa-install-"));
  install({ target, node: "C:/node.exe", dryRun: true, log: () => {} });
  assert.equal(existsSync(join(target, ".claude")), false);
});
