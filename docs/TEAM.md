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
   Engram: pass project "designli" on every engram call.   <- only when mesa-start § 1 needed it
   ```

4. Tell the owner the new name in one line (`SPAWNED <ref> <name>`).

**Retire**: on `DONE` (or at `/mesa-end`): `mesa team retire <name> --reason <why>`, then `TaskStop`. A message to a
stopped agent would resume it from its transcript, so the PreToolUse hook (G2) refuses sends to any retired name.
After a session restart every agent from the old session is retired and only owners are respawned (next suffix);
owners re-`NEED` their teammates.

Limits: at most 5 reviewers **working** at once (pr-monitor's per-tick cap). A reviewer that reported READY and only waits for Andrés's click does not count, so a queued review starts as soon as fewer than 5 are working. Everything else is bounded by open tickets.

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

**Tasks go straight to an agent.** Every card Andrés creates in Mesa (Tablero "+ Tarea", Nuevo pedido, `mesa task create`)
and every "Dárselo a Claude" (one card or a batch, ingested PR/Basecamp/Slack cards included) becomes an `andres_asks`
ticket linked to its card, owned by `lead`, and one `ticket.created` wake `{ ref, ticketRef, taskId, kind? }` (2+ new tickets in one call wake once with `ticket.batch`, see Batches below). Only
"Solo anotar (sin agente)" / `--note-only` skips it; ingested items never dispatch on their own and sample cards never
dispatch. On the wake the lead, idempotently (delivery is at least once):

1. `mesa ticket show <ticketRef>`: skip when it is closed, or already has a live owner in `mesa team list --ticket <ref>`.
2. Triage by `kind`, else by the ticket and its card's links: `review` (a PR) → **Review**, owner `reviewer-<ref>`;
   `request` (a client's technical ask) → **Client technical request**, owner `tl-<ref>` (+ its team by NEED);
   `investigation` → **Investigation**, owner `researcher-<ref>`; `reply` (only words) → **Simple reply**, owner
   `writer-<ref>`. No kind and unclear: ask Andrés in the ticket (A/B with a recommendation).
3. `mesa ticket claim <ref>`, write the brief, `mesa team add <ref> --agent <name> --role <role> --owner`, spawn it (§ 2).
   The card's owner chip switches from "Claude · por asignar" to "<name> · En curso" live.

Dispatching never sends anything outward: every Slack, Basecamp or GitHub write is still a salida.

**Batches.** Andrés selects several Hoy items ("Abrir tarea y pasar a Claude") or Tablero cards ("Dárselas a Claude") and
hands them over together. Each card still gets its own `andres_asks` ticket (already open, owned by `lead`), but the lead is
woken ONCE: `ticket.batch { batchId, origin: hoy|tablero|cli, tickets: [{ ticketRef, taskId, title, kind?, urls }] }`, and
there is no `ticket.created` for them. One new ticket is the plain `ticket.created`; nothing new wakes nobody. On `ticket.batch`
the lead, idempotently (a ticket that is closed, i.e. folded, or has a live owner is skipped):

1. Reads every ticket of the batch and its links (`mesa ticket show <ref>`, the `urls`, the card's items).
2. Groups the tickets of the same topic, across sources (Matt's Basecamp ask and Sebas's PR that resolves it are one job)
   into ONE ticket with all the links and one owner: pick the primary (the ticket that names the work: the request over its
   PR) and run `mesa ticket fold <primary> <other>... --why "<one line>"`. The primary gets "Agrupé: t25 «título», … porque
   <why>"; each folded ticket closes with "Agrupado en <primary>: <why>" and no wake; the cards and refs move to the primary.
3. Every ticket that stays alone: `mesa ticket claim <ref>`, then `mesa ticket reply <ref> --body "Agrupé: solo este ítem
   del lote <batchId> porque <why>"` (claim first: a reply on an unclaimed request already turns it into work).
4. Triages each remaining ticket exactly as for `ticket.created` (kind, claim, brief, team, spawn) and spawns ONE owner per
   ticket, in parallel in one message, without waiting for OK. Never ask "¿agrupo?": Andrés corrects afterwards.

Andrés splits by replying in the ticket ("separa t25"): on that `ticket.answered` the lead runs
`mesa ticket unfold <primary> <ref>`; the ticket reopens unclaimed, its card comes back, and the lead gets
`ticket.created { …, splitFrom }` and routes it like any other (a new owner). Grouping is Mesa's bookkeeping only: it
never sends anything outward.

**The card follows the ticket; nobody moves it by hand.** Mesa moves the Tablero card of a ticket with a `taskId` in the
same transaction as every ticket status change (through `tasks.move`, so the Project sync fires): `working` and
`waiting_claude` → En curso, `waiting_andres` → Esperando, `closed` → Hecho. Owners and the lead never run
`mesa task move` for that; a card Andrés drags himself stays where he put it until the ticket's next status change.

**A reply asks only when it says so.** `mesa ticket reply` puts the ticket in "Te espera" only with `--option` or
`--ask`; a plain reply is informational and leaves the status as it is (an unclaimed request becomes "Claude trabaja").

**A finished review ticket closes, and a new push reopens it.** After an approve or a post, with nothing depending on
us, the lead closes the review ticket, open findings included. When the PR gets a new head from its author (not Andrés,
not a bot) Mesa reopens that same ticket by itself, from the GitHub poll or from `mesa review open` at a new head: it
goes to `waiting_claude` and the owner gets `ticket.reopened { ref, repo, pr, oldHead, newHead }`. The new reviewer boots
from `mesa ticket context <ref>`: `reviews[]` has `headSha` (the reviewed head) and `seenHead` (the newest head seen),
and `findings` keeps its state. `mesa ticket reopen <ref> [--reason R]` reopens by hand. In the sandbox,
`mesa sandbox push <ref> [--sha S]` simulates the push (`docs/SANDBOX.md`).

| Template | When | Owner | Team | Ends when |
|---|---|---|---|---|
| **Review** | a PR that needs Andrés's review (`mesa-sweep` gate) or "haz un review pass" | `reviewer-<ref>` | none | his choice is executed (approve or post); then the lead closes the ticket, open findings included, and a new push from the PR author reopens that same ticket (`ticket.reopened`; `mesa ticket reopen` by hand) and brings `reviewer-<ref>-2` |
| **Client technical request** | a client asks for a change (Basecamp, Slack, a forwarded email): "Matt asked for infra" | `tl-<ref>` | `devops-` or `dev-`, then `reviewer-`, then `writer-`; `researcher-` if the cause is unknown | the client reply is sent and Andrés closes it |
| **Internal tooling** | changes to Mesa itself or other dev tools for Andrés (not client code) | `tl-<ref>` | `dev-` only: no separate `reviewer-`, no re-review rounds. The dev runs tsc, the full vitest, test:team and its own Playwright; the tl checks the criteria from the handoff and a quick diff read; nits never block, a bug found later is a new improvement | each change is merged by the lead |
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
5. **"Pídeme permiso"** (his own flow). A classifier denial never reaches the hook unless a `permissions.ask` rule
   matches the call, so no card appears. Every open ticket conversation has a **Pídeme permiso** button next to the
   composer: it posts his message "Pídeme permiso" (marked `kind: permission_request`, referring to the latest Claude
   message) and wakes the ticket's live owner with `ticket.permission_requested { ticketRef, messageId }`. The lead
   relays `ANSWER <ref> permission_requested <message id>` to the live owner, who relays it to the teammate that is
   blocked. Mesa does nothing else: it never edits a settings file, files no card and creates no rule. The agent that
   is blocked:
   1. adds the **narrowest** `permissions.ask` rule for the exact blocked call to the project's
      `.claude/settings.local.json` (your cwd's project root): the tool and the exact command or path, no wildcard,
      never an `allow` rule, never a broader pattern, never a user or `settings.json` file, and only on this wake;
   2. retries that exact call once, so the hook files the ApprovalCard on the ticket, and waits for him;
   3. after his decision (any of the three buttons, a timeout included) removes the ask rule, unless his reply says to
      keep it. A kept rule is named in the handoff.
6. **Only Andrés decides, but nothing proves it yet.** His decisions come from the UI routes `approve`,
   `read-config` and `deny`, which stamp `decidedBy: "andres"`; there is no other decision route, and the hook honours
   a decision only when `decidedBy` is `andres` (anything else is a deny). **Those three routes have no credential:**
   any local process (a node or python script, browser automation, a shell call G10 misses) that POSTs to one is
   stamped `andres` and honoured. Guardrail G10 is partial: it blocks only curl-style shapes with a literal
   `127.0.0.1`, `localhost` or `[::1]` host and port 8790 or 8796, and it is known to miss `"$MESA_URL"` and
   `$env:MESA_URL`, other host spellings (`LOCALHOST`, `127.1`, `2130706433`, `127.0.0.2`, `0.0.0.0`,
   `[0:0:0:0:0:0:0:1]`), `//approve` and `//api` (with `curl -L`), quoted segments, variable splicing (`A=approve`),
   and tool-name disguises (`cu''rl`, `c\url`). G10 and the rule that agents never decide are the only barrier until
   improvement 13 (a credential for Andrés's UI). Security hardening is on hold until he asks.

**The lead's prompts.** They stay in his terminal (the hook passes the main thread through); `MESA_APPROVAL_LEAD=1`
routes them to Mesa too. A lead prompt with no ticket shows in Hoy, Permisos with the same three buttons. While the
lead acts for one ticket it names it with `mesa lead focus <ref>` (stored by Mesa; it lapses 2 h after the last
`mesa lead focus <ref>`, so re-run it to renew; `--clear` or the "Quitar foco" button on Hoy removes it; a closed
ticket counts as none) and the hook files the lead's prompts to that ticket. The lead clears the focus when it moves
to other work. When a card pattern repeats, the lead proposes the allow rule to Andrés as a ticket question; no one
adds an `allow` rule on their own.

## 7. Hooks

Installed by `scripts/install-team.mjs` into `G:/WorkSpace/designli/.claude/settings.json`. Self-test any hook by
piping hook JSON into it; tests: `pnpm test:team` (node:test, mise node 22).

| Event | Script | Rules |
|---|---|---|
| PreToolUse (SendMessage, Bash, PowerShell, Chrome navigate, Slack, Basecamp) | `mesa-guardrails.mjs` (exit 2 blocks) | **G1** Chrome navigate needs a tabId · **G2** no message to a retired agent · **G3** 12-line limit, no acks · **G4** teammates never write to Slack, Basecamp or GitHub; `gh api` is GET-only for everyone · **G5** the lead's Basecamp sends must match a released salida's approved text, and its Slack calls the salida's mode (`slack_send_message_draft` for a draft-mode one, `slack_send_message` for "Claude lo envía", each with the exact text and the salida's `channel_id`/`thread_ts`), its pr-gh.mjs writes need a released github salida for that PR; Mesa down = blocked · **G6** git/gh/tests never in the background (only `mesa wait` and the Mesa server) · **G7** draft PRs only, no bare force push, no skipped hooks, no `gh auth` · **G10** blocks curl-style calls to the approve (and its Slack mode), schedule, deny, undo, "Ya lo envié" and permission-decision routes (partial, see section 6.6) · **G11** sandbox only (`MESA_ENV=sandbox`): no Slack/Basecamp/GitHub write, no `git push`, `mesa salida sent` and `mesa salida drafted` only `--simulated`, no call to :8790 (`docs/SANDBOX.md`) · **G12** a `reviewer`'s `mesa ticket reply` is one line: blocked when the body (heredoc or quoted `--body`) has more than 2 non-empty lines, a `path/file.ext:NN` or a 7-40 hex sha, because the findings are already on the review card (`mesa-review` § Ask); the lead, tl, dev and writer are not affected |
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

- **Messages** (Slack, Basecamp): on `salida.released`, `mesa-salida` § Send (Slack: a draft Andrés sends himself by default, or a direct send when he picked "Aprobar y que Claude lo envíe"; the event's `mode` says which).
- **GitHub** (approve, review comments, thread replies): github salidas, on `salida.released`, `mesa-review` § Lead writes.
- **Other `needs_ok` actions** (move a GitHub Project or Basecamp card, merge, apply infra): after `ticket.plan_approved`, the lead runs exactly
  the approved action (never an id in the wake's `revoked`: Andrés took that pre-approval back and it is `planned` again), marks it with `mesa ticket action <id> --state done|failed`, and tells the owner.

## 9. Install

```
node G:/WorkSpace/designli/ops/scripts/install-team.mjs --dry-run   # the plan
node G:/WorkSpace/designli/ops/scripts/install-team.mjs             # links + hooks + env
node G:/WorkSpace/designli/ops/scripts/install-team.mjs --allow     # also the read-only allow rules
```

It also adds a `statusLine` (`scripts/statusline.mjs`, plan usage in the terminal and in Mesa's rail, `docs/ARCHITECTURE.md` § 13) when the
settings have none; an existing one is never replaced. No agent runs this against `G:/WorkSpace/designli`: Andrés does, then reopens the session.

The sandbox folder (`docs/SANDBOX.md`) installs the same way with
`--target G:/WorkSpace/designli-sandbox --env sandbox`.

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
5. **Two test runners.** The team hooks and scripts use node:test so they run without an install. Vitest covers
   `src` and `bin`; `pnpm test` runs vitest and then `pnpm test:team`.
6. **Who applies infra** (asked to Andrés). devops never applies. Proposed: `apply_infra` is a `needs_ok` plan action the lead runs
   from the devops worktree with the saved plan file after approval, or the repo's CI applies on merge. Andrés decides.
7. **Hook payloads to verify live** (decided): checked once with the checklist in `mesa-start` § 1b, result in
   engram `mesa/setup`.
8. **Addresses** (agreed): the lead is `team-lead`; every Mesa call uses `MESA_SESSION=lead`.
9. **Engram project** (decided): `mesa-start` preflight does a save round trip. If engram cannot resolve
   `G:/WorkSpace/designli`, every engram call passes `project: "designli"` explicitly for the session, and the spawn
   prompts say so.
10. **One engram key per ticket** (agreed): `mesa/<ref>`, shared by Mesa and the agents (upserts).
11. **Tunnel** (t28, decided 2026-11-09: Cloudflare Tunnel + Cloudflare Access; a VPN was tried and dropped because a
    VPN toggle on the phone does not hold): phone access goes through a named cloudflared tunnel on this PC to
    `http://127.0.0.1:8790`, at `MESA_PUBLIC_URL` (https://mesa.<his domain>, a domain in his own Cloudflare account, not
    Designli's). Nothing reaches Mesa without two keys: a Cloudflare Access login for his email only (Access app, 30 d
    session), whose JWT Mesa verifies itself (`MESA_CF_ACCESS_TEAM`, `_AUD`, `_EMAIL`; fails closed), and the
    `MESA_TOKEN` cookie, which the phone gets by scanning the one-time QR on `/telefono` or typing its 8-character code.
    The token is never typed, shown or put in a URL. Mesa never listens beyond `127.0.0.1` unless `MESA_HOST` says so, and
    :8790 is never exposed directly. `pnpm tunnel status` probes the public URL without credentials and must see
    Cloudflare Access answer; if Mesa answers directly it exits 3 and `up` refuses. `pnpm start` brings the tunnel up by itself as a child of the board (after the server listens; reuses a running one; stops if Mesa answers without Access; ends with the board; cloudflared missing is one log line, not a failed start), so after a PC restart `pnpm start` is the only step; `MESA_TUNNEL=off` disables it and `MESA_TUNNEL=on` enables it in `pnpm dev`. mesa-start checks it (`node
    scripts/tunnel.mjs status --json`; exit 3 is a stop). Installing cloudflared, logging in to Cloudflare, creating the
    tunnel, the DNS route and the Windows service, creating the Access app (before the DNS route goes live), and writing
    `.env.local` are `needs_ok` steps done with Andrés; no Cloudflare API token ever lives in the repo. See ARCHITECTURE § 11.
12. **pr-monitor coexistence** (decided): reviewers seed their state from `~/.claude-work/pr-monitor-state.json`,
    read-only, when Mesa has none.
13. **Allow rules** (decided): the `--allow` list stays read-only; the lead reviews it before Andrés runs the
    installer. `gh api repos/*` also matches writes with `-f`; hook G4 blocks those for everyone.
14. **Lead question guard** (decided: skipped): Andrés talks to the lead in chat; teammates ask him only through
    ticket questions.
15. **Sweep state** (resolved): `source_state` and `lastInteractionAt` are on main (PR #3); the local-file fallback
    is gone.
16. **Slack probe query** (agreed). The probe uses one search, `(to:me OR <@U06E2UBDC73>)`. If Slack search does not honour
    `OR` with `to:`, the probe becomes two calls (`to:me`, then the mention) and stays under the same limit.
17. **Sweeper approvals** (agreed). The sweeper has no ticket, so a permission card it raises has `ticketRef: null` and
    must show on Hoy. With `--allow`, its command sheet is fully allowed and it should never raise one.

## 11. Ingest: the sweep

Slack and Basecamp reach Mesa only through Claude's MCP connectors (Andrés, 2026-11-03: no Slack app, no Basecamp
OAuth). GitHub is polled by the Mesa server. The sweeper agent is the periodic ingest; `mesa-sweep` is its
procedure and the lead's on-demand pass.

- **Two stages per tick.** The probe is cheap and runs since the source's watermark (Slack: one call, `(to:me OR
  <@U06E2UBDC73>)` by timestamp; Basecamp: exactly this):

> **Basecamp probe** (every Basecamp tick, two calls):
> 1. `mcp__basecamp__search` with `{query: "Andres", sort: "recency", limit: 3}`. New = hits whose `created_at` is after the probe watermark and not written by Andrés. If all 3 hits are new, repeat the call once with `{query: "Andres", sort: "recency", limit: 10}`. The probe watermark advances to the newest `created_at` seen.
> 2. `mcp__basecamp__get_my_assignments` with `{group: "priorities"}`. New = assignments this instance has not upserted yet.
>
> **Basecamp catch-up** (client comments that do not name him): `mcp__basecamp__get_my_notifications` with no parameters, on this instance's first Basecamp tick and then every `fullScanEveryTicks`-th Basecamp tick. `fullScanEveryTicks` and `scanSince.basecamp` come from the `sweep-tick.mjs wait` output, never from prose. New = notifications with `unread_at` after `scanSince.basecamp` (it falls back to the probe watermark while no catch-up window is stored; null only before the first probe, then all). Its window is kept apart from the probe watermark: the report carries `--scan-since <newest unread_at seen>`.
>
> Ignored projects (`mesa-sweep` § 0b) are dropped from the probe hits and from the catch-up before any `get_by_url`.

  Only when the probe or the catch-up finds something new does the
  triage run (the slack-triage classification, the Basecamp rules), followed by `mesa item upsert` with the dedupe
  key as `externalId` and the watermark advance. A quiet tick writes only `lastChecked` and says nothing.
- **Cadence in config, not prose**: `config/sweep.json` holds work hours, the active interval (60 s), the idle
  interval (300 s) and when it applies (30 quiet minutes), the backoff (base, factor, cap), the probe limit, the
  ticks per instance and the Basecamp catch-up interval (`sources.basecamp.fullScanEveryTicks`). `scripts/sweep-tick.mjs` is the clock: `wait` blocks until a source is due, `report`
  records a tick's outcome. Any new item or any interaction by Andrés snaps the cadence back to 60 s.
- **Barrer ahora** (or `mesa sweep`) emits `sweep.requested` to the Mesa session `sweeper`
  (`MESA_SWEEPER_SESSION`); `sweep-tick.mjs wait` long-polls that session and returns at once with every listed
  source, even outside work hours. `sweep-tick.mjs force [--source s]` does the same by hand.
- **State in Mesa.** `GET /api/sources` and `PATCH /api/sources/:name` (`source_state`: watermark (Basecamp: `<probe>|<scan>`, the catch-up window apart from the probe), lastChecked,
  lastNewAt, backoffUntil, cadenceS, errorCount, lastError, health) plus `lastInteractionAt`, stamped by any UI
  action of Andrés. There is no local fallback: Mesa down means `wait` reports `mesa_down` and the tick waits.
- **Errors.** A 429 or an MCP error backs that source off (60 s, 120 s, … up to 30 min) and sets its health to
  `degraded`, or `down` after `downAfterErrors` consecutive failures that are not rate limits; the rail shows it
  (Estados B). The next good probe sets it back to `ok`, and leaving `down` resumes the salidas held for it.
- **Context.** The sweeper waits in the foreground, so its turn never ends between ticks: no idle notifications
  reach the lead and no tick costs the lead any context. After `maxTicksPerInstance` ticks it sends `DONE` and the
  lead spawns the next one; the watermarks carry over in Mesa.
