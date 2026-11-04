---
name: mesa-start
description: Start or rebuild the Mesa lead in this session - preflight (Mesa on :8790, gh account acorrea-designli, engram, tunnel), the mesa wait watcher, the inbox, and respawning the owners of live tickets from their briefs and handoffs. Use at the start of every work session, after every compaction or resume, and when Andrés says "arranca mesa", "mesa start", "empecemos", "levanta el equipo" or "retoma". Lead only; never run it from a teammate.
---

# Mesa start (lead)

You are the lead: Andrés's session, the only agent that talks to him, spawns or retires agents, and sends anything
outward. Nothing you knew before this run counts: rebuild from Mesa and engram. Handbook:
`G:/WorkSpace/designli/ops/docs/TEAM.md` (grep the section you need, never read it whole).

`MESA` = `node G:/WorkSpace/designli/ops/bin/mesa` (Bash tool, bare). `MESA_SESSION=lead` comes from settings `env`;
if `echo $MESA_SESSION` is empty, pass `--session lead` on every call.

Say one line to Andrés before you start and one line per phase. Stop at the first failing check and say which.

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
| Tunnel | the `tunnel` field of the health JSON | reachable URL. Down is a warning, not a stop: the phone cannot sign until it is back (tell Andrés) |

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
| `ticket.created` (Andrés asked) | classify it (`docs/TEAM.md` § 4), `MESA ticket claim <ref>`, write the brief, spawn the owner |
| `ticket.answered` | `ANSWER <ref> <message id>` to the live owner; no live owner: spawn one |
| `ticket.plan_approved` | `ANSWER <ref> plan_approved` to the owner |
| `ticket.closed` / `ticket.reopened` | `CLOSED <ref>` / `REOPENED <ref>` to the owner (spawn one if needed) |
| `salida.turn` | `ANSWER <ref> salida.turn <salida> <turn>` to the ticket's writer (spawn one if none) |
| `salida.released` | send it now: `mesa-salida` § Send (github salidas: `mesa-review` § Lead writes) |
| `salida.undone` / `salida.denied` | tell the writer; denied: the writer wraps up |
| `salida.delete_requested` / `salida.restore_requested` | `mesa-salida` § Delete |
| `salida.queued` | nothing: approved while its source is down; it comes back as `salida.released` with `recheckThread` |
| `review.action` | `ANSWER <ref> review.action <action> <findingNs> <salidaIds>` to the reviewer (spawn one if none); approve and post salidas arrive as `salida.released` 20 s later |
| `sweep.requested` ("Barrer ahora") | `node G:/WorkSpace/designli/ops/scripts/sweep-tick.mjs force` (add `--source <s>` per listed source); the sweeper wakes within 5 s. No sweeper alive: spawn one, or run `mesa-sweep` on demand for GitHub |
| `task.moved` | nothing (the server syncs the GitHub Project) |

Teammate messages (`docs/TEAM.md` § Messages): `NEED` → spawn (TEAM.md § 2), `DONE` → retire (§ 2), `BLOCKED` →
a ticket question for Andrés if only he can unblock it, `HANDOFF` → write it to Mesa for the agent once Mesa is back.
A `needs_ok` action approved in a plan (move a card, merge, apply) is yours to run: TEAM.md § 8.

## 6. Report

One line to Andrés in Spanish: open tickets, salidas por firmar, agents spawned, anything that failed. Then idle.
Every 2 hours of a long session, or when the context passes ~150k, write the session summary (`mesa-end` § 3)
without ending, so a compaction loses nothing.
