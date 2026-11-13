# Mesa

A personal work-ops board: GitHub PR reviews, Basecamp requests, Slack replies and Claude Code's questions in one place, a calendar, a kanban mirrored to a private GitHub Project, two-way tickets with Claude Code sessions, and an approval queue for everything that goes out. Mesa runs on your own machine and acts only as you.

This file gets you from a clone to a running board and a working Claude team. The design lives in `docs/ARCHITECTURE.md`, the team in `docs/TEAM.md`, the CLI in `docs/SESSIONS.md`, the sandbox in `docs/SANDBOX.md`.

Mesa targets Windows with Git Bash (junctions, `bin/mesa.cmd`). Paths below use forward slashes.

## Prerequisites

| What | Why |
| --- | --- |
| Access to the private repo `acorrea-designli/mesa` | to clone it |
| Node **22.23.2** | `node:sqlite` needs 22.13 or newer. `mise install` reads `mise.toml`; without mise, `.npmrc` makes pnpm download 22.23.2 for its scripts (`use-node-version`). A plain `node` older than 22.13 cannot run `scripts/install-team.mjs` or `bin/mesa`: use `pnpm exec node <script>` |
| pnpm **10** | `corepack enable` (the repo pins `pnpm@10.33.0`) |
| `gh` (GitHub CLI), logged in as **your** account | GitHub sync and review writes use that account's token. Give it the `project` scope so Mesa can create and update its Project |
| `engram` binary on PATH (or `MESA_ENGRAM_BIN`) and its MCP server in Claude Code | the team's memory (`mcp__engram__*`) |
| Basecamp MCP server in Claude Code | the sweeper reads Basecamp through it (`mcp__basecamp__*`) |
| Slack and Google Calendar connectors in Claude Code | Slack reads and drafts, calendar events (`mcp__claude_ai_Slack__*`, `mcp__claude_ai_Google_Calendar__*`) |
| Claude Code | the team runs in it |
| `cloudflared` (optional) | phone access through a Cloudflare Tunnel, `docs/ARCHITECTURE.md` § 11 |
| A private GitHub **Project** named "Mesa" under your login | the board's kanban. Mesa finds it by title and creates it on the first sync when it is missing |

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

Keep the checkout inside the folder where your Claude Code sessions will run, as its `ops/` subfolder (for example `D:/work/ops` for a sessions folder `D:/work`). The sessions folder is the one you open Claude Code in; the team's skills, agents and hooks are installed into its `.claude/`.

## `.env.local`

Copy `.env.example` to `.env.local` (gitignored) and fill what applies; every variable is commented there. Mesa needs nothing to start. For your own board, set these:

| Variable | Set it to |
| --- | --- |
| `MESA_GH_USER` | your GitHub login (the board syncs and the review writer posts as this account) |
| `MESA_GIT_NAME`, `MESA_GIT_EMAIL` | the identity the team's agents commit with |
| `MESA_SLACK_USER_ID` | your Slack member id (`U0...`) |
| `MESA_SESSIONS_DIR` | the folder your Claude Code sessions run in |
| `MESA_WORKTREES_ROOT` | where worktrees go (default: the sessions folder plus `-wt`) |
| `MESA_GCAL_ICS_URL` | optional: the secret iCal address of your Google Calendar |

Two settings are read from the shell, not from `.env.local`: `MESA_PORT` (default 8790; `serve.mjs` reads it before the file loads) and `MESA_REPO` (the hooks' checkout, normally derived from their location). Left unset, every value falls back to the original owner's, so on another machine none of the identity variables may stay blank.

The GitHub worker (notifications, review requests, the Project) starts only when `gh` holds a token for `MESA_GH_USER`; without one it logs a single line and stays off. `MESA_GITHUB=off` turns it off explicitly. The sweeper's repo list is `githubRepos` in `config/sweep.json`; put your own in an untracked `config/sweep.local.json`:

```
{ "githubRepos": ["your-org/your-repo"], "sources": { "slack": { "workspace": "your-team.slack.com" } } }
```

## Install the team

The team (skills, agents, spawn preamble, hooks, permission rules) is installed into your sessions folder with `scripts/install-team.mjs`. On any layout other than the original owner's it renders real copies of the skills, agents and preamble with your paths and identity, and it refuses to run without the whole identity. Dry run first:

```
node scripts/install-team.mjs --target D:/work --gh-user <login> --git-name "<Your Name>" --git-email <you@example.com> --slack-id <U0...> --dry-run --allow
```

Read the plan, then run it again without `--dry-run`. `--allow` adds the read-only allow rules, each printed as `merge   permissions.allow: ...`. `--sessions` and `--worktrees` are needed only when they are not `<target>` and `<target>-wt`. `--commit-guard` registers `vendor/commit-guard.mjs` (one-line conventional commits, no AI attribution) as a PreToolUse hook; leave it out when you already run your own. The same identity can come from `MESA_GH_USER`, `MESA_GIT_NAME`, `MESA_GIT_EMAIL`, `MESA_SLACK_USER_ID`.

It writes `.claude/skills`, `.claude/agents`, `.claude/mesa/spawn-preamble.md` and merges hooks and env into `.claude/settings.json` (backing it up first, never removing a key). **Restart Claude Code in the sessions folder after every run**, or it keeps the old hooks, skills and agents.

## First run

```
pnpm start            # http://127.0.0.1:8790 (pnpm dev for development)
```

Open http://127.0.0.1:8790 (the server binds to loopback only). Then open Claude Code in the sessions folder and run `/mesa-start`: it checks the board, `gh`, engram and starts the lead. Hoy shows what is waiting for you; Tablero mirrors the GitHub Project.

When a teammate agent or the lead is blocked on a permission, Mesa shows a card with **Permitir esta vez** (one exact call, once) or the rule it would add; see `docs/TEAM.md` § 6. Nothing is sent to Slack, Basecamp or GitHub without you approving its exact text in Mesa.

## Sandbox

A dummy copy of the board where nothing leaves, for trying things: `pnpm sandbox:reset`, then `pnpm sandbox` serves http://127.0.0.1:8796 over `data/sandbox.db`. Install its Claude folder once (the sandbox folder must be named `<sessions folder>-sandbox`, or pass `--sessions`):

```
node scripts/install-team.mjs --target D:/work-sandbox --env sandbox --gh-user <login> --git-name "<Your Name>" --git-email <you@example.com> --slack-id <U0...> --dry-run
```

Open Claude Code in that folder and run `/mesa-start`. Details in `docs/SANDBOX.md`.

## After every pull

1. `pnpm install` (dependencies change)
2. `node scripts/install-team.mjs ...` again with the same flags (junctions stay, rendered copies refresh), then restart Claude Code
3. `pnpm exec playwright install chromium` when `package.json` moved the Playwright version
4. Restart `pnpm start`; migrations apply on startup

## Testing a clone safely

On a second checkout or a test run, never share the real database: set `MESA_DB=<scratch file>`, `MESA_GITHUB=off`, `MESA_PORT=<free port>` and unset `MESA_SESSION` and `MESA_URL`. Without `MESA_DB`, the GitHub worker starts on its own for the configured login.

## Where things are

- `CLAUDE.md`, `AGENTS.md`: conventions for working in this repo
- `docs/TEAM.md`: roles, messages, permissions (§ 6), hooks, install (§ 9)
- `docs/SESSIONS.md`: the `mesa` CLI
- `vendor/README.md`: the review, triage and commit-guard files Mesa carries
- `.env.example`: every setting, commented
