// Renders the Mesa team files (skills, agents, spawn preamble) for a teammate: every value that is the original owner's
// (his repo and sessions paths, worktrees root, git identity, GitHub login, Slack id, name and engram project) is replaced by the configured
// one. Used by scripts/install-team.mjs when anything differs from the canonical values; the canonical install
// keeps linking the repo's files as they are.
import { posix } from "node:path";

export const CANONICAL = {
  repo: "G:/WorkSpace/designli/ops",
  sessions: "G:/WorkSpace/designli",
  worktrees: "G:/WorkSpace/designli-wt",
  ghUser: "acorrea-designli",
  gitName: "acorrea-designli",
  gitEmail: "andres.correa@designli.co",
  slackUserId: "U06E2UBDC73",
  ownerName: "Andrés",
  ownerFullName: "Andrés Correa",
  project: "designli",
};

export const IDENTITY_FIELDS = [
  { key: "ghUser", flag: "--gh-user", env: "MESA_GH_USER", ok: /^[A-Za-z0-9][A-Za-z0-9-]*$/, what: "a GitHub login" },
  { key: "gitName", flag: "--git-name", env: "MESA_GIT_NAME", ok: /^[^"'`$\\\r\n]+$/, what: "a name without quotes, $, backticks or backslashes" },
  { key: "gitEmail", flag: "--git-email", env: "MESA_GIT_EMAIL", ok: /^[^\s@"'`$\\]+@[^\s@"'`$\\]+$/, what: "an email address" },
  { key: "slackUserId", flag: "--slack-id", env: "MESA_SLACK_USER_ID", ok: /^[UW][A-Z0-9]{6,}$/, what: "a Slack member id (U0...)" },
  // How the team files and the hook messages call the owner ("Andrés" in the original owner's files).
  { key: "ownerName", flag: "--owner-name", env: "MESA_OWNER_NAME", ok: /^[^"'`$\\\r\n]+$/, what: "the name the team calls you by, without quotes, $, backticks or backslashes" },
];

/** Optional: each falls back to a value derived from the identity, never to the original owner's. */
export const OPTIONAL_FIELDS = [
  { key: "ownerFullName", flag: "--owner-full-name", env: "MESA_OWNER_FULL_NAME", ok: /^[^"'`$\\\r\n]+$/, what: "your full name, without quotes, $, backticks or backslashes" },
  { key: "project", flag: "--project", env: "MESA_PROJECT", ok: /^[A-Za-z0-9][A-Za-z0-9._-]*$/, what: "an engram project name (letters, digits, . _ -)" },
];

export const fwd = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "");

/** "G:/a/b" -> "/g/a/b" (the Git Bash / permission-rule form); anything else is returned as is. */
export const posixForm = (p) => {
  const m = /^([A-Za-z]):\/(.*)$/.exec(fwd(p));
  return m ? `/${m[1].toLowerCase()}/${m[2]}` : fwd(p);
};

/** Replaces a configured path in all three spellings (D:/x, D:\x, /d/x) by a placeholder. */
export const maskPath = (text, p, mask = "<own>") =>
  text.split(fwd(p)).join(mask).split(fwd(p).replace(/\//g, "\\")).join(mask).split(posixForm(p)).join(mask);

const escapeRe =(s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The ordered pairs [canonical text, replacement]. Paths come in three spellings (G:/x, G:\x, /g/x); longer
 * canonical strings come first so `.../designli/ops` is not eaten by `.../designli`.
 */
export function substitutions(cfg) {
  const sessions = fwd(cfg.sessions);
  const pairs = [
    [CANONICAL.repo, fwd(cfg.repo)],
    [CANONICAL.worktrees, fwd(cfg.worktrees)],
    [`${CANONICAL.sessions}-sandbox`, `${sessions}-sandbox`],
    [CANONICAL.sessions, sessions],
  ];
  const out = [];
  for (const [from, to] of pairs) {
    out.push([from, to]);
    out.push([from.replace(/\//g, "\\"), to.replace(/\//g, "\\")]);
    out.push([posixForm(from), posixForm(to)]);
  }
  out.push([`user.name="${CANONICAL.gitName}"`, `user.name="${cfg.gitName}"`]);
  out.push([CANONICAL.gitEmail, cfg.gitEmail]);
  out.push([CANONICAL.ghUser, cfg.ghUser]);
  out.push([CANONICAL.slackUserId, cfg.slackUserId]);
  // The name: the full form first (the sort below keeps it ahead of the short one), both spellings of the short one.
  out.push([CANONICAL.ownerFullName, cfg.ownerFullName ?? cfg.ownerName]);
  out.push([CANONICAL.ownerName, cfg.ownerName]);
  out.push(["Andres", cfg.ownerName]);
  // The engram project the lead registers and passes on engram calls (the sandbox one is <project>-sandbox).
  const project = cfg.project ?? CANONICAL.project;
  for (const prefix of ["--project ", "project: \"", "session/"]) out.push([`${prefix}${CANONICAL.project}`, `${prefix}${project}`]);
  return out.sort((a, b) => b[0].length - a[0].length);
}

/** One pass over the text (no replacement is ever re-substituted). */
export function renderText(text, cfg) {
  const pairs = substitutions(cfg);
  const map = new Map(pairs);
  const re = new RegExp(pairs.map(([from]) => escapeRe(from)).join("|"), "g");
  return text.replace(re, (m) => map.get(m));
}

/** What still names the original owner in a rendered text (the check a teammate install must pass). */
export const LEFTOVERS = [
  "Andrés",
  "Andres",
  "G:/WorkSpace/designli",
  "G:\\WorkSpace\\designli",
  "/g/WorkSpace/designli",
  "acorrea-designli",
  "andres.correa@",
  "U06E2UBDC73",
  "z4yross",
];
export const leftovers = (text, skip = []) => LEFTOVERS.filter((s) => !skip.includes(s) && text.includes(s));

const TEXT_EXT = new Set([".md", ".mjs", ".js", ".json", ".html", ".css", ".txt", ".yml", ".yaml"]);
export const isTextFile = (name) => TEXT_EXT.has(posix.extname(name).toLowerCase());
