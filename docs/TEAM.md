# Mesa team handbook

The agent team behind Mesa. Andrés never sees it as a team (PRODUCT.md: no agent panel, no rosters in the UI); he
sees tickets, questions, plans, salidas and approval cards. This file is the contract the lead and every teammate
follow. Grep the section you need; nobody reads it end to end. Rules every spawned agent reads first are numbered in
`.claude/spawn-preamble.md`; the hooks cite them.

**The one idea: nothing depends on a context window.** The lead's context is capped and every teammate dies when its
task ends. All state lives in Mesa (SQLite: brief, plan, messages, handoffs, team, approvals, salidas) and in engram
(durable decisions, lessons, client preferences). Every agent boots from `mesa ticket context <ref>` plus
`mem_search`, and writes its handoff before it stops. `/mesa-start` rebuilds the lead the same way after every
compaction or new session.

## 1. Roster

| Role | Model | Lifetime | Boots from | Writes before dying | Never |
|---|---|---|---|---|---|
| **lead** | the session's model | the work session | `/mesa-start`: health, `mem_context` (`session/mesa-lead`), open tickets, salidas, live team | `/mesa-end`: session summary (`session/mesa-lead`), `mesa/<ref>` records | does a teammate's work, sends without a released salida, asks Andrés outside a ticket, runs `gh auth` |
| **tl** | opus | one client technical request, until closed | brief, handoffs, the source thread, `client/<slug>` | handoff each stop; `mesa/<ref>` at close | edits code, reviews its team's PR, writes client text |
| **reviewer** | opus | one PR's review pass | brief, the previous reviewer's `review-state`, `review/<repo>/*` | handoff with `review-state` | writes to GitHub, re-reviews a reviewed range, resurrects a closed finding |
| **dev** | sonnet (opus on `complexity: high`) | one ticket's code change, until PASS | brief, handoffs, `lesson/*` | handoff (branch, sha, PR) | full test suites, a second ticket, GitHub comments |
| **devops** | sonnet (opus on `complexity: high`) | one ticket's infra change, until PASS | brief, handoffs, `lesson/*` | handoff (branch, sha, PR, plan summary) | `apply`, state writes, secrets in output |
| **researcher** | opus | one investigation, until Andrés closes it | brief, handoffs, past investigations in engram | handoff; `lesson/<slug>` for a cause found | writes to any source, re-runs CI or deploys |
| **writer** | opus | one message or document, until sent or denied | brief, the destination thread, `client/<slug>` | handoff; `client/<slug>` upsert | sends, changes a Mantener phrase, invents facts |
| **sweeper** | haiku | one work session or `maxTicksPerInstance` ticks, one at a time | `config/sweep.json`, the per-source watermarks in Mesa | nothing: each tick reports its watermark to Mesa as it goes | writes to Slack or Basecamp, ends its turn between ticks, speaks when nothing is new |

Tools, the exact command sheet and the loop of each role are in `.claude/agents/<role>.md`. The lead has no
definition file: it is Andrés's session, driven by the `mesa-*` skills.

**Why these models.** tl, reviewer, researcher and writer make the judgment calls Andrés relies on (scope, defects,
causes, what a client reads), so they run on Opus. dev and devops implement a brief that an Opus tl wrote and an
Opus reviewer checks, so Sonnet is enough; the tl marks a NEED `complexity: high` when it is not. The sweeper runs
every minute all day, mostly to learn that nothing changed, so it is Haiku; it only classifies what is new.

**Why no qa.** Mesa's work is reviews, small client infra and config changes, investigations and messages. The tl
already checks every acceptance criterion against the PR, the reviewer checks the code, and nothing is deployed by
the team (applies are Andrés's approved actions). A qa role would re-check the same criteria with no environment of
its own. Add it when a ticket type ships UI or a deploy the team itself verifies.

## 2. Names, spawn and retire

**Names** are `<role>-<ref>[-k]`: `tl-t14`, `reviewer-t12`, `reviewer-t12-2` for the second PR or the second pass.
Names are never reused. The ticket ref is in the name, which is how the hooks find an agent's ticket. The sweeper
has no ticket and is named `sweeper-<n>`.

**Spawn** (lead only; teammates cannot spawn and ask with `NEED`):

1. Pick the next free name: `mesa team list --ticket <ref>` lists live and retired names.
2. `mesa team add <ref> --agent <name> --role <role> [--owner]`.
3. Agent tool: `subagent_type: <role>`, `name: <name>`, `run_in_background: true` (model from the definition, or
   `opus` for a `complexity: high` dev/devops), prompt:

   ```
   You are `<name>`. Ticket <ref>: <title>. Role <role>; owner <owner name | you>; report to <owner | team-lead>.
   Read `.claude/mesa/spawn-preamble.md` first, then boot (rule 1) with
   `node G:/WorkSpace/designli/ops/bin/mesa ticket context <ref>`.
   Task: <one paragraph: the NEED's reason, or the brief's ask>.
   ```

4. Tell the owner the new name in one line (`SPAWNED <ref> <name>`).

**Retire**: on `DONE` (or at `/mesa-end`): `mesa team retire <name> --reason <why>`, then `TaskStop`. A message to a
stopped agent would resume it from its transcript, so the PreToolUse hook (G2) refuses sends to any retired name.
After a session restart every agent from the old session is retired and only owners are respawned (next suffix);
owners re-`NEED` their teammates.

Limits: at most 5 reviewers live at once (pr-monitor's per-tick cap); everything else is bounded by open tickets.

## 3. Messages

Plain text, first word is the verb, at most 12 non-empty lines (HANDOFF, BRIEF and SPAWN: 60), one recipient, no
acknowledgements (hook G3). Detail lives in the ticket; a message points at it.

| From → to | Message |
|---|---|
| owner → team-lead | `NEED <role> <ref> <why>[ complexity: high]` · `DONE <ref> <name> <result>` · `BLOCKED <ref> <why>` |
| any → team-lead | `HANDOFF <ref> <name>` + the handoff text (only when Mesa is unreachable, hook H3) |
| team-lead → agent | the spawn prompt · `ANSWER <ref> <message id \| plan_approved \| salida.turn <salida> <turn>>` · `SENT <ref> <salida> [comment ids]` · `CLOSED <ref>` · `REOPENED <ref>` · `HANDOFF-NOW <ref>` · `SPAWNED <ref> <name>` |
| implementer → tl | `READY <ref> PR <url> at <sha>` |
| reviewer/tl → implementer | `PASS <ref> #<n> at <sha>` · `FAIL <ref> #<n> at <sha>` + numbered items with `path:line` |
| teammate → owner | `DONE <ref> <name> <result>` (the owner forwards what the lead needs) |

## 4. Ticket templates

The lead classifies each new ticket (or item worth a ticket) and spawns its owner.

| Template | When | Owner | Team | Ends when |
|---|---|---|---|---|
| **Review** | a PR that needs Andrés's review (`mesa-sweep` gate) or "haz un review pass" | `reviewer-<ref>` | none | his choice is executed; the ticket stays open while findings are open, and the next push brings `reviewer-<ref>-2` |
| **Client technical request** | a client asks for a change (Basecamp, Slack, a forwarded email): "Matt asked for infra" | `tl-<ref>` | `devops-` or `dev-`, then `reviewer-`, then `writer-`; `researcher-` if the cause is unknown | the client reply is sent and Andrés closes it |
| **Investigation** | "resume este hilo", "por qué falla el build", "qué pasó con X" | `researcher-<ref>` | `writer-` if a message comes out of it | Andrés closes it; escalates to a tl when it needs a change |
| **Simple reply** | a message that only needs words: answer a question, confirm, follow up | `writer-<ref>` | none | the salida is sent or denied |

Client technical request, step by step: tl validates and writes the brief → asks Andrés what only he can decide →
posts the plan → on `ticket.plan_approved`, `NEED devops` → devops `READY` → tl `NEED reviewer` → reviewer `PASS`
(or `FAIL` → one push → `READY`) → tl checks every criterion → tl `NEED writer` with the outcome → writer proposes
the salida → Andrés approves → lead sends → tl writes `mesa/<ref>`, `DONE`. Applying infra or merging is a
`needs_ok` plan action the lead executes after approval (§ 8, open point 6).

## 5. Memory: Mesa vs engram

| What | Where | Key |
|---|---|---|
| ask, brief, plan, messages, attachments, refs | Mesa ticket | `t<N>` |
| handoffs (one per agent stop), team (live/retired), permission cards | Mesa | ticket ref + agent name |
| salidas: destination, versions, turns, marks, chips, sends | Mesa | salida id |
| review state (head, findings, comment ids) | the reviewer's handoff `review-state` block | ticket ref |
| the ticket's durable record: request, Andrés's decisions in his words, outcome, links | engram, owner upserts | `mesa/<ref>` |
| a client's tone, language, names, dislikes | engram, writer upserts | `client/<slug>` |
| a reusable review rule for a repo | engram, reviewer | `review/<owner>/<repo>/<slug>` |
| a measured gotcha (tooling, infra, a failure cause) | engram | `lesson/<slug>` |
| the lead's session summary and open items | engram | `session/mesa-lead` |
| per-source sweep state: watermark, last checked, last new, health, backoff | Mesa sources | `slack`, `basecamp` |

Engram is in English, never holds a secret or a client's private content verbatim, and is written with a
`topic_key` so a second save upserts. Only the lead answers `judgment_required` (`mem_judge`). Every session's cwd
stays `G:/WorkSpace/designli`: engram writes fail ("host session registration could not be confirmed") from a folder
that is not a project.

## 6. Permissions in every ticket

Agents get blocked by trivial things; a block must become a decision, not a dead agent.

1. **Reshape first** (preamble rule 9). An agent whose call is not allowed reads its allow rules
   (`.claude/settings.json`, `.claude/settings.local.json`) and its role's command sheet, and retries with an
   allowed shape: bare command, one per call, the right tool, no `cd`, `&&`, pipes or redirections.
2. **Card.** A call that still needs permission fires the `PermissionRequest` hook (`scripts/hooks/mesa-approval.mjs`),
   which files a card in the agent's ticket (the ticket is read from the agent's name) with the exact call, the cwd,
   and the closest allow rules it found. The call waits.
3. **Andrés presses one of three buttons:**
   - **Dar permiso**: this one call runs. Never a standing rule: the hook never returns `updatedPermissions` or
     `updatedInput`.
   - **Lee tus configuraciones**: denied; the agent is told to read its allow rules, given the closest rule and the
     shape advice, and retries with an allowed shape instead of asking again.
   - **Denegar**: denied, with his optional note.
4. **Timeout (9 min), an error, an expired card or an unreachable Mesa: deny**, with the instruction to stop trying
   that call and post a ticket question or send `BLOCKED`.

The lead's own prompts stay in his terminal (the hook passes the main thread through; `MESA_APPROVAL_LEAD=1` routes
them to Mesa too). When a card pattern repeats, the lead proposes the allow rule to Andrés as a ticket question; the
team never adds rules itself.

## 7. Hooks

Installed by `scripts/install-team.mjs` into `G:/WorkSpace/designli/.claude/settings.json`. Self-test any hook by
piping hook JSON into it; tests: `pnpm test:team` (node:test, mise node 22).

| Event | Script | Rules |
|---|---|---|
| PreToolUse (SendMessage, Bash, PowerShell, Chrome navigate, Slack, Basecamp) | `mesa-guardrails.mjs` (exit 2 blocks) | **G1** Chrome navigate needs a tabId · **G2** no message to a retired agent · **G3** 12-line limit, no acks · **G4** teammates never write to Slack, Basecamp or GitHub; `gh api` is GET-only for everyone · **G5** the lead's Slack/Basecamp sends must match a released salida's approved text, its pr-gh.mjs writes need a released github salida for that PR; Mesa down = blocked · **G6** git/gh/tests never in the background (only `mesa wait` and the Mesa server) · **G7** draft PRs only, no bare force push, no skipped hooks, no `gh auth` · **G10** nobody approves, schedules, denies or undoes through the raw API |
| PermissionRequest (all tools) | `mesa-approval.mjs` | § 6 |
| Stop, SubagentStop | `mesa-handoff-guard.mjs` | **H1** no handoff for the ticket · **H2** `DONE` with a stale or non-final handoff · **H3** Mesa down: handoff to engram and to the lead · refused once (`stop_hook_active`) |

**Global guard (outside this repo).** `C:/Users/z4yross/.claude/hooks/commit-guard.mjs` runs for every session on
this PC: a `git commit` must be one `-m "type(scope): subject"` (lowercase, no trailing period, at most 72
characters) with no attribution, and `gh pr` / `gh issue` bodies carry no AI attribution. The Mesa hooks do not
duplicate it (G9 was retired for that reason).

The hooks identify the caller from the hook input: no `agent_id` is the lead; otherwise the name comes from the
subagent's `.meta.json`, its agent id (`a<name>-<hex>`) or the spawn prompt's first line.

## 8. Lead execution of approved actions

Only the lead acts outward, and only after Andrés's approval:

- **Messages** (Slack, Basecamp): on `salida.released`, `mesa-salida` § Send.
- **GitHub** (approve, review comments, thread replies): github salidas, on `salida.released`, `mesa-review` § Lead writes.
- **Other `needs_ok` actions** (move a card, merge, apply infra): after `ticket.plan_approved`, the lead runs exactly
  the approved action, marks it with `mesa ticket action <id> --state done|failed`, and tells the owner.

## 9. Install

```
node G:/WorkSpace/designli/ops/scripts/install-team.mjs --dry-run   # the plan
node G:/WorkSpace/designli/ops/scripts/install-team.mjs             # links + hooks + env
node G:/WorkSpace/designli/ops/scripts/install-team.mjs --allow     # also the read-only allow rules
```

Run it with the mise node (`C:/Users/z4yross/AppData/Local/mise/installs/node/22.23.2/node.exe`); the hooks are
registered with the node that ran the installer. Re-run after every pull. Restart Claude Code in
`G:/WorkSpace/designli` afterwards.

## 10. Open points

1. **Mesa API: shipped.** Ticket context and brief, handoffs, team, approvals, findings, reviews, health and sweep
   are on main (`docs/ARCHITECTURE.md`). The foundation's own approval hook was folded into
   `scripts/hooks/mesa-approval.mjs` here (one hook): it keeps Mesa's `?wait=` long-poll and reads `MESA_AGENT` /
   `MESA_TICKET` only for separately launched sessions, because in-process teammates share the lead's environment;
   for them the identity comes from the spawn name.
2. **Empty-body APPROVE and `inReplyTo`** on `github_comment` (decided, 2026-11-03): requirements relayed to
   mesa-lead. Until `inReplyTo` ships, the lead continues a thread from the finding's `ghCommentId`.
3. **One click or two** (asked to Andrés): Mesa currently treats the review card's button as the approval, as
   pr-monitor did, and the salidas it creates only wait out the 20 s undo. If he wants to sign Post separately, Mesa
   creates those salidas pending instead; the team's flow does not change.
4. **One review per decision** (decided): Post sends ONE batched GitHub review with every new inline comment of that
   click, and continues existing threads as replies (`mesa-review` § Lead writes).
5. **Two test runners.** The team hooks and scripts use node:test so they run without an install; `vitest.config.ts`
   excludes `scripts/hooks/test/**` and `scripts/test/**`, and `pnpm check` runs them as `pnpm test:team`.
6. **Who applies infra** (asked to Andrés). devops never applies. Proposed: `apply_infra` is a `needs_ok` plan action the lead runs
   from the devops worktree with the saved plan file after approval, or the repo's CI applies on merge. Andrés decides.
7. **Hook payloads to verify live.** Whether `PermissionRequest` fires for background in-process teammates, and
   whether their `Stop` carries `agent_id` or their own `transcript_path`, could not be tested without a live team.
   Both shapes are handled; confirm with one researcher spawn on the first `/mesa-start`.
8. **Addresses.** The lead is addressed as `team-lead` and every Mesa call uses `MESA_SESSION=lead` (one stable
   session owns every ticket and relays wakes). If Mesa should show per-agent sessions instead, the CLI calls need
   `--session <name>` and `mesa wait` per agent.
9. **Engram project.** `G:/WorkSpace/designli` is not a git repo; check that `mem_current_project` resolves a
   stable project there before the first save.
10. **Who writes `mesa/<ref>`.** The architecture says sessions save ticket threads to engram and link them with
    `mesa engram link`. The team upserts one record per ticket at `mesa/<ref>`; if Mesa or the lead also saves
    threads, use the same key so it upserts instead of duplicating.
11. **Tunnel.** `/api/health` has no tunnel field yet and nothing in the repo starts a tunnel; `/mesa-start` treats it
    as a warning until it exists.
12. **pr-monitor coexistence.** Until Andrés switches, pr-monitor and Mesa reviewers can both review the same PR.
    The reviewer seeds its state from `~/.claude-work/pr-monitor-state.json` (read-only) when Mesa has none, so it
    does not re-review what pr-monitor already reviewed; findings still go to both places.
13. **Allow rules.** `--allow` adds read-only rules for the command sheets (Mesa CLI, gh GETs, git reads, engram,
    Basecamp and Slack reads). Review the list in `scripts/install-team.mjs` before using it. `gh api repos/*`
    also matches writes with `-f`; hook G4 blocks those for everyone.
14. **Lead question guard.** medix's Stop hook that refuses a lead turn ending in a question with no ticket is not
    included; the lead talks to Andrés in his own terminal. Add it if questions keep getting lost in chat.
15. **Watermarks in Mesa.** Health (`/api/sources/health`) and "Barrer ahora" (`/api/sweep`) exist; per-source
    watermarks and `lastInteractionAt` do not. `sweep-tick.mjs` asks `GET /api/sources` (`{sources: {slack,
    basecamp}, lastInteractionAt}`) and `PATCH /api/sources/:name` (watermark, lastChecked, lastNewAt, errorCount,
    backoffUntil, lastError) and, on 404, keeps them in `%TEMP%/mesa-team/sources.json` (outputs say
    `"store": "local"`). Until Mesa stores them there is no snap-back to 60 s when Andrés interacts with Mesa (a new
    item still snaps it back).
16. **Slack probe query.** The probe uses one search, `(to:me OR <@U06E2UBDC73>)`. If Slack search does not honour
    `OR` with `to:`, the probe becomes two calls (`to:me`, then the mention) and stays under the same limit.
17. **Sweeper approvals.** The sweeper has no ticket, so a permission card it raises has `ticketRef: null` and
    must show on Hoy. With `--allow`, its command sheet is fully allowed and it should never raise one.

## 11. Ingest: the sweep

Slack and Basecamp reach Mesa only through Claude's MCP connectors (Andrés, 2026-11-03: no Slack app, no Basecamp
OAuth). GitHub is polled by the Mesa server. The sweeper agent is the periodic ingest; `mesa-sweep` is its
procedure and the lead's on-demand pass.

- **Two stages per tick.** The probe is one MCP call per source since its watermark (Slack: `(to:me OR
  <@U06E2UBDC73>)` by timestamp; Basecamp: `get_my_notifications`). Only when it finds something new does the
  triage run (the slack-triage classification, the Basecamp rules), followed by `mesa item upsert` with the dedupe
  key as `externalId` and the watermark advance. A quiet tick writes only `lastChecked` and says nothing.
- **Cadence in config, not prose**: `config/sweep.json` holds work hours, the active interval (60 s), the idle
  interval (300 s) and when it applies (30 quiet minutes), the backoff (base, factor, cap), the probe limit and the
  ticks per instance. `scripts/sweep-tick.mjs` is the clock: `wait` blocks until a source is due, `report`
  records a tick's outcome. Any new item or any interaction by Andrés snaps the cadence back to 60 s.
- **Barrer ahora** (or `mesa sweep`) wakes the lead with `sweep.requested`. The sweeper is blocked in a foreground
  `wait` and cannot read a message, so the lead runs `sweep-tick.mjs force [--source s]`, which drops a flag that
  `wait` checks every `forceCheckSec` (5 s); it returns with every listed source not in backoff, even outside work
  hours.
- **Errors.** A 429 or an MCP error backs that source off (60 s, 120 s, … up to 30 min) and sets its Mesa health
  (`POST /api/sources/health`) to `limited` or `down`, which the rail shows (Estados B). The next good probe sets it
  back to `ok`, and Mesa then resumes the salidas held for that source.
- **Context.** The sweeper waits in the foreground, so its turn never ends between ticks: no idle notifications
  reach the lead and no tick costs the lead any context. After `maxTicksPerInstance` ticks it sends `DONE` and the
  lead spawns the next one; the watermarks carry over in Mesa.
