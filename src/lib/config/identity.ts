// The one place that knows who this Mesa board belongs to and where its team lives. Every site that used to hard-code
// the GitHub login, the commit identity, the Slack id or the sessions / worktrees folders reads it from here.
//
// Each value comes from an environment variable (.env.local, see .env.example) and falls back to the original owner's
// value, so an install that sets nothing behaves exactly as before. A blank variable counts as unset.
//
//   MESA_GH_USER          GitHub login Mesa reads and writes as (gh keyring token for that account)
//   MESA_GIT_NAME         git author name the team's agents commit with
//   MESA_GIT_EMAIL        git author email the team's agents commit with
//   MESA_SLACK_USER_ID    Slack member id the sweeper reads mentions and DMs for
//   MESA_SESSIONS_DIR     folder the Claude Code sessions of this board run in (parent of this repo)
//   MESA_WORKTREES_ROOT   where the team's worktrees live (default: the sessions folder + "-wt")
//   MESA_SETTINGS_LOCAL   the settings.local.json that "Permitir esta regla" appends to
//                         (default: <sessions folder>/.claude/settings.local.json)

type Env = Record<string, string | undefined>;

/** The original owner's values: what every setting is when its variable is unset. */
export const CANONICAL = {
  ghUser: "acorrea-designli",
  gitName: "acorrea-designli",
  gitEmail: "andres.correa@designli.co",
  slackUserId: "U06E2UBDC73",
  sessionsDir: "G:/WorkSpace/designli",
  worktreesRoot: "G:/WorkSpace/designli-wt",
  settingsLocal: "G:/WorkSpace/designli/.claude/settings.local.json",
} as const;

export interface Identity {
  ghUser: string;
  gitName: string;
  gitEmail: string;
  slackUserId: string;
  sessionsDir: string;
  worktreesRoot: string;
  settingsLocal: string;
}

const pick = (env: Env, key: string): string | undefined => env[key]?.trim() || undefined;
const slashes = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");

export function identity(env: Env = process.env): Identity {
  const sessions = pick(env, "MESA_SESSIONS_DIR");
  const sessionsDir = sessions ? slashes(sessions) : CANONICAL.sessionsDir;
  return {
    ghUser: pick(env, "MESA_GH_USER") ?? CANONICAL.ghUser,
    gitName: pick(env, "MESA_GIT_NAME") ?? CANONICAL.gitName,
    gitEmail: pick(env, "MESA_GIT_EMAIL") ?? CANONICAL.gitEmail,
    slackUserId: pick(env, "MESA_SLACK_USER_ID") ?? CANONICAL.slackUserId,
    sessionsDir,
    worktreesRoot: pick(env, "MESA_WORKTREES_ROOT") ?? (sessions ? `${sessionsDir}-wt` : CANONICAL.worktreesRoot),
    settingsLocal: pick(env, "MESA_SETTINGS_LOCAL") ?? (sessions ? `${sessionsDir}/.claude/settings.local.json` : CANONICAL.settingsLocal),
  };
}
