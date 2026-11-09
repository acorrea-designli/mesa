# Sandbox

A dummy copy of the board for trying the task → agent flow without touching anything at Designli. It is the same
Mesa (same code, skills, agents and hooks) on its own database, port and Claude folder, with `MESA_ENV=sandbox`:
nothing written there leaves the machine.

| | Live | Sandbox |
|---|---|---|
| Board | `http://127.0.0.1:8790`, `data/mesa.db` | `http://127.0.0.1:8796`, `data/sandbox.db` |
| Claude folder | `G:/WorkSpace/designli` | `G:/WorkSpace/designli-sandbox` (plain folder, not a repo) |
| Env | `MESA_ENV` unset (`live`) | `MESA_ENV=sandbox`, `MESA_URL=http://127.0.0.1:8796`, `MESA_SESSION=lead` |
| Engram project | the ticket's project | `designli-sandbox` on every call |

## Start it

```
pnpm -C G:/WorkSpace/designli/ops sandbox:reset             # copy of the live board (safe while it runs)
pnpm -C G:/WorkSpace/designli/ops sandbox:reset --from seed # or: the sample seed
pnpm -C G:/WorkSpace/designli/ops sandbox                   # http://127.0.0.1:8796
```

Then open Claude Code in `G:/WorkSpace/designli-sandbox` and run `/mesa-start`. Its first line says it is the
sandbox. Use the board at **http://127.0.0.1:8796** (127.0.0.1, not localhost). Every page shows the dashed SANDBOX
band, and the tab title starts with `[sandbox]`.

Reset whenever you want a fresh copy: stop `pnpm sandbox` first (reset refuses while it answers on :8796).

The folder is set up once with the installer (run it again after every pull, like the live one):

```
node G:/WorkSpace/designli/ops/scripts/install-team.mjs --target G:/WorkSpace/designli-sandbox --env sandbox --dry-run
node G:/WorkSpace/designli/ops/scripts/install-team.mjs --target G:/WorkSpace/designli-sandbox --env sandbox
```

`--env sandbox` creates the folder if it is missing. It links the same skills, agents and preamble, and writes
the three env values even if the file had others. It adds `--env sandbox` to every hook command, so the hooks
know they are in the sandbox even if the env does not reach them. It refuses `G:/WorkSpace/designli`.

## `pnpm sandbox:reset`

`scripts/sandbox-reset.ts` → `src/lib/sandbox/reset.ts`.

- **`--from live`** (default; `--source` or `MESA_LIVE_DB` overrides `data/mesa.db`). The live file is opened
  read-only, and `VACUUM INTO` writes a consistent snapshot to a temp file, which is then renamed to
  `data/sandbox.db`. A WAL reader never blocks the live server's writes, and nothing is written to `mesa.db` or
  its `-wal`; tests check the bytes and mtime of both. With the live server stopped, the empty `-wal`/`-shm` the
  reader creates are removed again. The target can never be the source or any file named `mesa.db`.
- **`--from seed`**: the sample seed. Its rows are made ordinary (`is_sample = 0`), because sample salidas can never
  be released or sent, and here the whole board is dummy data anyway.
- **Scrub** (both). It deletes every wake event and session and clears `owner_session`, so the sandbox lead gets
  every wake. Live agents are retired and pending permission cards expire, since their hooks poll the live board.
  Approved salidas, whether in the undo window, released, scheduled or held, go back to `pending`. GitHub Project
  item ids and the `gh_project.*` settings are removed, and every task becomes `local`, so nothing can sync. A
  `sandbox.copy` settings row records the origin, the time, the row counts and what was scrubbed; the band shows
  it.
- Cards handed to Claude keep their task ↔ ticket links (`tasks.ticket_id`, `tickets.task_id`, migration 0500).
  Their `ticket.created` wakes are dropped, and `mesa-start` resumes those open tickets from the state.
  Dispatch works on the sandbox as on the live board: "Dárselo a Claude", batch dispatch and `mesa task
  create|dispatch` create the linked ticket and wake the sandbox lead (`lead`). Nothing goes outward.
- Salidas the live board already sent keep their real permalink. The sandbox refuses to delete or restore them.

## What the server does differently

`src/lib/env.ts` is the only reader of `MESA_ENV`.

| Path | Sandbox |
|---|---|
| GitHub worker (`src/instrumentation.ts`, `githubEnabled`) | never starts, even with `MESA_GITHUB=on`: no notifications polling, no Project push or pull |
| `POST /api/github/sync` | 409 `sandbox` |
| `POST /api/sweep` ("Barrer ahora") | 409 `sandbox`: no `sweep.requested` wake |
| `POST /api/salidas/:id/transition` `sent` | needs `simulated: true` (409 `sandbox` otherwise) and records `sandbox://<source>/<id>`, ignoring any permalink. In live, `simulated` is refused (409 `not_sandbox`) |
| `request_delete` / `deleted` / `request_restore` / `restored` | only on simulated sends |
| `GET /api/health` | `env: "sandbox"` (`"live"` on the real board) |
| `POST /api/sandbox/push` (`mesa sandbox push <ref> [--sha S]`) | exists only here (409 `not_sandbox` in live): records a new head (random 40-hex sha when omitted) for the PR of the review on that ticket and runs `reviews.noteHead`, the function the GitHub poll uses, so a closed review ticket reopens exactly as after a real push (`ticket.reopened { ref, repo, pr, oldHead, newHead }`, its Tablero card back to En curso). The same sha again is a no-op. Gate: `gateSandboxOnly` in `src/lib/domain/sandbox.ts` |

Everything else is unchanged: approve, the 20 s undo, release, schedule, refine turns, tickets, plans, tasks,
reviews, approvals, agents and the salida sweeper (undo windows, schedules, expiry). `src/lib/domain/sandbox.ts`
holds the send rules. A simulated send shows "Simulado · no salió" on the Salidas card, in the queue strip and
in the ticket's salida links.

`pnpm sandbox` (`scripts/sandbox.mjs`) runs `next dev --hostname 127.0.0.1 --port 8796` with `MESA_ENV=sandbox`,
`MESA_DB=data/sandbox.db`, `MESA_GITHUB=off` and `MESA_DIST_DIR=.next-sandbox`. `next.config.ts` reads
`MESA_DIST_DIR`, so its build folder and dev lock do not clash with the live `next dev` in `.next`.

## Guardrails (hook G11)

`scripts/hooks/mesa-guardrails.mjs` applies these in sandbox (`MESA_ENV=sandbox`, or the `--env sandbox`
argument), for the lead and teammates alike. Every message starts "sandbox: nada sale de aquí." and says what to do
instead.

- Every Slack and Basecamp write tool, `slack_send_message_draft` included. The lead "sends" with `mesa salida sent <id> --simulated`, or `mesa salida drafted <id> --simulated` for a Slack salida in mode draft (Mesa records `sandbox://slack/<id>`).
- `pr-gh.mjs approve|review|reply`. Each github salida is reported `--simulated`, and findings get no `ghCommentId`.
- Every `gh` write: `gh api` with a method or fields, and `gh pr create|merge|review|comment|close|…`, `gh issue
  create|comment|…`, `gh repo create|edit|delete|…`, releases, workflows, labels, secrets and Projects. Reads pass.
- `git push`. dev and devops work in local worktrees and branches; the "PR" is the local branch, named in the
  ticket and the handoff (`--branch`).
- `mesa salida sent` without `--simulated`, and any call to the live board on `:8790`.

Live mode is unaffected (tests in `scripts/hooks/test/mesa-guardrails.test.mjs`). G10 also covers the sandbox
board's raw API.

## Skills

Each change is gated on `echo $MESA_ENV` printing `sandbox`:

- `mesa-start`: its first line names the sandbox. It uses the sandbox cwd, port and hooks, the `designli-sandbox`
  engram project, and no sweeper.
- `mesa-salida`, `mesa-review`: `--simulated` instead of the MCP or pr-gh.mjs call.
- `mesa-sweep`: a no-op.
- Spawn preamble rule 16 tells teammates the same.

## Limits

- The sandbox reads the real sources. Its sessions may still read Slack, Basecamp and GitHub through MCP and `gh`
  reads, and the engram panel reads the real engram. Only writes are blocked.
- Other MCP connectors (Gmail, Drive, Calendar, …) are not covered by G11; the team does not use them.
- Restart Claude Code in the sandbox folder after re-running the installer.
