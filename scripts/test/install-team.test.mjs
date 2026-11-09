import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALLOW, ENV, hookEntries, install, mergeSettings, SANDBOX_ENV, statusLineEntry } from "../install-team.mjs";

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

test("allow list opens attachments (t41): Slack files and Basecamp uploads", () => {
  for (const t of ["mcp__claude_ai_Slack__slack_read_file", "mcp__basecamp__get_upload", "mcp__basecamp__download_file"]) assert.ok(ALLOW.includes(t), t);
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

test("--env sandbox creates the folder, points every session at :8796 and tags the hooks", () => {
  const target = join(mkdtempSync(join(tmpdir(), "mesa-install-")), "designli-sandbox");
  const plan = [];
  install({ target, node: "C:/node.exe", env: "sandbox", dryRun: true, log: (l) => plan.push(l) });
  assert.equal(existsSync(target), false);
  assert.ok(plan[0].startsWith("mkdir"));
  install({ target, node: "C:/node.exe", env: "sandbox", log: () => {} });
  const s = JSON.parse(readFileSync(join(target, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(s.env, { MESA_URL: "http://127.0.0.1:8796", MESA_ENV: "sandbox", MESA_SESSION: "lead" });
  for (const e of ["PreToolUse", "PermissionRequest", "Stop", "SubagentStop"]) assert.match(s.hooks[e][0].hooks[0].command, / --env sandbox$/);
  assert.ok(lstatSync(join(target, ".claude", "skills", "mesa-start")).isSymbolicLink());
  assert.ok(existsSync(join(target, ".claude", "mesa", "spawn-preamble.md")));
});

test("--env sandbox overrides a live MESA_URL and never installs into the live folder", () => {
  const { settings, added } = mergeSettings({ env: { MESA_URL: "http://127.0.0.1:8790", OTHER: "1" } }, { hooks: {}, env: SANDBOX_ENV, allow: [], forceEnv: true });
  assert.equal(settings.env.MESA_URL, "http://127.0.0.1:8796");
  assert.equal(settings.env.OTHER, "1");
  assert.ok(added.some((a) => a.includes("8790 -> http://127.0.0.1:8796")));
  assert.throws(() => install({ target: "G:/WorkSpace/designli", env: "sandbox", dryRun: true, log: () => {} }), /never installs into the live folder/);
  // Live installs keep their hook commands unchanged.
  assert.doesNotMatch(hookEntries("G:/WorkSpace/designli/ops", "C:/node.exe").Stop[0].hooks[0].command, /--env/);
});

// ---------- statusLine (t45): plan usage in the terminal and in Mesa ----------

test("merge adds the Mesa statusLine when the file has none", () => {
  const sl = statusLineEntry("G:/WorkSpace/designli/ops", "C:/node.exe");
  assert.deepEqual(sl, { type: "command", command: '"C:/node.exe" "G:/WorkSpace/designli/ops/scripts/statusline.mjs" --url http://127.0.0.1:8790' });
  const { settings, added } = mergeSettings({ theme: "dark" }, { hooks: {}, env: ENV, allow: [], statusLine: sl });
  assert.deepEqual(settings.statusLine, sl);
  assert.ok(added.includes("statusLine: scripts/statusline.mjs"));
  assert.equal(settings.theme, "dark");
  assert.deepEqual(mergeSettings(settings, { hooks: {}, env: ENV, allow: [], statusLine: sl }).added, []);
});

test("merge never overwrites a statusLine that is already there", () => {
  const mine = { type: "command", command: "node my-statusline.js", padding: 2 };
  const sl = statusLineEntry("G:/WorkSpace/designli/ops", "C:/node.exe");
  for (const current of [{ statusLine: mine }, { statusLine: { type: "command", command: "node scripts/statusline.mjs --url http://elsewhere" } }, { statusLine: null }]) {
    const { settings, added } = mergeSettings(current, { hooks: {}, env: ENV, allow: [], statusLine: sl, forceEnv: true });
    assert.deepEqual(settings.statusLine, current.statusLine);
    assert.ok(!added.some((a) => a.startsWith("statusLine")));
  }
});

test("merge without a statusLine option touches no statusLine", () => {
  assert.equal("statusLine" in mergeSettings({}, { hooks: {}, env: ENV, allow: [] }).settings, false);
});

test("install writes the live statusLine, keeps an existing one, and is idempotent", () => {
  const live = mkdtempSync(join(tmpdir(), "mesa-install-"));
  mkdirSync(join(live, ".claude"));
  writeFileSync(join(live, ".claude", "settings.json"), "{}");
  install({ target: live, node: "C:/node.exe", log: () => {} });
  const s = JSON.parse(readFileSync(join(live, ".claude", "settings.json"), "utf8"));
  assert.equal(s.statusLine.type, "command");
  assert.match(s.statusLine.command, /scripts\/statusline\.mjs" --url http:\/\/127\.0\.0\.1:8790$/);
  const again = [];
  install({ target: live, node: "C:/node.exe", log: (l) => again.push(l) });
  assert.ok(again.every((l) => l.startsWith("ok")), again.join("\n"));

  const mine = mkdtempSync(join(tmpdir(), "mesa-install-"));
  mkdirSync(join(mine, ".claude"));
  writeFileSync(join(mine, ".claude", "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "echo hi" } }));
  const log = [];
  install({ target: mine, node: "C:/node.exe", log: (l) => log.push(l) });
  assert.deepEqual(JSON.parse(readFileSync(join(mine, ".claude", "settings.json"), "utf8")).statusLine, { type: "command", command: "echo hi" });
  assert.ok(!log.some((l) => l.includes("statusLine")));
});

test("--env sandbox points the statusLine at the sandbox board, not live", () => {
  const target = join(mkdtempSync(join(tmpdir(), "mesa-install-")), "designli-sandbox");
  install({ target, node: "C:/node.exe", env: "sandbox", log: () => {} });
  const s = JSON.parse(readFileSync(join(target, ".claude", "settings.json"), "utf8"));
  assert.match(s.statusLine.command, /scripts\/statusline\.mjs" --url http:\/\/127\.0\.0\.1:8796$/);
  assert.doesNotMatch(s.statusLine.command, /8790/);
});

test("--dry-run plans the statusLine and writes nothing", () => {
  const target = mkdtempSync(join(tmpdir(), "mesa-install-"));
  mkdirSync(join(target, ".claude"));
  writeFileSync(join(target, ".claude", "settings.json"), "{}");
  const log = [];
  install({ target, node: "C:/node.exe", dryRun: true, log: (l) => log.push(l) });
  assert.ok(log.some((l) => l === "merge   statusLine: scripts/statusline.mjs"));
  assert.equal(readFileSync(join(target, ".claude", "settings.json"), "utf8"), "{}");
});
