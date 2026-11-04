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

Tools, the exact command sheet and the loop of each role are in `.claude/agents/<role>.md`. The lead has no
definition file: it is Andrés's session, driven by the `mesa-*` skills.

**Why these models.** tl, reviewer, researcher and writer make the judgment calls Andrés relies on (scope, defects,
causes, what a client reads), so they run on Opus. dev and devops implement a brief that an Opus tl wrote and an
Opus reviewer checks, so Sonnet is enough; the tl marks a NEED `complexity: high` when it is not.

**Why no qa.** Mesa's work is reviews, small client infra and config changes, investigations and messages. The tl
already checks every acceptance criterion against the PR, the reviewer checks the code, and nothing is deployed by
the team (applies are Andrés's approved actions). A qa role would re-check the same criteria with no environment of
its own. Add it when a ticket type ships UI or a deploy the team itself verifies.

## 2. Names, spawn and retire

**Names** are `<role>-<ref>[-k]`: `tl-t14`, `reviewer-t12`, `reviewer-t12-2` for the second PR or the second pass.
Names are never reused. The ticket ref is in the name, which is how the hooks find an agent's ticket.

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
| the last sweep | engram | `session/mesa-sweep` |

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
piping hook JSON into it; tests: `node --test "scripts/**/*.test.mjs"` (mise node 22).

| Event | Script | Rules |
|---|---|---|
| PreToolUse (SendMessage, Bash, PowerShell, Chrome navigate, Slack, Basecamp) | `mesa-guardrails.mjs` (exit 2 blocks) | **G1** Chrome navigate needs a tabId · **G2** no message to a retired agent · **G3** 12-line limit, no acks · **G4** teammates never write to Slack, Basecamp or GitHub; `gh api` is GET-only for everyone · **G5** the lead's Slack/Basecamp sends must match a released salida's approved text, its pr-gh.mjs writes need a released github salida for that PR; Mesa down = blocked · **G6** git/gh/tests never in the background (only `mesa wait` and the Mesa server) · **G7** draft PRs only, no bare force push, no skipped hooks, no `gh auth` · **G9** one-line commits, no trailer · **G10** nobody approves, schedules, denies or undoes through the raw API |
| PermissionRequest (all tools) | `mesa-approval.mjs` | § 6 |
| Stop, SubagentStop | `mesa-handoff-guard.mjs` | **H1** no handoff for the ticket · **H2** `DONE` with a stale or non-final handoff · **H3** Mesa down: handoff to engram and to the lead · refused once (`stop_hook_active`) |

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

1. **Mesa API the team assumes and the foundation does not have yet** (sent to mesa-lead on 2026-11-03):
   `mesa ticket context <ref>` / `GET /api/tickets/:id/context`; `mesa ticket brief`; `mesa handoff` +
   `GET /api/handoffs?agent=`; `mesa team add|retire|list` + `GET /api/team?status=`; `POST/GET /api/approvals` and
   `POST /api/approvals/:id/decision` with the three-button card in the ticket. Until they ship: agents use
   `ticket show` instead of `ticket context`; the Stop hook falls back to H3 (handoff to engram and the lead); and
   **every permission card is denied** (Mesa answers 404), so agents end up asking through ticket questions.
2. **APPROVE body.** Salidas require a non-empty body, but pr-review approves with an empty one. The reviewer
   proposes `Approve at <sha7> with no comment.` and the lead always sends APPROVE with an empty body. Better: Mesa
   renders `github_review` APPROVE as "Aprobar sin comentario" and allows an empty body.
3. **Thread replies.** `github_comment` has no `inReplyTo`; the reviewer writes `reply to <ghCommentId>` in the
   salida context and the lead reads it there. Adding `inReplyTo` to the destination schema would make it exact.
4. **One click or two.** pr-monitor's Post/Approve click was the approval. Here Andrés picks the option in the
   ticket, then signs the github salida (with the 20 s undo). Should the ticket option count as the approval (Mesa
   approves the salida it creates)? Recommendation: yes for Approve, no for Post (he should see the comment text).
5. **One review per finding.** Posting creates one GitHub review per finding instead of pr-monitor's single review
   with every inline comment. A multi-comment `github_review` salida would restore the batch.
6. **Who applies infra.** devops never applies. Proposed: `apply_infra` is a `needs_ok` plan action the lead runs
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
