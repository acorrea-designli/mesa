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
  must answer `"env":"sandbox"`; down: ask Andrés to run `pnpm -C G:/WorkSpace/designli/ops sandbox` (never start or
  call the live board on :8790). Hooks: `G:/WorkSpace/designli-sandbox/.claude/settings.json`.
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

The phone tunnel is out of scope for now (phone access comes later); there is no tunnel check.

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
- A `waiting_claude` `andres_asks` ticket with no team at all is a dispatched card whose `ticket.created` was missed:
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

## 5. Route every wake event

| Event | Do |
|---|---|
| `ticket.created` (Andrés asked, or handed a card to Claude) | payload `{ ticketRef, taskId, kind? }`. Idempotent: `MESA ticket show <ticketRef>` and `MESA team list --ticket <ticketRef>`; closed or a live owner already → nothing. Else triage by `kind` (`docs/TEAM.md` § 4): `review` → reviewer, `request` → tl (+team by NEED), `investigation` → researcher, `reply` → writer; no kind: read the ticket and its card's links, and ask Andrés in the ticket only if it stays unclear. Then `MESA ticket claim <ref>`, write the brief, `MESA team add <ref> --agent <name> --role <role> --owner`, spawn the owner. Never send anything outward from this event |
| `ticket.answered` | Read the message by the payload `messageId`, never "the last message" (yours may be newer), plus any other Andrés message after the last one you handled; then `ANSWER <ref> <message id>` to the live owner (no live owner: spawn one), or act on it yourself when you own the ticket |
| `ticket.plan_approved` | `ANSWER <ref> plan_approved` to the owner |
| `ticket.permission_requested` | payload `{ ticketRef, messageId }` ("Pídeme permiso" on the ticket): `ANSWER <ref> permission_requested <messageId>` to the live owner, who relays it to the blocked teammate (`docs/TEAM.md` § 6). Nothing live: leave it, it shows in `ticket context`. Never edit a settings file yourself; for your own prompts use `mesa lead focus <ref>` |
| `ticket.closed` / `ticket.reopened` | `CLOSED <ref>` / `REOPENED <ref>` to the owner (spawn one if needed) |
| `salida.turn` | `ANSWER <ref> salida.turn <salida> <turn>` to the ticket's writer (spawn one if none) |
| `salida.released` | send it now: `mesa-salida` § Send (github salidas: `mesa-review` § Lead writes) |
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
