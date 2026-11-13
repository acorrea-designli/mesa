# vendor/

Files Mesa's skills and agents depend on, kept in the repo so a fresh checkout does not need anything from another
person's Claude profile. They are plain files: nothing here is a Claude skill or a command by location, so installing
the team (`scripts/install-team.mjs`) never links them next to a user's own `pr-review` or `slack-triage`.

| File | What it is | Used by |
| --- | --- | --- |
| `pr-review/SKILL.md` | the PR review quality bar (rules, flow, incremental re-review, Copilot report) | `.claude/skills/mesa-review`, `.claude/agents/reviewer.md` |
| `pr-monitor.md` | the review-pass rules: gate, boxes, review state, what each click does | `mesa-review`, `mesa-sweep` § 1 |
| `slack-triage.md` | the Slack triage logic (three searches, three buckets) | `mesa-sweep` § 3 |
| `pr-gh.mjs` | the one script that writes reviews, approvals and replies to GitHub, under `MESA_GH_USER`'s token | `mesa-review` § Lead writes |
| `commit-guard.mjs` (+ test) | the PreToolUse hook that enforces one-line conventional commits and no AI attribution | register it in your user `settings.json` (see below) |

## Rules for what lives here

- No personal data: no login, email, Slack or workspace id, no home-directory path, no token, no client or repo
  names. Identity comes from the environment (`MESA_GH_USER`, `MESA_SLACK_USER_ID`, `MESA_GIT_NAME`,
  `MESA_GIT_EMAIL`), the wording "the configured login" in markdown, or `<mesa-repo>` for this checkout.
- `vendor/vendor.test.mjs` fails when a file here (or a Mesa skill, agent or the spawn preamble) names a known
  personal identifier or a hard-coded profile path.
- These are copies. When the upstream copy improves, port the change by hand and re-run `pnpm test:team`.

## pr-gh.mjs

```
node <mesa-repo>/vendor/pr-gh.mjs whoami            # read only, proves the token
node <mesa-repo>/vendor/pr-gh.mjs approve <owner/repo> <pr> [sha]
node <mesa-repo>/vendor/pr-gh.mjs review  <owner/repo> <pr> <APPROVE|REQUEST_CHANGES|COMMENT> <payload.json>
node <mesa-repo>/vendor/pr-gh.mjs reply   <owner/repo> <pr> <in_reply_to_id> <body.txt>
```

It needs `gh` logged in as the reviewing account and `MESA_GH_USER` set to that login, either in the environment or as
a line in the checkout's `.env.local`. With neither it refuses (one JSON line, exit 1) instead of writing under
whichever account `gh` has active.

## commit-guard.mjs

A Claude Code hook. Register it for the `Bash` and `PowerShell` tools in your user `settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [{ "type": "command", "command": "node <mesa-repo>/vendor/commit-guard.mjs" }]
      }
    ]
  }
}
```

The Mesa team's commit rule (preamble rule 10) is enforced by it: exactly one `-m "type(scope): subject"`, lowercase,
at most 72 characters, no trailer, no attribution in commits or in `gh pr` / `gh issue` bodies.
