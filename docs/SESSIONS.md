# Claude sessions and the `mesa` CLI

How a Claude Code session works with Mesa: it registers, asks Andrés, waits, sends approved salidas, and keeps its memory in engram. The team skills (`.claude/skills/mesa-*`) follow this guide; read `docs/TEAM.md` for roles and `docs/ARCHITECTURE.md` §9 for the wake protocol.

## Install and environment

`bin/mesa` is a zero-dependency Node script (Node 22.13 or newer).

| Shell | Command |
| --- | --- |
| Git Bash (the Bash tool) | `node G:/WorkSpace/designli/ops/bin/mesa <command>` |
| PowerShell / cmd | `G:\WorkSpace\designli\ops\bin\mesa.cmd <command>` |
| On PATH (optional) | add `G:\WorkSpace\designli\ops\bin` to PATH, then `mesa <command>` from cmd or PowerShell |

Git Bash notes:
- Use forward slashes in paths. Quote JSON with single quotes: `--dest '{"kind":"slack_thread",...}'`.
- Pass bodies on stdin with a quoted heredoc so `$` and backticks stay literal: `--body - <<'EOF' … EOF`.
- MSYS rewrites arguments that look like paths (`/api/...`). The CLI never takes one, but if you call `curl` by hand, set `MSYS_NO_PATHCONV=1`.

Environment:

| Variable | Meaning |
| --- | --- |
| `MESA_URL` | Board URL, default `http://127.0.0.1:8790`. |
| `MESA_SESSION` | This session's id. The lead uses `lead`; the sweeper uses `sweeper`. Required for `wait`, `ack`, `ticket ask`, `salida propose`. |
| `MESA_AGENT`, `MESA_TICKET` | Set by the lead on ephemeral agents (`dev-t17`, `t17`). |
| `MESA_TOKEN` | Only when `MESA_URL` is not localhost. |

Output is JSON on stdout whenever `MESA_SESSION` is set, `--json` is passed or stdout is not a terminal. In a terminal without a session it prints a short summary (`--human` forces it). Errors go to stderr: exit 1 for API or network errors, 2 for usage, 3 when a `--wait` ends without the outcome it waited for.

## 1. Register

```
MESA_SESSION=lead node bin/mesa session --label "Andrés · lead" --project mesa
```

Unknown owner ids are also registered on first use. A new session starts at the latest wake cursor, so it never replays old events.

## 2. Wait for wakes

```
node bin/mesa wait --loop --timeout 25          # background watcher: one JSON line per event
node bin/mesa wait                              # foreground: first batch, then exit
```

- **Delivery is at least once.** `mesa wait` prints a batch, then acks it. A session that crashes after the ack loses nothing that matters because every handler re-reads the state first. With `--manual-ack` the CLI prints and exits without acking; ack with `mesa ack <id>` after handling. Each event's `id` is its cursor.
- **Handlers are idempotent.** An event is a hint, the state is the truth. Before acting, read the entity (`mesa ticket show`, `mesa salida show`) and skip if the work is already done (the ticket already has your reply, the salida is already `sent`).
- Wake events are kept for 7 days.

Kinds and what to do: `ARCHITECTURE.md` §9.

## 3. Ask Andrés

```
node bin/mesa ticket ask --title "¿Bucket nuevo o reusar?" --option "A:Bucket nuevo" --option "B:Reusar dre-staging-docs" \
  --recommend A --why "aísla datos de prueba" --project dre --body - <<'EOF'
Contexto en dos líneas.
EOF
```

Add `--wait` to block until he answers (it prints `{ ticket, answer: { body, chosen, answers, at } }`, `answers` one `{ questionId, n, chosen, text }` per question his message answered), with `--timeout S` to give up (exit 3). `--wait` polls in peek mode: it never acks, so the lead's own `mesa wait` still receives `ticket.answered`.

`--option` makes a 1-step question card. Several decisions go in ONE card of up to 6 questions (2-6 options each, keys A-F) on an existing ticket:

```
node bin/mesa ticket questions t14 --json - <<'EOF'
{"body": "Dos decisiones antes del deploy.",
 "questions": [
  {"text": "¿Cuándo?", "options": [{"key": "A", "label": "Hoy"}, {"key": "B", "label": "Mañana"}], "recommend": "B", "why": "entra el fix"},
  {"text": "¿Quién avisa?", "options": [{"key": "A", "label": "Yo"}, {"key": "B", "label": "Tú"}], "recommend": "A", "why": "lo pidió por escrito"}
 ]}
EOF
```

Each question stays open until he answers it (a click, his own words, or typed `1A 2B`) or you withdraw it with `mesa ticket question withdraw <tq id> --why "<reason>"`; he may answer part of the card, and `ticket.answered` says how many stay open (`openLeft`). One open card per ticket at a time (`mesa-ticket` § Asking).

Reply on an existing ticket with `mesa ticket reply <ref> --body -`, post a plan with `mesa ticket plan <ref> --action "kind:source:direct|needs_ok:label"`.

## 4. Propose a salida and send it only after release

Nothing leaves without Andrés's approval of the exact text and destination.

```
node bin/mesa salida propose --source slack --ticket t12 --title "Respuesta a Ana" \
  --dest '{"kind":"slack_thread","workspace":"designli","channel":"#dre","channelId":"C0123","threadTs":"1730650000.0001","postAs":"Andrés"}' \
  --body - --wait-release <<'EOF'
Texto exacto.
EOF
```

- New versions after a refine turn: `mesa salida version <id> --turn <turnId> --body -`.
- `--wait-release` blocks until the salida is released (exit 0, prints the salida) or denied, expired or deleted (exit 3: do not send). Without it, wait for `salida.released` from `mesa wait`.
- On release: `mesa salida show <id>`; if `recheckThread` is set, re-read the thread and `mesa salida bounce <id> --reason …` when it changed. Send exactly `versions[approvedVersion - 1].body` to exactly `destination`, then `mesa salida sent <id> --permalink <url>` or `mesa salida failed <id> --error …`. A Slack salida follows the event's `mode`: `draft` = `slack_send_message_draft` then `mesa salida drafted <id>` (Andrés sends it himself and closes it with "Ya lo envié"), `send` = `slack_send_message` then `sent`; a failed draft call is `hold` with a clear reason, never a direct send. If the source is down: `mesa salida hold <id> --reason …` and `mesa source set <source> --health down`.
- There is no approve (so no Slack mode), schedule, deny, undo or "Ya lo envié" in the CLI. Those are Andrés's buttons.

## 5. Keep the thread in engram

Save the conversation and decisions after every milestone with the engram MCP (`mem_save`, `topic_key: "mesa/<ref>"`, project = the ticket's project), then link the observation:

```
node bin/mesa engram link --entity ticket:<ticketId> --project <project> --topic mesa/<ref> --obs <observationId>
```

Mesa only reads engram (`GET /api/engram/search`, the memory panel). It never writes to it.

## 6. Agents: brief and handoff

```
node bin/mesa ticket context t17                       # start here
node bin/mesa ticket brief t17 --goal … --step … --next … --question …
node bin/mesa handoff t17 --agent dev-t17 --status paused --body - --branch feat/x --pr 42
```

## 7. GitHub and sources

- `mesa github sync` runs the server-side pass now: notifications (conditional), review requests, Project push and pull. `mesa github status` shows the Project ids and health.
- `mesa source get|set` reads and writes the sweep state (`watermark`, `--checked`, `--new`, `--health`, `--cadence`, `--backoff-until`, `--error-count`, `--last-error`). The sweeper normally does this through `scripts/sweep-tick.mjs`.

## Round trip from a second terminal

```
# terminal 1: the board
MESA_DB=data/try.db pnpm exec next dev --hostname 127.0.0.1 --port 8793
# terminal 2: a session
export MESA_URL=http://127.0.0.1:8793 MESA_SESSION=lead
node bin/mesa ticket ask --title "¿Seguimos?" --option "A:Sí" --option "B:No" --wait
# answer in the UI (Tickets) → terminal 2 prints the answer
node bin/mesa ticket questions <ref> --json - < card.json
# answer one step of the card in the UI, then the rest → one ticket.answered per message, openLeft 1 then 0
node bin/mesa salida propose --source slack --dest '{"kind":"slack_channel","workspace":"designli","channel":"#pruebas","postAs":"Andrés"}' --body "hola" --wait-release
# approve in Salidas, wait 20 s → terminal 2 prints the released salida
node bin/mesa salida sent <id> --permalink https://example.com
```
