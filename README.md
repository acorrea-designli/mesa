# Mesa

A personal work-ops board: GitHub PR reviews, Basecamp requests, Slack replies and Claude Code's questions in one place, a calendar, a kanban mirrored to a private GitHub Project, two-way tickets with Claude Code sessions, and an approval queue for everything that goes out. Mesa runs on your own machine and acts only as you.

This file gets you from a clone to a running board and a working Claude team. The design lives in `docs/ARCHITECTURE.md`, the team in `docs/TEAM.md`, the CLI in `docs/SESSIONS.md`, the sandbox in `docs/SANDBOX.md`.

Mesa runs the same on Windows, macOS and Linux: every command below is a `node` or `pnpm` command, and paths use forward slashes, which Node accepts everywhere. A few commands set an environment variable; they are shown for a POSIX shell (bash, zsh) and for PowerShell. Claude Code itself needs a POSIX shell for its Bash tool (Git Bash on Windows); that is Claude Code's requirement, not Mesa's.

## Prerequisites

| What | Why |
| --- | --- |
| Access to the private repo `acorrea-designli/mesa` | to clone it |
| Node **22.23.2** | `node:sqlite` (the server) needs 22.13 or newer. `mise install` reads `mise.toml`; without mise, `.npmrc` makes pnpm download 22.23.2 for its scripts (`use-node-version`). If the `node` on PATH is older than 22.13, run `scripts/install-team.mjs` and `bin/mesa` through `pnpm exec node <script>`: the team hooks are registered with the node that ran the installer |
| pnpm **10** | `corepack enable` (the repo pins `pnpm@10.33.0`) |
| `gh` (GitHub CLI), logged in as **your** account | GitHub sync and review writes use that account's token. Give it the `project` scope so Mesa can create and update its Project |
| `engram` binary on PATH (or `MESA_ENGRAM_BIN`) and its MCP server in Claude Code | the team's memory (`mcp__engram__*`). It starts empty on a new machine: nothing of anyone else's memory is shared |
| Basecamp MCP server in Claude Code | the sweeper reads Basecamp through it (`mcp__basecamp__*`) |
| Slack and Google Calendar connectors in Claude Code | Slack reads and drafts, and the calendar events you approve (`mcp__claude_ai_Slack__*`, `mcp__claude_ai_Google_Calendar__*`). The Calendario screen itself reads the iCal feed (`MESA_GCAL_ICS_URL`) |
| Claude Code | the team runs in it |
| `cloudflared` (optional) | phone access through a Cloudflare Tunnel, `docs/ARCHITECTURE.md` § 11 |
| A private GitHub **Project** named "Mesa" under your login | the board's kanban. Mesa finds it by title (`MESA_GH_PROJECT_TITLE` renames it) and creates it on the first sync when it is missing |

Mesa holds no Slack, Basecamp or Google credentials: those are reached only through the Claude connectors. GitHub goes through `gh`.

## Install

```
git clone https://github.com/acorrea-designli/mesa.git
cd mesa
pnpm install
pnpm exec playwright install chromium   # once: client PDFs (mesa-write) render with it
pnpm check                               # optional: typecheck, lint, tests
pnpm build
```

Keep the checkout inside the folder where your Claude Code sessions will run, as its `ops/` subfolder (for example `~/work/ops` for a sessions folder `~/work` on macOS or Linux, `C:/Users/you/work/ops` for `C:/Users/you/work` on Windows). The sessions folder is the one you open Claude Code in; the team's skills, agents and hooks are installed into its `.claude/`.

## `.env.local`

Copy `.env.example` to `.env.local` (gitignored) and fill what applies; every variable is commented there. Mesa needs nothing to start. For your own board, set these:

| Variable | Set it to |
| --- | --- |
| `MESA_GH_USER` | your GitHub login (the board syncs and the review writer posts as this account) |
| `MESA_GIT_NAME`, `MESA_GIT_EMAIL` | the identity the team's agents commit with |
| `MESA_SLACK_USER_ID` | your Slack member id (`U0...`) |
| `MESA_OWNER_NAME` | the name the board, the hooks and the team call you by (the rail shows `Designli · <name>`); `MESA_OWNER_FULL_NAME` is the name a calendar event is posted as (default: the same) |
| `MESA_PROJECT` | the engram project the lead registers its session under (default: the name of your sessions folder; `designli` only on the original owner's layout) |
| `MESA_SESSIONS_DIR` | the folder your Claude Code sessions run in |
| `MESA_WORKTREES_ROOT` | where worktrees go (default: the sessions folder plus `-wt`) |
| `MESA_GCAL_ICS_URL` | optional: the secret iCal address of your Google Calendar |

Two settings are read from the shell, not from `.env.local`: `MESA_PORT` (default 8790; `serve.mjs` reads it before the file loads; `MESA_PORT=8800 pnpm start` in bash or zsh, `$env:MESA_PORT = 8800; pnpm start` in PowerShell) and `MESA_REPO` (the checkout the team hooks name to agents, normally derived from their location). `MESA_APPROVAL_LEAD` is written by `install-team` into the team's `.claude/settings.json`; you do not set it. Left unset, every value falls back to the original owner's, so on another machine none of the identity variables may stay blank.

The GitHub worker (notifications, review requests, the Project) starts only when `gh` holds a token for `MESA_GH_USER`; without one it logs a single line and stays off. `MESA_GITHUB=off` turns it off explicitly. The sweeper's repo list is `githubRepos` in `config/sweep.json`; put your own in an untracked `config/sweep.local.json`:

```
{ "githubRepos": ["your-org/your-repo"], "sources": { "slack": { "workspace": "your-team.slack.com" } } }
```

## Install the team

The team (skills, agents, spawn preamble, hooks, permission rules) is installed into your sessions folder with `scripts/install-team.mjs`. On any layout other than the original owner's it renders real copies of the skills, agents and preamble with your paths and identity, and it refuses to run without the whole identity. Dry run first:

```
node scripts/install-team.mjs --target <sessions folder> --gh-user <login> --git-name "<Your Name>" --git-email <you@example.com> --slack-id <U0...> --owner-name "<Your Name>" --dry-run --allow
```

Read the plan, then run it again without `--dry-run`. `--allow` adds the read-only allow rules, each printed as `merge   permissions.allow: ...`. `--sessions` and `--worktrees` are needed only when they are not `<target>` and `<target>-wt`. `--commit-guard` registers `vendor/commit-guard.mjs` (one-line conventional commits, no AI attribution) as a PreToolUse hook; leave it out when you already run your own. The same identity can come from `MESA_GH_USER`, `MESA_GIT_NAME`, `MESA_GIT_EMAIL`, `MESA_SLACK_USER_ID`, `MESA_OWNER_NAME` set in the shell (`--owner-full-name` and `--project` are optional): `install-team` does not read `.env.local`, so pass the flags or export them.

It writes `.claude/skills`, `.claude/agents`, `.claude/mesa/spawn-preamble.md` and merges hooks and env into `.claude/settings.json` (backing it up first, never removing a key). **Restart Claude Code in the sessions folder after every run**, or it keeps the old hooks, skills and agents.

## Setting Mesa up for yourself

For a Designli developer who installs Mesa on their own machine. Do the sections above first (prerequisites, install, `.env.local`, install the team), then:

**Connect the four sources.** Each source is yours: you connect it, nothing is shared with anyone else's install.

| Source | What to connect | Where |
| --- | --- | --- |
| GitHub | `gh auth login` with the `project` scope (`gh auth refresh -s project`); `MESA_GH_USER` is that login | `.env.local`, shell |
| Slack | the Slack connector in Claude Code (`/mcp`); your member id (profile, "Copy member ID") as `MESA_SLACK_USER_ID`; your workspace in `config/sweep.local.json` (`sources.slack.workspace`) | `.env.local`, `sweep.local.json` |
| Basecamp | the Basecamp MCP server in Claude Code, signed in as you | Claude Code |
| Calendar | the Google Calendar connector in Claude Code (creating and moving events, always as a salida you approve) and the secret iCal address of your calendar as `MESA_GCAL_ICS_URL` (reading) | `.env.local`, Claude Code |

To turn a source off: `"enabled": false` for Slack or Basecamp under `sources` in `config/sweep.local.json` (that switch covers only those two); GitHub is `MESA_GITHUB=off` and the calendar poller is `MESA_CALENDAR=off`, both in `.env.local`. The rest keeps working.

**Your repos.** `config/sweep.json` lists the repos the sweeper searches for review requests and the Slack workspace of the original owner. Do not edit it: copy what you need into the untracked `config/sweep.local.json`, which is merged over it (objects merge, arrays and values replace). `node scripts/sweep-tick.mjs config` prints the merged result. `config/projects.local.json` does the same for the Proyectos screen (`config/projects.json`).

**Your name.** `MESA_OWNER_NAME` and `--owner-name` are how the board, the hooks and the team call you; `MESA_OWNER_FULL_NAME` is the name a calendar event is posted as. `install-team` refuses to run without `--owner-name` (or `MESA_OWNER_NAME`).

**What does not travel.** A new install starts with nothing of the original owner's: no database (the board starts empty, `pnpm seed` loads sample data on request), no engram memory (the team builds its own as it works), no `.env.local`, no `.claude/settings.json` and no `config/*.local.json`. Everything you set lives in those files on your machine, and none of them is committed.

**Check it before you trust it.** Start the sandbox (below; on a fresh install seed it with `pnpm sandbox:reset --from seed`) first: nothing written there leaves your machine. Then run `/mesa-start` on the live board; it checks the board, `gh`, engram and the hooks, and tells you what is missing.

## First run

```
pnpm start            # http://127.0.0.1:8790 (pnpm dev for development)
```

Open http://127.0.0.1:8790 (the server binds to loopback only). Then open Claude Code in the sessions folder and run `/mesa-start`: it checks the board, `gh`, engram and starts the lead. Hoy shows what is waiting for you; Tablero mirrors the GitHub Project.

When a teammate agent or the lead is blocked on a permission, Mesa shows a card with **Permitir esta vez** (one exact call, once) or the rule it would add; see `docs/TEAM.md` § 6. Nothing is sent to Slack, Basecamp or GitHub without you approving its exact text in Mesa.

## Sandbox

A dummy copy of the board where nothing leaves, for trying things: `pnpm sandbox:reset --from seed` (`--from live` copies your own board once it has data), then `pnpm sandbox` serves http://127.0.0.1:8796 over `data/sandbox.db`. Install its Claude folder once (the sandbox folder must be named `<sessions folder>-sandbox`, or pass `--sessions`):

```
node scripts/install-team.mjs --target <sessions folder>-sandbox --env sandbox --gh-user <login> --git-name "<Your Name>" --git-email <you@example.com> --slack-id <U0...> --owner-name "<Your Name>" --dry-run
```

Read the plan, then run it again without `--dry-run`. Open Claude Code in that folder and run `/mesa-start`. Details in `docs/SANDBOX.md`.

## After every pull

1. `pnpm install` (dependencies change)
2. `node scripts/install-team.mjs ...` again with the same flags (junctions stay, rendered copies refresh), then restart Claude Code
3. `pnpm exec playwright install chromium` when `package.json` moved the Playwright version
4. Restart `pnpm start`; migrations apply on startup

## Testing a clone safely

On a second checkout or a test run, never share the real database: set `MESA_DB=<scratch file>`, `MESA_GITHUB=off`, `MESA_PORT=<free port>` and unset `MESA_SESSION` and `MESA_URL`. Without `MESA_DB`, the GitHub worker starts on its own for the configured login.

```
# bash / zsh
MESA_DB=data/mesa-test.db MESA_GITHUB=off MESA_PORT=8801 pnpm start

# PowerShell
$env:MESA_DB = "data/mesa-test.db"; $env:MESA_GITHUB = "off"; $env:MESA_PORT = 8801; pnpm start
```

## Where things are

- `CLAUDE.md`, `AGENTS.md`: conventions for working in this repo
- `docs/TEAM.md`: roles, messages, permissions (§ 6), hooks, install (§ 9)
- `docs/SESSIONS.md`: the `mesa` CLI
- `vendor/README.md`: the review, triage and commit-guard files Mesa carries
- `.env.example`: every setting, commented
