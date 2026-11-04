#!/usr/bin/env node
// Links the Mesa team (skills, agents, spawn preamble) into the sessions folder and wires its hooks.
//
//   node scripts/install-team.mjs [--target G:/WorkSpace/designli] [--allow] [--dry-run] [--force]
//
// What it does, idempotently (run it again after every pull):
//   <target>/.claude/skills/<name>  -> junction to <repo>/.claude/skills/<name>, one per Mesa skill
//   <target>/.claude/agents         -> junction to <repo>/.claude/agents when absent; when it is a real folder,
//                                      hard links per role file (git replaces files on checkout, so re-run)
//   <target>/.claude/mesa           -> junction to <repo>/.claude (spawn-preamble.md for every teammate)
//   <target>/.claude/settings.json  -> merges the Mesa hook entries and env; never removes or rewrites existing
//                                      keys, and backs the file up first. --allow also merges the read-only allow
//                                      rules from the role command sheets.
// It never touches anything else in <target> (that folder holds secrets) and never follows into it.
// --force replaces a differing agent file or a junction that points somewhere else. --dry-run prints the plan.
import { copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fwd = (p) => p.replace(/\\/g, "/");

export const HOOK_SCRIPTS = {
  approval: "scripts/hooks/mesa-approval.mjs",
  guard: "scripts/hooks/mesa-handoff-guard.mjs",
  rails: "scripts/hooks/mesa-guardrails.mjs",
};

export function hookEntries(repo, node) {
  const cmd = (rel) => `"${fwd(node)}" "${fwd(join(repo, rel))}"`;
  return {
    PreToolUse: [
      {
        matcher: "SendMessage|Bash|PowerShell|mcp__claude-in-chrome__navigate|mcp__claude_ai_Slack__.*|mcp__basecamp__.*",
        hooks: [{ type: "command", command: cmd(HOOK_SCRIPTS.rails), timeout: 15 }],
      },
    ],
    PermissionRequest: [{ hooks: [{ type: "command", command: cmd(HOOK_SCRIPTS.approval), timeout: 600 }] }],
    Stop: [{ hooks: [{ type: "command", command: cmd(HOOK_SCRIPTS.guard), timeout: 15 }] }],
    SubagentStop: [{ hooks: [{ type: "command", command: cmd(HOOK_SCRIPTS.guard), timeout: 15 }] }],
  };
}

export const ENV = { MESA_URL: "http://127.0.0.1:8790", MESA_SESSION: "lead" };

const MESA_CLI = "node G:/WorkSpace/designli/ops/bin/mesa";
export const ALLOW = [
  `Bash(${MESA_CLI} *)`,
  `PowerShell(${MESA_CLI} *)`,
  "Bash(node G:/WorkSpace/designli/ops/.claude/skills/mesa-write/assets/render.mjs *)",
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
  "mcp__basecamp__list_campfire_lines",
  "mcp__basecamp__get_my_assignments",
  "mcp__basecamp__get_my_notifications",
  "mcp__claude_ai_Slack__slack_read_thread",
  "mcp__claude_ai_Slack__slack_read_channel",
  "mcp__claude_ai_Slack__slack_search_public_and_private",
  "mcp__claude_ai_Slack__slack_read_user_profile",
];

// Pure merge: adds what is missing, keeps everything that is there. A hook entry counts as present when any
// existing entry of that event already runs the same script.
export function mergeSettings(current, { hooks, env, allow }) {
  const s = structuredClone(current ?? {});
  const added = [];
  s.hooks ??= {};
  for (const [event, entries] of Object.entries(hooks)) {
    s.hooks[event] ??= [];
    for (const entry of entries) {
      const script = entry.hooks[0].command.match(/scripts\/hooks\/[\w-]+\.mjs/)[0];
      const there = s.hooks[event].some((e) => (e.hooks ?? []).some((h) => String(h.command ?? "").replace(/\\/g, "/").includes(script)));
      if (!there) {
        s.hooks[event].push(entry);
        added.push(`hooks.${event}: ${script}`);
      }
    }
  }
  s.env ??= {};
  for (const [k, v] of Object.entries(env)) {
    if (!(k in s.env)) {
      s.env[k] = v;
      added.push(`env.${k}`);
    }
  }
  if (allow?.length) {
    s.permissions ??= {};
    s.permissions.allow ??= [];
    for (const r of allow) {
      if (!s.permissions.allow.includes(r)) {
        s.permissions.allow.push(r);
        added.push(`permissions.allow: ${r}`);
      }
    }
  }
  return { settings: s, added };
}

const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
const linkTarget = (p) => {
  try {
    return fwd(resolve(readlinkSync(p))).replace(/\/$/, "").toLowerCase();
  } catch {
    return null;
  }
};
const same = (a, b) => fwd(resolve(a)).replace(/\/$/, "").toLowerCase() === b;

function junction(link, target, opt, log) {
  if (existsSync(link) || isLink(link)) {
    if (isLink(link) && linkTarget(link) === fwd(resolve(target)).replace(/\/$/, "").toLowerCase()) return log(`ok      ${fwd(link)}`);
    if (!isLink(link)) return log(`SKIP    ${fwd(link)} is a real folder; move it away to link it`);
    if (!opt.force) return log(`SKIP    ${fwd(link)} points elsewhere (${linkTarget(link)}); --force replaces it`);
    if (!opt.dryRun) rmSync(link, { recursive: false, force: true });
  }
  log(`link    ${fwd(link)} -> ${fwd(target)}`);
  if (!opt.dryRun) symlinkSync(target, link, "junction");
}

function agentFiles(dest, src, opt, log) {
  for (const f of readdirSync(src).filter((x) => x.endsWith(".md"))) {
    const to = join(dest, f);
    const from = join(src, f);
    if (existsSync(to)) {
      if (readFileSync(to, "utf8") === readFileSync(from, "utf8")) {
        log(`ok      ${fwd(to)}`);
        continue;
      }
      if (!opt.force) {
        log(`SKIP    ${fwd(to)} differs from the repo; --force replaces it`);
        continue;
      }
      if (!opt.dryRun) rmSync(to);
    }
    log(`hlink   ${fwd(to)} -> ${fwd(from)}`);
    if (!opt.dryRun) {
      try {
        linkSync(from, to);
      } catch {
        copyFileSync(from, to); // another volume: a copy, refreshed by the next run
      }
    }
  }
}

export function install({ target, allow = false, dryRun = false, force = false, node = process.execPath, log = console.log }) {
  const claude = join(target, ".claude");
  const opt = { dryRun, force };
  if (!existsSync(target)) throw new Error(`target ${target} does not exist`);
  if (!dryRun) mkdirSync(join(claude, "skills"), { recursive: true });

  for (const name of readdirSync(join(REPO, ".claude", "skills"))) {
    junction(join(claude, "skills", name), join(REPO, ".claude", "skills", name), opt, log);
  }
  const agents = join(claude, "agents");
  if (!existsSync(agents) || isLink(agents)) junction(agents, join(REPO, ".claude", "agents"), opt, log);
  else agentFiles(agents, join(REPO, ".claude", "agents"), opt, log);
  junction(join(claude, "mesa"), join(REPO, ".claude"), opt, log);

  const file = join(claude, "settings.json");
  const current = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const { settings, added } = mergeSettings(current, { hooks: hookEntries(REPO, node), env: ENV, allow: allow ? ALLOW : [] });
  if (!added.length) {
    log(`ok      ${fwd(file)} already has every Mesa entry`);
    return { added };
  }
  for (const a of added) log(`merge   ${a}`);
  if (!dryRun) {
    if (existsSync(file)) copyFileSync(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  }
  return { added };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const ti = argv.indexOf("--target");
  const target = ti >= 0 ? argv[ti + 1] : "G:/WorkSpace/designli";
  if (!same(REPO, fwd(resolve("G:/WorkSpace/designli/ops")).toLowerCase())) {
    console.log(`note    running from ${fwd(REPO)}, not G:/WorkSpace/designli/ops: hooks and links will point here`);
  }
  try {
    install({ target, allow: argv.includes("--allow"), dryRun: argv.includes("--dry-run"), force: argv.includes("--force") });
    console.log(argv.includes("--dry-run") ? "dry run: nothing written" : "done. Restart Claude Code in G:/WorkSpace/designli so it loads the hooks, skills and agents.");
  } catch (err) {
    console.error(`install-team: ${err.message}`);
    process.exit(1);
  }
}
