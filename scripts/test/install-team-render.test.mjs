// t143: install-team for the original owner's layout is today's output plus a listed set of additions; for anyone else it
// renders copies with that person's paths and identity and leaves no trace of the original owner's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOW, ENV, UsageError, allowRules, commitGuardEntry, hookEntries, identityEnv, install, mergeSettings, resolveConfig } from "../install-team.mjs";
import { CANONICAL, fwd, leftovers, maskPath, renderText } from "../lib/render-team.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CANON_REPO = "G:/WorkSpace/designli/ops";
const NODE = "C:/node.exe";
const tmp = () => mkdtempSync(join(tmpdir(), "mesa-render-"));

// What origin/main's installer wrote before t143 (copied verbatim; the canonical output must still contain all of it).
const TODAY_ALLOW = [
  "Bash(node G:/WorkSpace/designli/ops/bin/mesa *)",
  "PowerShell(node G:/WorkSpace/designli/ops/bin/mesa *)",
  "Bash(node G:/WorkSpace/designli/ops/.claude/skills/mesa-write/assets/render.mjs *)",
  "Bash(node G:/WorkSpace/designli/ops/scripts/sweep-tick.mjs *)",
  "Bash(gh api user -q .login)",
  "Bash(gh api repos/*)",
  "Bash(gh search prs *)",
  "Bash(gh run view *)",
  "Bash(git -C * status*)",
  "Bash(git -C * log *)",
  "Bash(git -C * diff *)",
  "Bash(git -C * show *)",
  "Bash(git -C * fetch origin)",
  "Bash(curl -s -m 3 http://127.0.0.1:8790/api/health)",
  "Bash(curl -s -m 3 http://127.0.0.1:8796/api/health)",
  "mcp__engram__mem_context",
  "mcp__engram__mem_search",
  "mcp__engram__mem_get_observation",
  "mcp__engram__mem_save",
  "mcp__engram__mem_current_project",
  "mcp__basecamp__get_by_url",
  "mcp__basecamp__search",
  "mcp__basecamp__get_comment",
  "mcp__basecamp__list_comments",
  "mcp__basecamp__get_message",
  "mcp__basecamp__get_todo",
  "mcp__basecamp__get_card",
  "mcp__basecamp__get_document",
  "mcp__basecamp__get_upload",
  "mcp__basecamp__download_file",
  "mcp__basecamp__list_campfire_lines",
  "mcp__basecamp__get_my_assignments",
  "mcp__basecamp__get_my_notifications",
  "mcp__claude_ai_Slack__slack_read_thread",
  "mcp__claude_ai_Slack__slack_read_channel",
  "mcp__claude_ai_Slack__slack_read_file",
  "mcp__claude_ai_Slack__slack_search_public_and_private",
  "mcp__claude_ai_Slack__slack_read_user_profile",
];
const NEW_ALLOW = ["Bash(node G:/WorkSpace/designli/ops/vendor/pr-gh.mjs *)", "PowerShell(node G:/WorkSpace/designli/ops/vendor/pr-gh.mjs *)"];
const NEW_ENV = ["env.MESA_GH_USER", "env.MESA_GIT_NAME", "env.MESA_GIT_EMAIL", "env.MESA_SLACK_USER_ID"];

const ana = (extra = {}) => ({ "--gh-user": "ana-dev", "--git-name": "Ana Dev", "--git-email": "ana@example.com", "--slack-id": "U0ANA1234", "--owner-name": "Ana", ...extra });
const flags = (o) => Object.entries(o).flat();

// ---------- criterion 4: the canonical output is today's plus only the listed additions ----------

test("ALLOW for the original owner's repo is today's list plus exactly the vendored pr-gh rule", () => {
  assert.deepEqual(ALLOW, [...TODAY_ALLOW, ...NEW_ALLOW]);
  assert.deepEqual(allowRules(CANON_REPO), ALLOW);
  assert.deepEqual(allowRules("G:\\WorkSpace\\designli\\ops\\"), ALLOW);
});

test("the hook commands for the original owner's repo are today's strings", () => {
  const h = hookEntries(CANON_REPO, "C:/Program Files/node.exe");
  const cmd = (rel) => `"C:/Program Files/node.exe" "G:/WorkSpace/designli/ops/${rel}"`;
  assert.equal(h.PreToolUse[0].hooks[0].command, cmd("scripts/hooks/mesa-guardrails.mjs"));
  assert.equal(h.PermissionRequest[0].hooks[0].command, cmd("scripts/hooks/mesa-approval.mjs"));
  assert.equal(h.PermissionDenied[0].hooks[0].command, cmd("scripts/hooks/mesa-denied.mjs"));
  assert.equal(h.Stop[0].hooks[0].command, cmd("scripts/hooks/mesa-handoff-guard.mjs"));
  assert.equal(h.SubagentStop[0].hooks[0].command, cmd("scripts/hooks/mesa-handoff-guard.mjs"));
  assert.deepEqual(Object.keys(h), ["PreToolUse", "PermissionRequest", "PermissionDenied", "Stop", "SubagentStop"]);
  assert.equal(h.PreToolUse.length, 1); // no commit guard unless asked
});

test("a link-mode install writes today's settings entries plus only the identity env (and the pr-gh rule with --allow)", () => {
  const before = tmp();
  const after = tmp();
  const log0 = [];
  const log1 = [];
  const a = install({ target: before, node: NODE, allow: true, log: (l) => log0.push(l) });
  const b = install({ target: after, node: NODE, allow: true, identity: CANONICAL, log: (l) => log1.push(l) });
  const extra = b.added.filter((x) => !a.added.includes(x));
  assert.deepEqual(extra, NEW_ENV);
  assert.deepEqual(a.added.filter((x) => !b.added.includes(x)), []);
  // today's `--allow` run added every rule of the old list; the new run adds the pr-gh one on top.
  assert.ok(TODAY_ALLOW.every((r) => a.added.includes(`permissions.allow: ${r}`) && b.added.includes(`permissions.allow: ${r}`)));
  const s = JSON.parse(readFileSync(join(after, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(s.permissions.allow, [...TODAY_ALLOW, ...NEW_ALLOW]);
  assert.deepEqual({ ...s.env }, { ...ENV, MESA_GH_USER: "acorrea-designli", MESA_GIT_NAME: "acorrea-designli", MESA_GIT_EMAIL: "andres.correa@designli.co", MESA_SLACK_USER_ID: "U06E2UBDC73" });
  assert.deepEqual(identityEnv(CANONICAL), { MESA_GH_USER: "acorrea-designli", MESA_GIT_NAME: "acorrea-designli", MESA_GIT_EMAIL: "andres.correa@designli.co", MESA_SLACK_USER_ID: "U06E2UBDC73" });
  // the canonical identity carries no owner or project env: the readers default to those values, so his settings.json is as it was
  assert.ok(!JSON.stringify(s.env).includes("MESA_OWNER") && !JSON.stringify(s.env).includes("MESA_PROJECT"));
  // links and hard links exactly as before
  assert.ok(lstatSync(join(after, ".claude", "skills", "mesa-start")).isSymbolicLink());
  assert.ok(lstatSync(join(after, ".claude", "mesa")).isSymbolicLink());
  assert.ok(log1.filter((l) => !l.startsWith("merge")).every((l, i) => l === log0.filter((x) => !x.startsWith("merge"))[i].replace(fwd(before), fwd(after))));
});

test("identity env never overwrites a value the file already has, and a second run adds nothing", () => {
  const target = tmp();
  mkdirSync(join(target, ".claude"));
  writeFileSync(join(target, ".claude", "settings.json"), JSON.stringify({ env: { MESA_GH_USER: "someone-else" } }));
  install({ target, node: NODE, identity: CANONICAL, log: () => {} });
  const s = JSON.parse(readFileSync(join(target, ".claude", "settings.json"), "utf8"));
  assert.equal(s.env.MESA_GH_USER, "someone-else");
  assert.equal(s.env.MESA_SLACK_USER_ID, "U06E2UBDC73");
  const again = [];
  install({ target, node: NODE, identity: CANONICAL, log: (l) => again.push(l) });
  assert.ok(again.every((l) => l.startsWith("ok")), again.join("\n"));
});

// ---------- --commit-guard ----------

test("--commit-guard registers vendor/commit-guard.mjs as a PreToolUse hook, once, and never by default", () => {
  const plain = tmp();
  install({ target: plain, node: NODE, log: () => {} });
  assert.ok(!JSON.stringify(JSON.parse(readFileSync(join(plain, ".claude", "settings.json"), "utf8")).hooks).includes("commit-guard"));

  const target = tmp();
  const { added } = install({ target, node: NODE, commitGuard: true, log: () => {} });
  assert.ok(added.includes("hooks.PreToolUse: vendor/commit-guard.mjs"));
  const s = JSON.parse(readFileSync(join(target, ".claude", "settings.json"), "utf8"));
  const guard = s.hooks.PreToolUse.find((e) => e.hooks[0].command.includes("commit-guard"));
  assert.equal(guard.matcher, "Bash|PowerShell");
  assert.deepEqual(guard, commitGuardEntry(REPO, NODE));
  assert.equal(s.hooks.PreToolUse.length, 2);
  const again = [];
  install({ target, node: NODE, commitGuard: true, log: (l) => again.push(l) });
  assert.ok(again.every((l) => l.startsWith("ok")), again.join("\n"));
  // The rails hook entry is untouched by it.
  assert.equal(mergeSettings(s, { hooks: hookEntries(REPO, NODE), env: ENV, allow: [] }).added.length, 0);
});

// ---------- which mode ----------

test("the original owner's values keep the link mode, with or without his identity spelled out", () => {
  for (const env of [{}, { MESA_GH_USER: "acorrea-designli", MESA_GIT_NAME: "acorrea-designli", MESA_GIT_EMAIL: "andres.correa@designli.co", MESA_SLACK_USER_ID: "U06E2UBDC73", MESA_OWNER_NAME: "Andrés" }]) {
    const c = resolveConfig(["--repo", CANON_REPO], env);
    assert.equal(c.mode, "link");
    assert.equal(c.render, null);
    assert.deepEqual(c.identity, { ghUser: "acorrea-designli", gitName: "acorrea-designli", gitEmail: "andres.correa@designli.co", slackUserId: "U06E2UBDC73", ownerName: "Andrés", ownerFullName: "Andrés Correa", project: "designli" });
    assert.equal(c.target, "G:/WorkSpace/designli");
  }
});

test("the sandbox install from a worktree of his checkout stays a link install", () => {
  const c = resolveConfig(["--env", "sandbox", "--target", "G:/WorkSpace/designli-sandbox", "--repo", REPO], {});
  assert.equal(c.mode, "link");
});

test("a different layout without the whole identity is refused, naming what is missing", () => {
  assert.throws(() => resolveConfig(["--target", "D:/work"], {}), (e) => e instanceof UsageError && /--gh-user/.test(e.message) && /--git-email/.test(e.message) && /--slack-id/.test(e.message) && /--git-name/.test(e.message));
  assert.throws(() => resolveConfig(["--target", "D:/work", "--gh-user", "ana-dev"], {}), (e) => e instanceof UsageError && !/--gh-user/.test(e.message) && /--git-name/.test(e.message));
  // the environment counts like the flags
  const c = resolveConfig(["--target", "D:/work"], { MESA_GH_USER: "ana-dev", MESA_GIT_NAME: "Ana Dev", MESA_GIT_EMAIL: "ana@example.com", MESA_SLACK_USER_ID: "U0ANA1234", MESA_OWNER_NAME: "Ana" });
  assert.equal(c.mode, "render");
});

test("another identity on his own paths still renders, and needs all four values", () => {
  assert.throws(() => resolveConfig(["--repo", CANON_REPO, "--gh-user", "ana-dev"], {}), (e) => e instanceof UsageError && /--git-name/.test(e.message));
  const c = resolveConfig(["--repo", CANON_REPO, ...flags(ana())], {});
  assert.equal(c.mode, "render");
  assert.equal(c.render.sessions, "G:/WorkSpace/designli");
  assert.equal(c.render.worktrees, "G:/WorkSpace/designli-wt");
});

test("flags and values are validated, and the worktrees root defaults next to the sessions folder", () => {
  assert.throws(() => resolveConfig(["--target", "D:/work", ...flags(ana({ "--git-name": 'Ana "x"' }))], {}), /--git-name/);
  assert.throws(() => resolveConfig(["--target", "D:/work", ...flags(ana({ "--slack-id": "ana" }))], {}), /--slack-id/);
  assert.throws(() => resolveConfig(["--target"], {}), /needs a value/);
  const c = resolveConfig(["--target", "D:\\work\\ana", ...flags(ana())], {});
  assert.equal(c.render.sessions, "D:/work/ana");
  assert.equal(c.render.worktrees, "D:/work/ana-wt");
  assert.equal(resolveConfig(["--target", "D:/work", "--worktrees", "E:/wt", ...flags(ana())], {}).render.worktrees, "E:/wt");
  assert.equal(resolveConfig(["--target", "D:/work", ...flags(ana())], { MESA_WORKTREES_ROOT: "F:/wt" }).render.worktrees, "F:/wt");
  assert.throws(() => resolveConfig(["--env", "sandbox", "--target", "D:/sbx", ...flags(ana())], {}), /--sessions/);
});

// ---------- rendering ----------

test("renderText replaces every spelling of his paths, his identity, and nothing twice", () => {
  const cfg = { repo: "D:/mesa", sessions: "D:/work/ana", worktrees: "D:/work/ana-wt", ghUser: "ana-dev", gitName: "Ana Dev", gitEmail: "ana@example.com", slackUserId: "U0ANA1234", ownerName: "Ana", ownerFullName: "Ana Dev Lopez", project: "ana-work" };
  const text = [
    "node G:/WorkSpace/designli/ops/bin/mesa wait",
    "pwd is /g/WorkSpace/designli (or G:\\WorkSpace\\designli); sandbox /g/WorkSpace/designli-sandbox",
    "git -C G:/WorkSpace/designli-wt/dev-<ticket> -c user.name=\"acorrea-designli\" -c user.email=\"andres.correa@designli.co\" commit",
    "Edit(//g/WorkSpace/designli-wt/<worktree>/**) select(.user.login==\"acorrea-designli\") <@U06E2UBDC73>",
    "Andrés's calendar; \"postAs\":\"Andrés Correa\"; basecamp query \"Andres\"; nothing is sent without Andrés's approval.",
    "MESA session --label lead --project designli; project: \"designli-sandbox\"; session/designli-sandbox-lead",
  ].join("\n");
  const out = renderText(text, cfg);
  assert.equal(
    out,
    [
      "node D:/mesa/bin/mesa wait",
      "pwd is /d/work/ana (or D:\\work\\ana); sandbox /d/work/ana-sandbox",
      "git -C D:/work/ana-wt/dev-<ticket> -c user.name=\"Ana Dev\" -c user.email=\"ana@example.com\" commit",
      "Edit(//d/work/ana-wt/<worktree>/**) select(.user.login==\"ana-dev\") <@U0ANA1234>",
      "Ana's calendar; \"postAs\":\"Ana Dev Lopez\"; basecamp query \"Ana\"; nothing is sent without Ana's approval.",
      "MESA session --label lead --project ana-work; project: \"ana-work-sandbox\"; session/ana-work-sandbox-lead",
    ].join("\n"),
  );
  assert.deepEqual(leftovers(out), []);
  // the original owner's name is a leftover, in both spellings
  assert.deepEqual(leftovers("Andrés's board"), ["Andrés"]);
  assert.deepEqual(leftovers("Andres decides"), ["Andres"]);
  // without a full name or a project, the owner's name and the canonical project stand in
  assert.equal(renderText('Andrés Correa project: "designli"', { ...cfg, ownerFullName: undefined, project: undefined }), 'Ana project: "designli"');
  // a replacement that itself contains a canonical-looking string is not substituted again
  assert.equal(renderText("G:/WorkSpace/designli/ops", { ...cfg, repo: "H:/acorrea-designli/ops" }), "H:/acorrea-designli/ops");
});

// The shipped skills, agents and preamble must render clean. `z4yross` is exempt until vendor/ (PR3) replaces the
// references to the owner's profile folder.
const skip = existsSync(join(REPO, "vendor")) ? [] : ["z4yross"];
// The configured paths (this checkout, the sessions folder, the worktrees root) may sit under a folder named like the
// owner's (a worktree under G:/WorkSpace/designli-wt, a temp folder under his profile): they are not leftovers.
const own = (t, render) => [fwd(REPO), ...(render ? [render.repo, render.sessions, render.worktrees] : [])].reduce((s, p) => maskPath(s, p), t);
const left = (t, render) => leftovers(own(t, render), skip);

function renderedInstall(extra = {}) {
  const root = tmp();
  const target = join(root, "ana");
  mkdirSync(target);
  const cfg = resolveConfig(["--target", target, "--repo", REPO, ...flags(ana()), "--allow", ...(extra.args ?? [])], {});
  assert.equal(cfg.mode, "render");
  const log = [];
  const { identity, ...rest } = cfg;
  install({ ...rest, node: NODE, identity, log: (l) => log.push(l), ...(extra.install ?? {}) });
  return { target, cfg, log };
}

function allFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(join(dir, e.name)) : [join(dir, e.name)]));
}

test("a teammate install renders real copies of every skill, agent and the preamble with his paths and identity", () => {
  const { target, cfg } = renderedInstall();
  const claude = join(target, ".claude");
  for (const p of [join(claude, "skills", "mesa-start"), join(claude, "agents"), join(claude, "mesa")]) assert.equal(lstatSync(p).isSymbolicLink(), false, p);
  const files = allFiles(claude).filter((f) => !/settings\.json|rendered\.json/.test(f));
  assert.ok(files.length >= 15);
  const texts = files.map((f) => [f, readFileSync(f, "utf8")]);
  for (const [f, t] of texts) assert.deepEqual(left(t, cfg.render), [], f);
  const read = (rel) => readFileSync(join(claude, rel), "utf8");
  const mine = fwd(REPO);
  assert.match(read("agents/dev.md"), /user\.name="Ana Dev" -c user\.email="ana@example\.com" commit/);
  assert.ok(read("agents/dev.md").includes(`git -C ${cfg.render.worktrees}/dev-<ticket>`));
  assert.ok(read("mesa/spawn-preamble.md").includes(`node ${mine}/bin/mesa`));
  assert.ok(read("skills/mesa-sweep/SKILL.md").includes(`node ${mine}/scripts/sweep-tick.mjs config`));
  assert.ok(read("agents/sweeper.md").includes("<@U0ANA1234>"));
  assert.ok(read("agents/reviewer.md").includes('"ana-dev"'));
  assert.ok(existsSync(join(claude, "skills", "mesa-write", "assets", "template.html")));
  // the repo's own files are untouched
  assert.ok(readFileSync(join(REPO, ".claude", "agents", "dev.md"), "utf8").includes("acorrea-designli"));
});

test("a teammate install's settings carry his identity env, his hook paths and allow rules, and none of the owner's", () => {
  const { target, cfg } = renderedInstall();
  const raw = readFileSync(join(target, ".claude", "settings.json"), "utf8");
  const s = JSON.parse(raw);
  assert.deepEqual({ ...s.env }, { ...ENV, MESA_GH_USER: "ana-dev", MESA_GIT_NAME: "Ana Dev", MESA_GIT_EMAIL: "ana@example.com", MESA_SLACK_USER_ID: "U0ANA1234", MESA_OWNER_NAME: "Ana", MESA_OWNER_FULL_NAME: "Ana" });
  assert.deepEqual(s.permissions.allow.slice(0, 4), allowRules(fwd(REPO)).slice(0, 4));
  for (const shell of ["Bash", "PowerShell"]) assert.ok(s.permissions.allow.includes(`${shell}(node ${fwd(REPO)}/vendor/pr-gh.mjs *)`));
  assert.deepEqual(left(raw, cfg.render), []);
});

test("rendering twice changes nothing; a refresh after the repo changes rewrites only what it rendered", () => {
  const { target, cfg } = renderedInstall();
  const { identity, ...rest } = cfg;
  const again = [];
  install({ ...rest, node: NODE, identity, log: (l) => again.push(l) });
  assert.ok(again.filter((l) => !l.startsWith("WARN")).every((l) => l.startsWith("ok")), again.join("\n"));
  // a stale rendered file is refreshed
  const dev = join(target, ".claude", "agents", "dev.md");
  writeFileSync(dev, "stale");
  const log = [];
  install({ ...rest, node: NODE, identity, log: (l) => log.push(l) });
  assert.ok(log.some((l) => l.startsWith("render") && l.includes("dev.md")));
  assert.ok(readFileSync(dev, "utf8").includes('user.name="Ana Dev"'));
  // a file of his own with the same name as a role is not ours to overwrite
  const mineFile = join(target, ".claude", "agents", "writer.md");
  mkdirSync(join(target, ".claude", "agents"), { recursive: true });
  writeFileSync(mineFile, "mine");
  const manifest = join(target, ".claude", "mesa", "rendered.json");
  const m = JSON.parse(readFileSync(manifest, "utf8"));
  writeFileSync(manifest, JSON.stringify({ files: m.files.filter((f) => f !== "agents/writer.md") }));
  const log2 = [];
  install({ ...rest, node: NODE, identity, log: (l) => log2.push(l) });
  assert.equal(readFileSync(mineFile, "utf8"), "mine");
  assert.ok(log2.some((l) => /^SKIP .*writer\.md differs and was not rendered/.test(l)));
});

test("rendering never writes through a link-mode junction into the repo, unless --force replaces the link", () => {
  const root = tmp();
  const target = join(root, "ana");
  mkdirSync(join(target, ".claude", "skills"), { recursive: true });
  const repoSkill = join(REPO, ".claude", "skills", "mesa-start");
  const before = readFileSync(join(repoSkill, "SKILL.md"), "utf8");
  symlinkSync(repoSkill, join(target, ".claude", "skills", "mesa-start"), "junction");
  const cfg = resolveConfig(["--target", target, "--repo", REPO, ...flags(ana())], {});
  const { identity, ...rest } = cfg;
  const log = [];
  install({ ...rest, node: NODE, identity, log: (l) => log.push(l) });
  assert.ok(log.some((l) => /^SKIP .*mesa-start is a link into a checkout/.test(l)));
  assert.equal(readFileSync(join(repoSkill, "SKILL.md"), "utf8"), before);
  assert.ok(lstatSync(join(target, ".claude", "skills", "mesa-start")).isSymbolicLink());
  install({ ...rest, force: true, node: NODE, identity, log: () => {} });
  assert.equal(lstatSync(join(target, ".claude", "skills", "mesa-start")).isSymbolicLink(), false);
  assert.equal(readFileSync(join(repoSkill, "SKILL.md"), "utf8"), before);
  assert.deepEqual(left(readFileSync(join(target, ".claude", "skills", "mesa-start", "SKILL.md"), "utf8"), cfg.render), []);
});

test("a dry run with --allow prints every allow rule it would add, so the older ones can be reviewed first", () => {
  const target = tmp();
  const log = [];
  install({ target, node: NODE, allow: true, dryRun: true, log: (l) => log.push(l) });
  for (const r of ALLOW) assert.ok(log.includes(`merge   permissions.allow: ${r}`), r);
  // and the later run that writes them adds nothing the dry run did not list
  const real = [];
  install({ target, node: NODE, allow: true, log: (l) => real.push(l) });
  assert.deepEqual(real.filter((l) => l.startsWith("merge")), log.filter((l) => l.startsWith("merge")));
});

test("--dry-run of a render writes nothing", () => {
  const root = tmp();
  const target = join(root, "ana");
  mkdirSync(target);
  const cfg = resolveConfig(["--target", target, "--repo", REPO, "--dry-run", ...flags(ana())], {});
  const { identity, ...rest } = cfg;
  const log = [];
  install({ ...rest, node: NODE, identity, log: (l) => log.push(l) });
  assert.ok(log.some((l) => l.startsWith("render")));
  assert.equal(existsSync(join(target, ".claude", "agents")), false);
  assert.equal(existsSync(join(target, ".claude", "settings.json")), false);
});

test("a render with --commit-guard registers the guard at his repo path", () => {
  const { target } = renderedInstall({ args: ["--commit-guard"] });
  const s = JSON.parse(readFileSync(join(target, ".claude", "settings.json"), "utf8"));
  assert.ok(s.hooks.PreToolUse.some((e) => e.hooks[0].command.includes(`${fwd(REPO)}/vendor/commit-guard.mjs`)));
});

test("maskPath hides a configured path in the forward-slash, backslash and /d/ spellings", () => {
  const t = "a D:/work/z4yross/ana b D:\\work\\z4yross\\ana c /d/work/z4yross/ana";
  assert.equal(maskPath(t, "D:/work/z4yross/ana"), "a <own> b <own> c <own>");
});
