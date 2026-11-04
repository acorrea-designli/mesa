# Mesa architecture

Mesa is Andrés's personal work-ops board: one place for what waits on him (GitHub PR reviews, Basecamp client requests, Slack replies, Claude's questions), a kanban mirrored to a private GitHub Project, two-way tickets with Claude Code sessions, and an approval queue (Salidas) for every outgoing Slack/Basecamp message.

Product and design sources: `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, `.impeccable/surfaces/src-app-page-tsx.md`, and the approved mocks in `.impeccable/mocks/screens/` (see `docs/TASKS.md` for which variant each screen uses).

## 1. Shape of the system

```
 phone (tunnel + token) ─┐
 desktop browser ────────┼──▶ Next.js app (0.0.0.0:8790) ──▶ SQLite  data/mesa.db
                         │      ├─ RSC pages: / /tablero /tickets /salidas /kit
                         │      ├─ REST API  /api/*
                         │      ├─ long-poll /api/wait  ◀── wake events
                         │      └─ sweeper (1 s): undo windows, schedules, expiry
                         │
 Claude Code sessions ───┴──▶ bin/mesa CLI ──▶ REST API
   (MCP: Slack, Basecamp)        mesa wait ◀── long-poll
   (engram MCP / CLI)
 gh CLI (server side) ──────▶ PR review requests, GitHub Project read/write   [lane C]
 engram CLI (server side) ──▶ read-only memory panel                          [lane C]
```

- **Mesa never talks to Slack or Basecamp.** Those connectors live in Claude sessions as MCP tools. Mesa stores the approval; the owning session executes the send after Mesa releases it.
- **Claude Code sessions are the workers.** They register with an id (`MESA_SESSION`), post tickets/salidas/items through the CLI, and block on `mesa wait` until something they own changes.
- **GitHub is read and written server side** with the `gh` CLI (Andrés's own login): review requests and the GitHub Project mirror.
- **Engram is the primary memory.** Sessions save ticket conversations and decisions to engram (MCP `mem_save`) and record the pointer in Mesa (`engram_links`). Mesa only reads engram (CLI) for the memory panel.

## 2. Modules

| Path | What |
| --- | --- |
| `src/lib/domain/types.ts` | Domain and API response types (client safe). |
| `src/lib/domain/salida-machine.ts` | Pure salida state machine + `dueEvent` for time-driven transitions. |
| `src/lib/domain/ticket-machine.ts` | Pure ticket state machine. |
| `src/lib/db/sqlite.ts` | `node:sqlite` connection, migrations runner, `tx()`. |
| `src/lib/db/util.ts` | ids, row mapping (snake ↔ camel, JSON, booleans), errors. |
| `src/lib/repo/*` | Typed repositories: items, tasks, tickets, salidas, chips, sessions, engram. `createRepos(db)` for tests, `repos()` for the app. |
| `src/lib/wake/wake.ts` | Wake events: persist + in-process emitter + `waitForEvents`. |
| `src/lib/wake/sweeper.ts` | 1 s interval started from `src/instrumentation.ts`. |
| `src/lib/api/*` | Route wrapper (`route()`: sweep, error mapping) and zod request schemas. |
| `src/app/api/**/route.ts` | REST routes (contract below). |
| `src/proxy.ts` | Access guard (local only unless `MESA_TOKEN`). |
| `src/styles/*` | Tokens (both themes + semáforo), base, shared component classes, shell. |
| `src/components/ui`, `line`, `shell` | Shared components (see §8). |
| `src/lib/motion` | motion.dev helpers and hooks (see §8). |
| `bin/mesa` | CLI for sessions. |
| `db/migrations/*.sql` | Schema, applied in order at startup (`schema_migrations`). |

## 3. Data model

All timestamps are ISO-8601 UTC strings. JSON columns are TEXT. Ids are `<prefix>_<12 base36>` (`it_`, `ta_`, `tk_`, `tm_`, `sa_`, `sv_`, `st_`, ...). Tickets also get a short `ref` (`t1`, `t2`, …) used for `@` references.

- **items**: one row per thing waiting on Andrés, unique by `(source, external_id)`. `source` github|slack|basecamp|claude, `kind` (pr_review, request, mention, message, question), `title`, `excerpt`, `project`, `url`, `need` (reply, approve_pr, decision, approve), `station` (inbox|todo|doing|waiting|done), `wait_on` (you|client|claude|none|person:<name>), `tag` (e.g. clean), `task_id`, `meta`, `is_sample`, `received_at`. Hoy draws items.
- **tasks**: kanban cards on Tablero. `source` is the card's lane (Tablero B), `station`, `wait_on`, `position`. GitHub Project mapping: `gh_item_id` (ProjectV2 item node id), `gh_content_url` (draft issue or linked issue/PR), `sync_state` synced|pending|error|local, `sync_error`, `synced_at`. Items link to a task with `items.task_id`; moving a task moves its items. The Project id, number, Status field id and option ids live in `settings` (keys `gh_project.*`, written by lane C). Station ↔ Status option: Inbox, Todo, In Progress, Waiting, Done (`STATION_GH_STATUS`).
- **tickets**: `ref`, `direction` (claude_asks|andres_asks), `title`, `status` (§4), `project` (engram scope), `owner_session` (the session that gets woken), `item_id`, `woke_at`, `closed_at`.
  - **ticket_messages**: `author` andres|claude, `body` (Markdown), `options` (`[{key,label,detail}]` for A/B choices), `recommended` (key), `recommendation` (one line), `chosen` (key Andrés picked).
  - **attachments**: files on a ticket or message; stored under `data/uploads/<ticket id>/`.
  - **ticket_refs**: `@` references: `ref_type` ticket|item|url, `target`, `label`.
  - **planned_actions**: "Claude va a hacer": `seq`, `kind` (cancel_salida, move_card, create_task, review_pr, investigate, send_message, other), `source` (line colour), `label`, `mode` direct|needs_ok, `state` planned|approved|rejected|running|done|failed, `target` JSON. Anything that writes to a client is a salida, never a direct action.
- **salidas**: outgoing messages. `status` (§4), `source` slack|basecamp, `destination` JSON (below), `title`, `context`, `ticket_id` (origin), `links` (`[{source,label,url}]` for the origin strip), `owner_session`, `current_version` (the one shown and sent), `approved_version`, `undo_until`, `released_at`, `send_at`, `expires_at`, `sent_at`, `permalink`, `error`, `delete_requested_at`, `deleted_at`.
  - Destination: `{kind: slack_thread|slack_channel, workspace, channel, channelId?, threadTs?, threadLabel?, postAs}` or `{kind: basecamp_comment|basecamp_campfire|basecamp_message, project, projectId?, recordingId?, recordingTitle?, postAs}`.
  - Delete policy by kind (`DELETE_POLICY`): Slack none (the connector has no delete tool; the undo window is the only way back), Basecamp comment/message trash (recoverable 25 days, can be restored), Campfire permanent.
  - **salida_versions**: immutable, `n` from 1, `author` claude|andres ("tu versión"), `turn_id` (the request it answers), `starred`.
  - **salida_turns**: refine chat. Andrés turns carry `body`, semáforo `marks` (`[{start,end,kind: keep|redo|drop,text}]`, offsets into the version text), `on_version`, `chip_label`; `state` open|answered|cancelled. An open Andrés turn means "Claude reescribiendo…" and blocks approve. Claude's answer is a version plus an automatic short Claude turn (`v4`).
- **learned_chips**: quick chips learned from Andrés's own requests: `label` (1–3 words, given by Claude when it answers a turn with `chipLabel`), `phrasings` (original wordings for "agrupa: …", last 5), `uses`, `last_used_at`. Top 4 by uses then recency. No presets.
- **sessions**: Claude sessions: `id` (chosen by the session), `label`, `cwd`, `project`, `cursor` (last acked wake event), `waiting_since` (inside a long-poll now), `last_seen_at`. Listening = in a long-poll or seen in the last 90 s ("Claude escuchando").
- **wake_events**: `id` (autoincrement, the cursor), `session_id` (target; NULL = any session), `kind`, `entity_type`, `entity_id`, `payload`.
- **engram_links**: `entity_type` ticket|salida|task, `entity_id`, `project`, `topic_key`, `observation_id`.
- **settings**: key/value (ticket ref counter, GitHub Project ids, …).

## 4. State machines

### Salida

```
draft ─propose─▶ pending ─approve(vN)─▶ sending ─(20 s)─ release ─▶ sending·released ─sent─▶ sent ─request_delete─▶ (sent, delete requested) ─deleted─▶ deleted
                  │  ▲ ▲                   │                               │                                                          │
                  │  │ └────── undo ───────┘ (only inside the window)      └─failed─▶ failed ─retry─▶ pending                         ├─request_restore (trash only)
                  │  └──unschedule── scheduled ◀──schedule(at, vN)──┘                                                                └─restored─▶ sent
                  │                     └─(send_at)─ release ─▶ sending·released
                  ├─deny─▶ denied        (also from draft and scheduled)
                  └─expire─▶ expired     (pending past expires_at)
```

Rules (enforced in `transitionSalida`, tested in `salida-machine.test.ts`):
- Approve sends the version shown: `approve.version` must equal `current_version`, and it is refused while a refine turn is open.
- `approve` sets `undo_until = now + 20 s`. `undo` works only before `undo_until` and before release.
- The sweeper releases the salida when the window ends and emits `salida.released` to the owner. **The session only sends after that event.** `sent` and `failed` before release are refused (409).
- `schedule` needs a future time; at `send_at` the sweeper releases it (no extra window: scheduling is the approval).
- `request_delete` follows the destination policy; Slack is refused with a message pointing to the source.
- Versions can be added, selected or edited only in draft/pending.

### Ticket

| Status | UI | Who acts |
| --- | --- | --- |
| `waiting_andres` | Te espera | Andrés |
| `waiting_claude` | Espera a Claude | owner session (woken) |
| `working` | Claude trabaja | owner session |
| `closed` | Cerrado · Reabrir | nobody |

Events: `andres_reply` → waiting_claude (wake `ticket.answered`); `claude_reply` → waiting_andres; `claude_plan(needsOk)` → waiting_andres if any action needs OK, else working; `approve_plan` (only from waiting_andres) → working (wake `ticket.plan_approved`); `claim` (only from waiting_claude) → working, sets owner; `close` → closed (wake `ticket.closed` when Andrés closes); `reopen` (only from closed) → waiting_claude (wake). A new `andres_asks` ticket emits `ticket.created` to its named owner, or to every session when none is named.

## 5. REST API

JSON in and out. Errors: `{ error: { code, message, details? } }` with 400 `invalid_request|invalid_json`, 404 `not_found`, 409 `invalid_transition`, 413 `too_large`, 500 `internal`. Every request first runs the sweep, so state is fresh. Request schemas: `src/lib/api/schemas.ts`. Response types: `src/lib/domain/types.ts`.

| Method & path | Body / query | Response |
| --- | --- | --- |
| GET `/api/health` | | `{ ok, now }` |
| GET `/api/counts` | | `Counts` (rail + stations) |
| GET `/api/items` | `?station=&source=` | `Item[]` |
| POST `/api/items` | `ItemInput` | `Item` 201 |
| POST `/api/items/upsert` | `ItemInput` (by source + externalId) | `{ item, created }` 201/200 |
| GET/PATCH/DELETE `/api/items/:id` | PATCH: `ItemPatch` | `Item` / 204 |
| GET `/api/tasks` | `?station=&source=` | `Task[]` (with `items`) |
| POST `/api/tasks` | `TaskInput` (`itemIds?`) | `Task` 201 |
| GET/PATCH/DELETE `/api/tasks/:id` | PATCH: `TaskPatch` (marks pending) | `Task` / 204 |
| POST `/api/tasks/:id/move` | `{ station, position? }` | `Task` (`syncState: pending` → "Sin sincronizar") |
| POST `/api/tasks/:id/sync` | `{ syncState, ghItemId?, ghContentUrl?, syncError? }` | `Task` |
| POST `/api/tasks/:id/items` | `{ itemIds }` | `Task` |
| GET `/api/tickets` | `?status=&open=1` | `Ticket[]` |
| POST `/api/tickets` | `TicketInput` (first message, options, refs) | `TicketDetail` 201 |
| GET `/api/tickets/:idOrRef` | | `TicketDetail` (messages, attachments, refs, actions, engram) |
| POST `/api/tickets/:id/messages` | `{ author, body?, options?, recommended?, recommendation?, chosen?, refs?, session? }` | `TicketDetail` |
| POST `/api/tickets/:id/plan` | `{ actions: [{kind, source, label, mode, target?}], session? }` | `TicketDetail` |
| POST `/api/tickets/:id/plan/approve` | `{ reject?: actionId[] }` | `TicketDetail` |
| POST `/api/tickets/:id/transition` | `{ event: claim\|close\|reopen, by?, session? }` | `TicketDetail` |
| POST `/api/tickets/:id/attachments` | multipart `file`, `messageId?` (≤ 25 MB) | `Attachment` 201 |
| PATCH `/api/actions/:id` | `{ state }` | `PlannedAction` |
| GET `/api/salidas` | `?status=pending,scheduled` | `Salida[]` |
| POST `/api/salidas` | `SalidaInput` (`body` = v1, `draft?`) | `SalidaDetail` 201 |
| GET `/api/salidas/:id` | | `SalidaDetail` (versions, turns, engram) |
| POST `/api/salidas/:id/versions` | `{ body, author?, turnId?, chipLabel? }` | `SalidaDetail` (new current version) |
| PATCH `/api/salidas/:id/versions/:n` | `{ starred }` | `SalidaDetail` |
| POST `/api/salidas/:id/select` | `{ n }` ("Volver a vN") | `SalidaDetail` |
| POST `/api/salidas/:id/edit` | `{ body }` (manual edit; cancels open turns) | `SalidaDetail` |
| POST `/api/salidas/:id/turns` | `{ body?, marks?, chipLabel? }` | `SalidaDetail` (wake `salida.turn`) |
| POST `/api/salidas/:id/turns/:turnId/cancel` | | `SalidaDetail` |
| POST `/api/salidas/:id/transition` | `SalidaEvent` `{ type, ... }` | `SalidaDetail` |
| GET `/api/chips` | | `LearnedChip[]` (top 4) |
| GET `/api/sessions` | | `(Session & { listening })[]` |
| POST `/api/sessions` | `{ id, label?, cwd?, project? }` | `Session` |
| GET `/api/wait` | `?session=&after=&timeout=` (s, ≤ 55, default 25) | `{ events: WakeEvent[], cursor }` |
| POST `/api/wait/ack` | `{ session, cursor }` | `Session` |
| GET/POST `/api/engram/links` | GET `?entityType=&entityId=`; POST `EngramLinkInput` | `EngramLink[]` / `EngramLink` 201 |
| GET `/api/engram/search` | `?q=&project=&limit=5` | 501 until lane C: `{ status: connected\|offline, observations }` |

Salida transition events accepted over HTTP: `propose`, `approve {version}`, `undo`, `sent {permalink?}`, `failed {error}`, `retry`, `deny`, `schedule {at, version}`, `unschedule`, `request_delete`, `deleted`, `request_restore`, `restored`. `release` and `expire` are internal (sweeper only).

## 6. Wake protocol (long-poll)

1. A session picks an id and exports it: `export MESA_SESSION=<id>` (e.g. the Claude session id or a readable name like `triage-am`). `mesa session --label …` registers it; new sessions start at the current cursor (they do not replay history).
2. The session creates what it owns with its id (`ownerSession`): tickets it asks, salidas it proposes, plans it posts, tickets it claims.
3. It blocks on `mesa wait` (`GET /api/wait?session=<id>`). The server returns as soon as there is an event with `id > cursor` targeted at the session or broadcast (`session_id IS NULL`), or after `timeout` seconds with `[]`. While waiting, the session shows as listening.
4. After handling the events the CLI acks (`POST /api/wait/ack {cursor}`), so delivery is at least once: a crash before the ack replays the batch. Handlers must be idempotent (check the entity's current state with `mesa ticket show` / `mesa salida show` before acting).
5. Event kinds: `ticket.created`, `ticket.answered`, `ticket.plan_approved`, `ticket.closed`, `ticket.reopened`, `salida.turn` (payload `turnId`), `salida.released` (send now, payload `version`), `salida.undone`, `salida.denied`, `salida.delete_requested`, `salida.restore_requested`, `task.moved` (reserved).
6. Sending a salida: on `salida.released`, `mesa salida show <id>`, send `versions[approvedVersion-1].body` to the exact `destination` through the MCP tool, then `mesa salida sent <id> --permalink <url>` or `mesa salida failed <id> --error <msg>`.

Events are kept in SQLite; the in-process emitter only shortens latency. A single `next start` process is assumed (one SQLite writer).

## 7. CLI (`bin/mesa`)

Zero-dependency Node script over the REST API. Env: `MESA_URL` (default `http://127.0.0.1:8790`), `MESA_SESSION`, `MESA_TOKEN` (only for non-local URLs). JSON on stdout, errors on stderr with exit 1 (usage: exit 2). `--body -` reads stdin. Run `node bin/mesa help` for the full list:

```
mesa session [--label L] [--project P]
mesa wait [--timeout S] [--loop]
mesa ticket ask|reply|plan|claim|close|action|show|list
mesa salida propose|version|sent|failed|deleted|restored|show|list
mesa item upsert --json JSON
mesa engram link --entity ticket:<id> --project P [--topic KEY] [--obs ID]
```

On Windows `bin/mesa.cmd` forwards to the same script. Lane C owns its ergonomics (aliases, nicer output, `--wait` on ask, PATH install).

## 8. Design system in code

- `src/styles/tokens.css`: every DESIGN.md token as a CSS custom property, Tokio on `:root`, Grafito on `[data-theme="dark"]`, plus semáforo `--keep-*`, `--redo-*`, `--drop-*`, `--shade`, radii, spacing, layout widths. Token names match the mocks (`--gnd`, `--raise`, `--gh`, …) so mock CSS ports unchanged; the header maps them to DESIGN.md names.
- `src/styles/components.css`: the shared classes from the mocks (`.btn`, `.ap3` split approve, `.chip`, `.lk`, `.st`, `.kind`, `.k`, `.ln`, `.ring`, `.s-*`/`.sv-*` SVG line classes, `.tabs`/`.tab`, `.ctx`, `.msg` with the top line stub, `mark.m-keep|m-redo|m-drop`, `.alert`, `.sheet`, `.toast`). Source colour is set with `.src-<source>` (sets `--c`, `--t`, `--ci`).
- `src/components/ui/primitives.tsx`: `Btn`, `Chip`, `LinkChip`, `StatusTag`, `Kind`, `Label`, `ContextQuote`, `ExactText`, `Alert`.
- `src/components/ui/interactive.tsx` (client): `SplitApprove` (Enviar en 20 s / Programar…), `Tabs`, `Sheet`, `ToastProvider` + `useToast`, `ThemeToggle` (+ `THEME_BOOT` inline script, no flash).
- `src/components/line/Line.tsx`: `SourceDot`, `LineStub`, `Ring`, `Interchange`, `DirectionMarker`, `BrokenLine`, `BrandMark`.
- `src/components/shell/*`: `AppShell` (rail + work area; phone tab bar at ≤ 720px), `Rail` (counts, source health notice slot for Estados B, theme toggle), `PhoneTabs`, `ScreenFrame` (temporary).
- `src/lib/motion`: `layLines`, `arrive`, `rise`, `riseSheet`, `confirmPick`, `paintMarks`, `travel` (undo tick), `pressable`; hooks `useLayLines`, `useArrive`, `usePress`, `useRise`. All respect `prefers-reduced-motion` as `motion.md` specifies.
- `/kit` renders every shared component for review in both themes.

## 9. Security

- **Local first.** The server binds `0.0.0.0:8790` (phone later through a tunnel), but `src/proxy.ts` only lets through requests addressed to `localhost`/`127.0.0.1`/`[::1]`. Any other host needs `MESA_TOKEN` (header `x-mesa-token`, cookie `mesa_token`, or `?token=` once, which sets an httpOnly cookie). Without `MESA_TOKEN`, non-local hosts get 403. The Host check is not a network boundary: on an untrusted LAN keep the Windows firewall closed for 8790 and expose Mesa only through the tunnel with a token.
- **No secrets in the repo.** Mesa stores no Slack/Basecamp credentials (they live in Claude's MCP connectors) and no GitHub token (`gh` uses its own login). `.env*`, `data/` and `*.db` are gitignored. `MESA_TOKEN` comes from the environment.
- **Every outgoing message needs explicit approval of the exact text and destination.** Only Andrés's UI calls `approve`/`schedule`: the CLI has no approve command, and sessions can only propose, version and report `sent`/`failed`. Mesa refuses `sent` before the 20 s undo window ends. Note that the API does not authenticate local callers, so this is a convention for sessions (see CLAUDE.md: a session never calls approve, schedule, deny or undo), not a hard barrier. A planned action that writes to a client must be a salida, not a direct action.
- **Uploads** are stored under `data/uploads/<ticket>/` with sanitized names and a 25 MB cap; they are never executed or served without a route that sets a download content type (lane B adds the download route).
- **Sample data is labelled** (`is_sample`) and the UI shows "Datos de muestra." wherever it appears.
