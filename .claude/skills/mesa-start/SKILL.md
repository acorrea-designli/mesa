---
name: mesa-start
description: Start or rebuild the Mesa lead in this session - preflight (Mesa on :8790, gh account acorrea-designli, an engram write round trip), the mesa wait watcher, the inbox, and respawning the owners of live tickets from their briefs and handoffs. Use at the start of every work session, after every compaction or resume, and when Andrés says "arranca mesa", "mesa start", "empecemos", "levanta el equipo" or "retoma". Lead only; never run it from a teammate.
---

# Mesa start (lead)

You are the lead: Andrés's session, the only agent that talks to him, spawns or retires agents, and sends anything
outward. Nothing you knew before this run counts: rebuild from Mesa and engram. Handbook:
`G:/WorkSpace/designli/ops/docs/TEAM.md` (grep the section you need, never read it whole).

`MESA` = `node G:/WorkSpace/designli/ops/bin/mesa` (Bash tool, bare). `MESA_SESSION=lead` comes from settings `env`;
if `echo $MESA_SESSION` is empty, pass `--session lead` on every call.

**Andrés reads the board, never the CLI.** A ticket opened for him means you need something from him, and when he
needs something from you he opens one himself. So:
- There is no session or log ticket. Routine status (start, phases, the § 6 report, spawns) gets no ticket. Progress
  on a piece of work goes in that work's own ticket. A failure he must act on is a question (next point).
- A question or decision (including `AskUserQuestion`-style choices): never ask it in the terminal. If it belongs to
  one ticket, use `MESA ticket reply <ref>` there. Otherwise, e.g. a batch of tickets or anything about the team or
  protocol, use `MESA ticket ask`. Always give `--option A:… --option B:… --recommend A --why …` and one `--ref tN`
  per ticket involved. Then wait for `ticket.answered`.
- The CLI is only a fallback while Mesa itself is down (preflight § 1). Say there that you will move to the board
  as soon as it is up.

Stop at the first failing check and say which: as a `MESA ticket ask` with the fix options, or in the CLI if Mesa
is down.

**Protocol changes from Andrés.** When Andrés corrects how the team works (in the sandbox or live), write it into
the skill, preamble or doc it belongs to, in `ops/.claude/...` or `ops/docs/...`. Mirror the change into the
sandbox copies under `designli-sandbox/.claude/` and save it in engram (`mesa/protocol/<slug>`). Then put one line in
the ticket where he gave the correction, saying what changed and where. Never leave a correction only in the
conversation.

**Sandbox check first.** Run `echo $MESA_ENV`. If it prints `sandbox`, these replace the steps below (`docs/SANDBOX.md`):

- § 0: `pwd` is `/g/WorkSpace/designli-sandbox`. § 1: Mesa is `curl -s -m 3 http://127.0.0.1:8796/api/health` and
  must answer `"env":"sandbox"`. If it is down, start it yourself; never ask Andrés:
  `rm -rf G:/WorkSpace/designli/ops/.next-sandbox`, then run `"C:/Users/z4yross/AppData/Local/pnpm/nodejs/22.23.2/node.exe"
  scripts/sandbox.mjs` from `G:/WorkSpace/designli/ops` with `run_in_background`. Node 22.0.0 lacks node:sqlite.
  Poll health until it answers. Never start two copies: a second instance corrupts the Turbopack cache and makes
  every page reload in a loop. After a merge, restart it the same way (TaskStop the background task, clear the
  cache, start it), warn the live agents first, then re-register and re-arm the watcher. Never start or call the
  live board on :8790. Hooks: `G:/WorkSpace/designli-sandbox/.claude/settings.json`.
- engram: pass `project: "designli-sandbox"` on every call (yours and, through the spawn prompt, every teammate's); the
  session summary key is `session/designli-sandbox-lead`. Skip § 1b.
- § 4: no sweeper (`mesa-sweep` is a no-op here). Sends follow the sandbox notes in `mesa-salida` and `mesa-review`.

## 0. Where you are

`pwd` must print `/g/WorkSpace/designli` (or `G:\WorkSpace\designli`). Anything else: stop, engram writes would fail.
Never list or read other files in this folder; it holds secrets.

## 1. Preflight (all must pass)

| Check | Command | Pass |
|---|---|---|
| Mesa up | `curl -s -m 3 http://127.0.0.1:8790/api/health` | JSON with ok. Down: start it, `pnpm -C G:/WorkSpace/designli/ops start` with `run_in_background` (build first if `.next` is missing: `pnpm -C G:/WorkSpace/designli/ops build` in the foreground), then re-check |
| gh account | `gh api user -q .login` | `acorrea-designli`. Else stop: Andrés fixes `gh auth` (you never run `gh auth`) |
| Hooks wired | `grep -c "mesa-approval.mjs\|mesa-handoff-guard.mjs\|mesa-guardrails.mjs" G:/WorkSpace/designli/.claude/settings.json` | 3 or more. Else: ask Andrés to run `node G:/WorkSpace/designli/ops/scripts/install-team.mjs` |
| engram | `mem_current_project`, then `mem_context` | project resolves from this cwd; read the last `session/mesa-lead` summary and its open items |
| engram write | `mem_save` with topic_key `mesa/smoke`, content `preflight <ISO time>`, then `mem_search mesa/smoke` | the save succeeds and the search returns this time. The MCP has no delete tool, so the smoke record is one upserted observation that each preflight overwrites. "host session registration could not be confirmed" or an unresolved project: pass `project: "designli"` on **every** engram call this session (yours and, through the spawn prompt, every teammate's) and retry once; failing again is a stop |

The tunnel now comes up with Mesa: `pnpm start` (`scripts/serve.mjs`) starts cloudflared as its child once the board listens (when `MESA_PUBLIC_URL` and `MESA_CF_TUNNEL` are set), reuses a running one and stops it with the board, so there is no separate `pnpm tunnel up` after a restart. Look for its `tunnel:` log line when the board starts.

Tunnel check (informational; it never blocks the start, except exit 3): `node G:/WorkSpace/designli/ops/scripts/tunnel.mjs status --json`
prints `{ installed, hostname, tunnel, service, pid, probe }` (cloudflared, tunnel connections, Windows service, and the
unauthenticated probe of the public URL). Exit **3** (`probe: "mesa"`) is a stop: https://<host>/ answers from Mesa without
Cloudflare Access in front, so tell Andrés now and do not continue until the Access app exists or the tunnel is stopped
(`pnpm tunnel down`) with him. Exit 0 is healthy (`probe: "access"`). Exit 1 (cloudflared missing, tunnel not connected,
`MESA_PUBLIC_URL` unset, probe unreachable) is a one-line note in your first message when he expects the phone to work
("el túnel no está arriba: reinicia Mesa con `pnpm start` o corre `pnpm tunnel up`, te pide OK"). You never install cloudflared, log in to Cloudflare, create the
tunnel or the Access app, run `pnpm tunnel up`, or edit `.env.local` without his OK.

## 1b. First run with this team (once, then mark it done in engram `mesa/setup`)

Confirm the hooks see teammates the way they were built for (`docs/TEAM.md` § 10, point 7):

- [ ] Spawn one throwaway `researcher-<ref>` on a test ticket and have it run a command outside the allow rules
      (e.g. `whoami`). A card must appear **inside that ticket** with the agent's name (PermissionRequest fires for
      in-process teammates and the hook resolved its name). Press Denegar.
- [ ] Let it try to stop without a handoff: the Stop hook must refuse once with rule 6 (H1). Then it writes the
      handoff and stops.
- [ ] Have it SendMessage a retired name (retire a dummy first): G2 must block it.
- [ ] Close the test ticket, retire the researcher, and `mem_save` topic `mesa/setup` with what passed. If a check
      fails, write the observed hook input shape into that observation and tell Andrés in one line.

## 2. Register and watch

1. `MESA session --label lead --project designli`
2. Load `Monitor` (ToolSearch `select:Monitor`) and start the watcher, `persistent: true`, description
   `mesa wait (lead)`, command:
   `"C:/Users/z4yross/AppData/Local/mise/installs/node/22.23.2/node.exe" G:/WorkSpace/designli/ops/bin/mesa wait --loop --session lead --timeout 25`
   Each stdout line is one wake event. If Monitor is unavailable, run `MESA wait --session lead --timeout 25` with
   `run_in_background` and restart it every time it returns.

## 3. Read the state

```
node G:/WorkSpace/designli/ops/bin/mesa ticket list --open
node G:/WorkSpace/designli/ops/bin/mesa salida list --status pending,scheduled,sending
node G:/WorkSpace/designli/ops/bin/mesa team list --status live
```

- A salida in `sending` that is released and not sent: send it now (`mesa-salida` § Send). One that is not released
  yet: leave it, the watcher will deliver `salida.released`.
- An answered ticket nobody acted on (`waiting_claude`): it gets an owner in step 4.
- A `waiting_claude` `andres_asks` ticket with no team at all is a dispatched card whose `ticket.created` (or `ticket.batch`) was missed:
  handle it as that event (§ 5).

## 4. Resume live tickets and start the sweeper

Agents from an earlier session are gone; Mesa still lists them as live. For each live agent:
`MESA team retire <name> --reason session-ended`.

Then the sweeper, the Slack and Basecamp ingest (`mesa-sweep` § 0): spawn `sweeper-<n>` (next free number in
`MESA team list --status retired`) with `subagent_type: sweeper`, `run_in_background: true`, prompt
``You are `sweeper-<n>`. Read .claude/mesa/spawn-preamble.md, then start your loop.``. It runs on its own and speaks
only when done or blocked. On `DONE sweeper-<n>`, retire it and spawn `sweeper-<n+1>` while it is still work hours.

Owners: for each open ticket that needs work, spawn ONLY its owner
(`docs/TEAM.md` § 2) with the next free name (`tl-t14` was live, so the new one is `tl-t14-2`). The owner boots
from the brief and the handoffs and asks for its teammates again with NEED. Do not respawn teammates yourself.

Review pass (Andrés, 2026-11-09: "tienes que spawnear un reviewer por tarea en paralelo"): every start runs
`mesa-sweep` § 1 and then `mesa-review` § Spawning for each PR that passes the gate. That is one ticket and one
`reviewer-<ref>` per PR, all spawned in parallel in one message, up to 5 working (TEAM.md § 2). The rest wait as
`+N en cola`, and each one starts when a reviewer reports READY or DONE. One review card handed from the board is never
the whole pass, and one reviewer never takes a second PR. With PR intake on (`autoDispatch`, TEAM.md § 4) every review
request the server saw already has its ticket and a `ticket.created`/`ticket.batch` waiting: route those (§ 5) and run
Spawning only for what § 1's gate adds beyond plain requests. The same 5-working cap applies to auto-dispatched PRs.

## 5. Route every wake event

| Event | Do |
|---|---|
| `ticket.created` (Andrés asked, handed a card to Claude, or PR intake opened a review ticket on its own) | payload `{ ticketRef, taskId, kind? }`. Idempotent: `MESA ticket show <ticketRef>` and `MESA team list --ticket <ticketRef>`; closed or a live owner already → nothing. Else triage by `kind` (`docs/TEAM.md` § 4): `review` → reviewer, `request` → tl (+team by NEED), `investigation` → researcher, `reply` → writer; no kind: read the ticket and its card's links, and ask Andrés in the ticket only if it stays unclear. Then `MESA ticket claim <ref>`, write the brief, `MESA team add <ref> --agent <name> --role <role> --owner`, spawn the owner. Never send anything outward from this event |
| `ticket.batch` (Andrés handed 2+ cards to Claude at once: Hoy "Abrir tarea y pasar a Claude", Tablero "Dárselas a Claude"; or `origin: github`, 2+ review requests in one GitHub sync) | payload `{ batchId, origin, tickets: [{ ticketRef, taskId, title, kind?, urls }] }`. Those tickets are already open and have NO `ticket.created`. Idempotent: `MESA ticket show <ref>` each one; skip any closed (folded) or with a live owner in `MESA team list --ticket <ref>`. Read every remaining ticket and its links, then group same-topic tickets across sources (Matt's Basecamp ask + Sebas's PR that resolves it): pick the primary (the one that names the work) and `MESA ticket fold <primary> <others> --why "<one line>"` (cards and refs move to the primary, which gets "Agrupé: … porque …"; the folded ones close with no wake). Each ticket left alone: `MESA ticket claim <ref>` first, then `MESA ticket reply <ref> --body "Agrupé: solo este ítem del lote <batchId> porque <why>"` (a reply before the claim turns it into work and the claim then fails). Then triage each remaining ticket as `ticket.created` (kind, claim, brief, `team add --owner`) and spawn ONE owner per ticket, in parallel in one message, without waiting for OK. Andrés splits by replying in a ticket ("separa t25"): on that `ticket.answered` run `MESA ticket unfold <primary> <ref>`; the `ticket.created` with `splitFrom` that follows is routed as usual. Never send anything outward from this event |
| `ticket.pr_message` (PR intake: a Slack message about the ticket's PR; Mesa does not judge it) | payload `{ ticketRef, messageId, itemId, repo, pr, who, url, channelId, ts, threadTs }`. Idempotent: `MESA ticket show <ticketRef>` and `MESA team list --ticket <ticketRef>`; a live `writer-<ref>` already → `ANSWER <ref> pr_message <itemId> <messageId>` to it, nothing else. Else `MESA team add <ref> --agent writer-<ref>[-k] --role writer` (not owner when a reviewer owns it) and spawn it (Opus) with the task "classify <who>'s Slack message <url> (item <itemId>, message <messageId>) about <repo>#<pr>, `writer.md` § PR messages: a notice → `MESA item pr-notice <itemId>`; a question (when in doubt) → `MESA salida propose` to channel `channelId`, thread `threadTs`, on this ticket". One writer per ticket; it does not count toward the 5 working reviewers. The Hoy item leaves on the notice verdict, or when that salida is sent or denied. Never send anything outward from this event |
| `ticket.answered` | payload `{ messageId, chosen, answers: [{ questionId, n, chosen, label, text }], openLeft }`. Read the message by the payload `messageId`, never "the last message" (yours may be newer), plus any other Andrés message after the last one you handled; then `ANSWER <ref> <message id> <answers inline, e.g. 1B "Mañana 09:00" · 3 "sus palabras"> openLeft <k>` to the live owner (no live owner: spawn one), or act on it yourself when you own the ticket. `openLeft > 0`: he answered part of a card; the rest stays open, nobody asks it again |
| `ticket.checklist` | payload `{ ref, ticketRef, messageId, stepId, n, done, doneCount, total, allDone }` (Andrés ticked or unticked step `n` of a checklist; Claude's own marks never wake). Relay `ANSWER <ref> checklist <n> done|open <doneCount>/<total>` to the live owner (`allDone` true: add `all`; no live owner: spawn one), or act on it yourself when you own the ticket. Several ticks of one ticket already waiting in the same batch: relay only the newest one. The owner re-reads `MESA ticket context <ref>` (`checklists`) for the states; it never re-asks a step he ticked |
| `ticket.annotations` | payload `{ ref, ticketRef, attachmentId, annotationIds, count }` (Andrés pressed "Enviar a Claude (n)" in the PDF review view: the marks on one PDF he had not sent yet, in ONE wake). Relay `ANSWER <ref> annotations <attachmentId> <count>` to the live owner (none live: spawn one), or act on it yourself when you own the ticket. The owner reads `MESA ticket annotations <ref> --att <attachmentId> --open` and answers each mark with `MESA ticket annotation-reply <ref> <annId> --body -` (he sees the replies live in the panel; a reply is not a salida). Several of these for one PDF waiting in the same batch: relay only the newest. Nothing goes outward from this event |
| `ticket.plan_approved` | relay by payload `{ ref, approved?, revoked?, partial }` to the owner, ids space-separated: `revoked` present -> `ANSWER <ref> plan_revoked <ids>` (those steps are planned again and must not run); `partial: true` with `approved` -> `ANSWER <ref> plan_approved partial <ids>`; otherwise (full) `ANSWER <ref> plan_approved`. The owner re-reads the action states |
| `ticket.permission_requested` | payload `{ ticketRef, messageId }` ("Pídeme permiso" on the ticket): `ANSWER <ref> permission_requested <messageId>` to the live owner, who relays it to the blocked teammate (`docs/TEAM.md` § 6). Nothing live: leave it, it shows in `ticket context`. Never edit a settings file yourself; for your own prompts use `mesa lead focus <ref>` |
| `ticket.closed` / `ticket.reopened` | `CLOSED <ref>` / `REOPENED <ref>` to the owner (spawn one if needed) |
| `ticket.resumed` (a paused or ongoing ticket came back to Claude: Andrés pressed "Reanudar", or the ticket it was paused until closed) | payload `{ ref, ticketRef, by: "andres"|"dependency", dependencyRef? }`. Idempotent: `MESA ticket show <ref>` (skip it if it is no longer `waiting_claude`). `RESUMED <ref> by <by> [after <dependencyRef>]` to the live owner; none live: spawn one from the brief and the latest handoff (`MESA ticket context <ref>`). Claude's own `mesa ticket resume` sends no wake |
| `salida.turn` | `ANSWER <ref> salida.turn <salida> <turn>` to the ticket's writer (spawn one if none) |
| `salida.released` | send it now: `mesa-salida` § Send (Slack: by the payload's `mode`, a draft or a direct send; github salidas: `mesa-review` § Lead writes) |
| `salida.undone` / `salida.denied` | tell the writer; denied: the writer wraps up |
| `salida.delete_requested` / `salida.restore_requested` | `mesa-salida` § Delete |
| `salida.queued` | nothing: approved while its source is down; it comes back as `salida.released` with `recheckThread` |
| `review.action` | `ANSWER <ref> review.action <action> <findingNs> <salidaIds>` to the reviewer (spawn one if none); approve and post salidas arrive as `salida.released` 20 s later |
| `sweep.requested` | never reaches you: "Barrer ahora" wakes the session `sweeper` directly. If Andrés says it did nothing, check `MESA team list --status live` has a sweeper and spawn one (§ 4) |
| `task.moved` | nothing (the server syncs the GitHub Project) |

**Tickets and Tablero cards move together** (Andrés: "todo está relacionado"). Every ticket with a `taskId` has a
card. Whenever you change the ticket, move its card in the same step with `MESA task move <taskId> <station>`:
claim or work started → `doing`; waiting on Andrés → `waiting`; closed (Done) → `done`; reopened → `doing`. This
applies until t10 improvement 8 makes the server do it. After any batch of closes, check `MESA task list`
against `MESA ticket list --open`.

Relay: when the Agent tool spawns without a named team, names do not resolve, so teammates send to `main` with
`TO <name>:` as the first line (preamble rule 17). Keep a name → agentId map in
`<scratchpad>/lead/agents.json`, filled at every spawn, and forward the message as is to that agentId. Spawn
prompts still say "report to <owner name>".

Teammate messages (`docs/TEAM.md` § Messages): `NEED` → spawn (TEAM.md § 2), `DONE` → retire (§ 2), `BLOCKED` →
a ticket question for Andrés if only he can unblock it, `HANDOFF` → write it to Mesa for the agent once Mesa is back.
A `needs_ok` action approved in a plan (move a card, merge, apply) is yours to run: TEAM.md § 8.

## 6. Report

No report ticket: the board already shows open tickets, salidas por firmar and live agents. Anything that failed
and needs Andrés becomes a `MESA ticket ask`. Then idle.
Every 2 hours of a long session, or when the context passes ~150k, write the session summary (`mesa-end` § 3)
without ending, so a compaction loses nothing.
