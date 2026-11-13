#!/usr/bin/env node
// Links the Mesa team (skills, agents, spawn preamble) into the sessions folder and wires its hooks.
//
//   node scripts/install-team.mjs [--target G:/WorkSpace/designli] [--allow] [--commit-guard] [--dry-run] [--force]
//   node scripts/install-team.mjs --target G:/WorkSpace/designli-sandbox --env sandbox [--repo G:/WorkSpace/designli/ops]
//   node scripts/install-team.mjs --target D:/work --gh-user <login> --git-name <name> --git-email <email> --slack-id <U0...> --owner-name <name>
//        [--owner-full-name <full name>] [--project <engram project>] [--sessions D:/work] [--worktrees D:/work-wt]
//                                                       (a teammate: renders copies, see below)
//
// Two modes. LINK (the original owner's layout: repo G:/WorkSpace/designli/ops, sessions folder G:/WorkSpace/designli,
// worktrees G:/WorkSpace/designli-wt, his identity) keeps today's junctions and hard links. RENDER (anything else:
// another repo or sessions folder, worktrees root, or identity) writes real copies of the skills, agents and the spawn
// preamble with the original owner's paths and identity replaced by the configured ones (scripts/lib/render-team.mjs);
// it refuses to run without --gh-user, --git-name, --git-email, --slack-id and --owner-name (or MESA_GH_USER, MESA_GIT_NAME,
// MESA_GIT_EMAIL, MESA_SLACK_USER_ID, MESA_OWNER_NAME), so nobody commits or reviews as somebody else by accident and the
// team calls you by your name, not the original owner's. --owner-full-name (MESA_OWNER_FULL_NAME, default: the owner name)
// is the name a calendar event is posted as; --project (MESA_PROJECT, default designli) is the engram project of the lead.
// Re-run after every pull. In both modes the live install writes those identity values into settings.json env (what
// vendor/pr-gh.mjs, the sweeper, the hooks and the mesa CLI read). --commit-guard also registers vendor/commit-guard.mjs as a PreToolUse hook (never by default).
//
// --env sandbox installs the same skills, agents and hooks for the sandbox board (docs/SANDBOX.md): the folder is
// created when missing, env is MESA_URL=http://127.0.0.1:8796, MESA_ENV=sandbox, MESA_SESSION=lead (these three are
// set even when the file has other values), and every hook command carries `--env sandbox`. It refuses the live
// sessions folder. --repo links a checkout other than the one running the installer (e.g. from a worktree).
//
// What it does, idempotently (run it again after every pull):
//   <target>/.claude/skills/<name>  -> junction to <repo>/.claude/skills/<name>, one per Mesa skill
//   <target>/.claude/agents         -> junction to <repo>/.claude/agents when absent; when it is a real folder,
//                                      hard links per role file (git replaces files on checkout, so re-run)
//   <target>/.claude/mesa           -> junction to <repo>/.claude (spawn-preamble.md for every teammate)
//   <target>/.claude/settings.json  -> merges the Mesa hook entries and env; never removes or rewrites existing
//                                      keys, and backs the file up first. --allow also merges the read-only allow
//                                      rules from the role command sheets. It adds the Mesa statusLine
//                                      (scripts/statusline.mjs: plan usage in the terminal and in Mesa's rail) only when
//                                      the file has no statusLine at all: one you already have is never replaced.
// It never touches anything else in <target> (that folder holds secrets) and never follows into it.
// --force replaces a differing agent file or a junction that points somewhere else. --dry-run prints the plan.
import { copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CANONICAL, IDENTITY_FIELDS, OPTIONAL_FIELDS, fwd, isTextFile, leftovers, maskPath, ownerLeftoverSkip, renderText } from "./lib/render-team.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const HOOK_SCRIPTS = {
  approval: "scripts/hooks/mesa-approval.mjs",
  denied: "scripts/hooks/mesa-denied.mjs",
  guard: "scripts/hooks/mesa-handoff-guard.mjs",
  rails: "scripts/hooks/mesa-guardrails.mjs",
};

export function hookEntries(repo, node, env = "live") {
  const tail = env === "sandbox" ? " --env sandbox" : "";
  const cmd = (rel) => `"${fwd(node)}" "${fwd(join(repo, rel))}"${tail}`;
  return {
    PreToolUse: [
      {
        matcher: "SendMessage|Bash|PowerShell|mcp__claude-in-chrome__navigate|mcp__claude_ai_Slack__.*|mcp__basecamp__.*|mcp__claude_ai_Google_Calendar__.*|mcp__google-calendar__.*|mcp__.*",
        hooks: [{ type: "command", command: cmd(HOOK_SCRIPTS.rails), timeout: 15 }],
      },
    ],
    PermissionRequest: [{ hooks: [{ type: "command", command: cmd(HOOK_SCRIPTS.approval), timeout: 600 }] }],
    // t128: a call auto mode denied becomes a "Bloqueado por el modo automático" card; the hook waits up to 120 s for it.
    PermissionDenied: [{ hooks: [{ type: "command", command: cmd(HOOK_SCRIPTS.denied), timeout: 150 }] }],
    Stop: [{ hooks: [{ type: "command", command: cmd(HOOK_SCRIPTS.guard), timeout: 15 }] }],
    SubagentStop: [{ hooks: [{ type: "command", command: cmd(HOOK_SCRIPTS.guard), timeout: 15 }] }],
  };
}

/** The opt-in commit rules hook (vendor/commit-guard.mjs): one-line conventional commits, no AI attribution. */
export function commitGuardEntry(repo, node) {
  return { matcher: "Bash|PowerShell", hooks: [{ type: "command", command: `"${fwd(node)}" "${fwd(join(repo, "vendor/commit-guard.mjs"))}"`, timeout: 15 }] };
}

/**
 * The statusLine that saves Claude's plan usage to Mesa (t45). The URL is explicit so a sandbox session posts to the
 * sandbox board and a live one to the live board, whatever the environment says.
 */
export function statusLineEntry(repo, node, env = "live") {
  const url = (env === "sandbox" ? SANDBOX_ENV : ENV).MESA_URL;
  return { type: "command", command: `"${fwd(node)}" "${fwd(join(repo, "scripts/statusline.mjs"))}" --url ${url}` };
}

// MESA_APPROVAL_LEAD=1 (t143 PR5): the lead's permission prompts and denied calls reach Mesa too (the focus ticket, or Hoy).
export const ENV = { MESA_URL: "http://127.0.0.1:8790", MESA_SESSION: "lead", MESA_APPROVAL_LEAD: "1" };
export const SANDBOX_ENV = { MESA_URL: "http://127.0.0.1:8796", MESA_ENV: "sandbox", MESA_SESSION: "lead" };
export const LIVE_FOLDER = "G:/WorkSpace/designli";

/** The read-only allow rules for a repo checkout; for the original owner's repo they are the rules that always were. */
export function allowRules(repo = CANONICAL.repo) {
  const r = fwd(repo);
  return [
    `Bash(node ${r}/bin/mesa *)`,
    `PowerShell(node ${r}/bin/mesa *)`,
    `Bash(node ${r}/.claude/skills/mesa-write/assets/render.mjs *)`,
    `Bash(node ${r}/scripts/sweep-tick.mjs *)`,
    ...ALLOW_COMMON,
    // t143: the vendored GitHub writer the lead runs after a click, from either shell (hook G5 still needs a released github salida).
    `Bash(node ${r}/vendor/pr-gh.mjs *)`,
    `PowerShell(node ${r}/vendor/pr-gh.mjs *)`,
  ];
}
const ALLOW_COMMON = [
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
export const ALLOW = allowRules(CANONICAL.repo);

/** The identity settings.json env carries (vendor/pr-gh.mjs reads MESA_GH_USER; the sweeper reads the Slack id; the hooks and the CLI the owner's name). */
/**
 * What the hooks, the CLI and the sandbox need to name the owner (the sandbox sends nothing, so it gets only these). A value
 * that is the original owner's is left out: the readers default to it, so his settings.json stays as it always was.
 */
export const ownerEnv = (id) =>
  Object.fromEntries(
    [
      ["MESA_OWNER_NAME", id.ownerName, CANONICAL.ownerName],
      ["MESA_OWNER_FULL_NAME", id.ownerFullName, CANONICAL.ownerFullName],
      ["MESA_PROJECT", id.project, CANONICAL.project],
    ].filter(([, v, canon]) => v !== canon),
  );
export const identityEnv = (id) => ({
  MESA_GH_USER: id.ghUser,
  MESA_GIT_NAME: id.gitName,
  MESA_GIT_EMAIL: id.gitEmail,
  MESA_SLACK_USER_ID: id.slackUserId,
  ...ownerEnv(id),
});

// Pure merge: adds what is missing, keeps everything that is there. A hook entry counts as present when any
// existing entry of that event already runs the same script.
export function mergeSettings(current, { hooks, env, allow, forceEnv = false, statusLine }) {
  const s = structuredClone(current ?? {});
  const added = [];
  s.hooks ??= {};
  for (const [event, entries] of Object.entries(hooks)) {
    s.hooks[event] ??= [];
    for (const entry of entries) {
      const script = entry.hooks[0].command.match(/(?:scripts\/hooks|vendor)\/[\w-]+\.mjs/)[0];
      const mine = (e) => (e.hooks ?? []).some((h) => String(h.command ?? "").replace(/\\/g, "/").includes(script));
      const there = s.hooks[event].some(mine);
      if (there && entry.matcher) {
        // An older install lacks the tools added since (Google Calendar, t112): widen its matcher, never narrow it.
        for (const e of s.hooks[event].filter(mine)) {
          if (typeof e.matcher !== "string") continue;
          const have = e.matcher.split("|");
          const missing = entry.matcher.split("|").filter((alt) => !have.includes(alt));
          if (missing.length) {
            e.matcher = [...have, ...missing].join("|");
            added.push(`hooks.${event}: matcher + ${missing.join("|")}`);
          }
        }
      }
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
    } else if (forceEnv && s.env[k] !== v) {
      // Sandbox: a session there must never reach the live board, whatever the file said before.
      added.push(`env.${k}: ${s.env[k]} -> ${v}`);
      s.env[k] = v;
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
  // Never replaces a statusLine the file already has (any value, even a different command): it is Andrés's.
  if (statusLine && !("statusLine" in s)) {
    s.statusLine = statusLine;
    added.push("statusLine: scripts/statusline.mjs");
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

// ---------- render mode ----------

const MANIFEST = (claude) => join(claude, "mesa", "rendered.json");
const readManifest = (claude) => {
  try {
    return new Set(JSON.parse(readFileSync(MANIFEST(claude), "utf8")).files);
  } catch {
    return new Set();
  }
};

/** Walks a folder: [relative path, absolute path] of every file. */
function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [[fwd(relative(base, p)), p]];
  });
}

/** A rendered file is never written through a link (that would rewrite the repo's own file). */
function realDir(dir, opt, log) {
  if (!isLink(dir)) return true;
  if (!opt.force) {
    log(`SKIP    ${fwd(dir)} is a link into a checkout (a link-mode install); --force replaces it with rendered copies`);
    return false;
  }
  log(`unlink  ${fwd(dir)}`);
  if (!opt.dryRun) rmSync(dir, { recursive: false, force: true });
  return true;
}

function renderFile(dest, key, content, ctx) {
  const { opt, log, managed, written } = ctx;
  if (existsSync(dest)) {
    if (readFileSync(dest).equals(content)) {
      written.add(key);
      return log(`ok      ${fwd(dest)}`);
    }
    // A file the last render wrote is ours to refresh; a different file of the same name is the user's.
    if (!managed.has(key) && !opt.force) return log(`SKIP    ${fwd(dest)} differs and was not rendered by install-team; --force replaces it`);
  }
  log(`render  ${fwd(dest)}`);
  written.add(key);
  if (!opt.dryRun) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
}

/** The configured paths may themselves sit under a folder named like the owner's (a worktree): they are not leftovers. */
function withoutOwnPaths(text, cfg) {
  let t = text;
  for (const p of [cfg.repo, cfg.worktrees, cfg.sessions]) t = maskPath(t, p);
  return t;
}

function renderTeam({ claude, repo, cfg, opt, log }) {
  const ctx = { opt, log, managed: readManifest(claude), written: new Set() };
  const warn = [];
  const emit = (dest, key, src) => {
    let content = readFileSync(src);
    if (isTextFile(src)) {
      const text = renderText(content.toString("utf8"), cfg);
      // A teammate who is also called Andrés keeps the name: it is then the configured one, not a leftover.
      const skip = ownerLeftoverSkip(cfg);
      for (const w of leftovers(withoutOwnPaths(text, cfg), skip)) warn.push(`${key} still contains ${w}`);
      content = Buffer.from(text, "utf8");
    }
    renderFile(dest, key, content, ctx);
  };

  for (const name of readdirSync(join(repo, ".claude", "skills"))) {
    const dir = join(claude, "skills", name);
    if (!realDir(dir, opt, log)) continue;
    for (const [rel, abs] of walk(join(repo, ".claude", "skills", name))) emit(join(dir, rel), `skills/${name}/${rel}`, abs);
  }
  const agents = join(claude, "agents");
  if (realDir(agents, opt, log)) {
    for (const f of readdirSync(join(repo, ".claude", "agents")).filter((x) => x.endsWith(".md"))) emit(join(agents, f), `agents/${f}`, join(repo, ".claude", "agents", f));
  }
  const mesa = join(claude, "mesa");
  if (realDir(mesa, opt, log)) emit(join(mesa, "spawn-preamble.md"), "mesa/spawn-preamble.md", join(repo, ".claude", "spawn-preamble.md"));

  for (const w of warn) log(`WARN    ${w}`);
  if (!opt.dryRun && !isLink(mesa)) {
    mkdirSync(mesa, { recursive: true });
    writeFileSync(MANIFEST(claude), `${JSON.stringify({ files: [...new Set([...ctx.managed, ...ctx.written])].sort() }, null, 2)}\n`);
  }
  return { rendered: [...ctx.written], warnings: warn };
}

export function install({ target, allow = false, dryRun = false, force = false, node = process.execPath, log = console.log, env = "live", repo = REPO, render = null, identity = null, commitGuard = false }) {
  const claude = join(target, ".claude");
  const opt = { dryRun, force };
  const sandbox = env === "sandbox";
  if (sandbox && same(target, fwd(resolve(LIVE_FOLDER)).toLowerCase())) throw new Error(`--env sandbox never installs into the live folder ${LIVE_FOLDER}`);
  if (!existsSync(target)) {
    if (!sandbox) throw new Error(`target ${target} does not exist`);
    log(`mkdir   ${fwd(target)}`);
    if (!dryRun) mkdirSync(target, { recursive: true });
  }
  if (!dryRun) mkdirSync(join(claude, "skills"), { recursive: true });

  if (render) {
    renderTeam({ claude, repo, cfg: render, opt, log });
  } else {
    for (const name of readdirSync(join(repo, ".claude", "skills"))) {
      junction(join(claude, "skills", name), join(repo, ".claude", "skills", name), opt, log);
    }
    const agents = join(claude, "agents");
    if (!existsSync(agents) || isLink(agents)) junction(agents, join(repo, ".claude", "agents"), opt, log);
    else agentFiles(agents, join(repo, ".claude", "agents"), opt, log);
    junction(join(claude, "mesa"), join(repo, ".claude"), opt, log);
  }

  const file = join(claude, "settings.json");
  const current = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const hooks = hookEntries(repo, node, env);
  if (commitGuard) hooks.PreToolUse.push(commitGuardEntry(repo, node));
  const { settings, added } = mergeSettings(current, {
    hooks,
    env: { ...(sandbox ? SANDBOX_ENV : ENV), ...(identity ? (sandbox ? ownerEnv(identity) : identityEnv(identity)) : {}) },
    allow: allow ? (render ? allowRules(repo) : ALLOW) : [],
    forceEnv: sandbox,
    statusLine: statusLineEntry(repo, node, env),
  });
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

// ---------- command line ----------

export class UsageError extends Error {}

/** The engram project of an install that is not the original owner's: the name of its sessions folder, made safe. */
export const projectFromFolder = (sessions) => {
  const name = fwd(sessions).split("/").filter(Boolean).pop() ?? "";
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "mesa";
};

const VALUE_FLAGS = ["--target", "--env", "--repo", "--sessions", "--worktrees", ...IDENTITY_FIELDS.map((f) => f.flag), ...OPTIONAL_FIELDS.map((f) => f.flag)];

/**
 * argv + environment -> what to install. Mode LINK when every value is the original owner's (or the install is a
 * sandbox / worktree link with his identity); mode RENDER when a path or an identity differs, which needs the whole
 * identity (flag, else MESA_GH_USER, MESA_GIT_NAME, MESA_GIT_EMAIL, MESA_SLACK_USER_ID) and refuses without it.
 */
export function resolveConfig(argv, env = process.env, defaults = { repo: REPO }) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (VALUE_FLAGS.includes(argv[i])) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) throw new UsageError(`${argv[i]} needs a value`);
      opts[argv[i]] = argv[++i];
    }
  }
  const flag = (n) => argv.includes(n);
  const mode = opts["--env"] ?? "live";
  if (mode !== "live" && mode !== "sandbox") throw new UsageError(`--env must be live or sandbox, not ${mode}`);
  const sandbox = mode === "sandbox";
  const target = opts["--target"] ?? LIVE_FOLDER;
  const repo = opts["--repo"] ? resolve(opts["--repo"]) : defaults.repo;

  let sessions = opts["--sessions"];
  if (!sessions) {
    if (!sandbox) sessions = target;
    else if (/-sandbox$/.test(fwd(target))) sessions = fwd(target).replace(/-sandbox$/, "");
    else throw new UsageError("--sessions is needed when the sandbox target is not named <sessions folder>-sandbox");
  }
  const envWorktrees = env.MESA_WORKTREES_ROOT?.trim();
  const worktrees = opts["--worktrees"] ?? (envWorktrees || `${fwd(sessions)}-wt`);

  const given = {};
  const identity = {};
  for (const f of IDENTITY_FIELDS) {
    const v = (opts[f.flag] ?? env[f.env] ?? "").trim();
    if (v) {
      if (!f.ok.test(v)) throw new UsageError(`${f.flag} (${f.env}) must be ${f.what}, got: ${v}`);
      given[f.key] = true;
    }
    identity[f.key] = v || CANONICAL[f.key];
  }

  const lc = (p) => fwd(resolve(p)).toLowerCase();
  const pathsDiffer = lc(worktrees) !== lc(CANONICAL.worktrees) || lc(sessions) !== lc(CANONICAL.sessions) || (!sandbox && lc(repo) !== lc(CANONICAL.repo));
  const notTheirs = pathsDiffer || IDENTITY_FIELDS.some((f) => identity[f.key] !== CANONICAL[f.key]);

  // Optional values: the full name follows the owner's name when only that one was given. The engram project is the
  // original owner's only on his own layout; anywhere else it defaults to the sessions folder's name, so one person's
  // engram records never land in another's project.
  for (const f of OPTIONAL_FIELDS) {
    const v = (opts[f.flag] ?? env[f.env] ?? "").trim();
    if (v && !f.ok.test(v)) throw new UsageError(`${f.flag} (${f.env}) must be ${f.what}, got: ${v}`);
    let fallback = CANONICAL[f.key];
    if (f.key === "ownerFullName" && identity.ownerName !== CANONICAL.ownerName) fallback = identity.ownerName;
    if (f.key === "project" && notTheirs) fallback = projectFromFolder(sessions);
    identity[f.key] = v || fallback;
  }

  const identityDiffers = [...IDENTITY_FIELDS, ...OPTIONAL_FIELDS].some((f) => identity[f.key] !== CANONICAL[f.key]);
  const render = identityDiffers || pathsDiffer;
  if (render) {
    const missing = IDENTITY_FIELDS.filter((f) => !given[f.key]);
    if (missing.length) {
      throw new UsageError(
        `this is not the original owner's layout, so the team files are rendered with your paths and identity, and these are missing: ${missing.map((f) => `${f.flag} <value> (or ${f.env})`).join(", ")}. ` +
          "Without them the agents would commit and review as somebody else.",
      );
    }
  }
  return {
    mode: render ? "render" : "link",
    env: mode,
    target,
    repo,
    allow: flag("--allow"),
    dryRun: flag("--dry-run"),
    force: flag("--force"),
    commitGuard: flag("--commit-guard"),
    identity,
    render: render ? { repo: fwd(repo), sessions: fwd(sessions), worktrees: fwd(worktrees), ...identity } : null,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let cfg;
  try {
    cfg = resolveConfig(process.argv.slice(2));
  } catch (err) {
    console.error(`install-team: ${err.message}`);
    process.exit(err instanceof UsageError ? 2 : 1);
  }
  if (cfg.mode === "link" && !same(cfg.repo, fwd(resolve(CANONICAL.repo)).toLowerCase())) {
    console.log(`note    linking ${fwd(cfg.repo)}, not ${CANONICAL.repo}: hooks and links will point there`);
  }
  console.log(cfg.mode === "render" ? `mode    render: copies of the skills, agents and preamble for ${cfg.identity.ghUser} (${fwd(cfg.target)})` : "mode    link: junctions into the repo");
  try {
    const { identity, ...rest } = cfg;
    install({ ...rest, identity });
    console.log(cfg.dryRun ? "dry run: nothing written" : `done. Restart Claude Code in ${fwd(cfg.target)} so it loads the hooks, skills and agents.`);
  } catch (err) {
    console.error(`install-team: ${err.message}`);
    process.exit(1);
  }
}
