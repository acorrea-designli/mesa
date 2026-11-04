---
name: mesa-end
description: Wind down the Mesa team at the end of a work session - every live agent writes its handoff, the lead writes the session summary to engram, agents are retired in Mesa and stopped, finished worktrees are removed. Use when Andrés says "cerramos", "fin del día", "mesa end", "apaga el equipo", "wind down", before a planned restart, or when the lead's context is about to be compacted. Lead only.
---

# Mesa end (lead)

Goal: the next `/mesa-start` rebuilds everything from Mesa and engram, with nothing lost in a context window.
`MESA` = `node G:/WorkSpace/designli/ops/bin/mesa`.

## 1. Handoffs

`MESA team list --status live`. Send each live agent one line: `HANDOFF-NOW <ref>: write your handoff (status
paused unless done) and reply DONE or PAUSED`. Wait for every reply (an idle agent wakes on the message). An agent
that does not answer within 5 minutes: write its handoff yourself from what you know, with `--agent <its name>` and
`--status paused`, and say so in the summary.

Salidas: none may be left mid-send. `MESA salida list --status sending`: a released one is sent now
(`mesa-salida` § Send); one inside its undo window finishes on its own in 20 s, so wait for it. Pending and
scheduled salidas stay; the sweeper releases scheduled ones and the next session sends them.

## 2. Retire

For each agent: `MESA team retire <name> --reason session-end`, then `TaskStop` on it. Retired names are never
reused or messaged (hook G2); the next session spawns `<role>-<ref>-<k+1>`.

Worktrees: for each `G:/WorkSpace/designli-wt/<name>` whose PR is merged or closed (`gh api repos/<repo>/pulls/<n>
-q .state`), `git -C <repo> worktree remove G:/WorkSpace/designli-wt/<name>`. Keep the others; their handoffs name
them.

## 3. Session summary (engram)

`mem_save` with topic_key `session/mesa-lead` (upsert, type `session`, English):

- open tickets: ref, title, owner role, state, the next step from its handoff;
- salidas pending or scheduled;
- decisions Andrés made today that are not yet in a `mesa/<ref>` record (then upsert those records);
- anything that failed or needs him first thing (a hook denial pattern, a gh or tunnel problem);
- the time of the last sweep.

Then `mem_session_summary`. Sweep pending engram judgments (`mem_judge`) the teammates left; agents never judge.

## 4. Tell Andrés

One line in Spanish: tickets abiertos N, salidas por firmar N, agentes retirados N, anything that needs him.
Stop the `mesa wait` watcher last (`TaskStop` on the Monitor).
