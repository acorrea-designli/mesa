# Mesa architecture

Mesa is Andrés's personal work-ops board: one place for what waits on him (GitHub PR reviews, Basecamp client requests, Slack replies, Claude's questions), a kanban mirrored to a private GitHub Project, two-way tickets with Claude Code agents, permission approvals for blocked tool calls, PR reviews, and an approval queue (Salidas) for every outgoing Slack, Basecamp or GitHub write.

Product and design sources: `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, `.impeccable/surfaces/src-app-page-tsx.md`, and the approved mocks in `.impeccable/mocks/screens/` (see `docs/TASKS.md` for which variant each screen uses).

## 1. Shape of the system

```
 phone (tunnel + token) ─┐
 desktop browser ────────┼──▶ Next.js app (0.0.0.0:8790) ──▶ SQLite  data/mesa.db
                         │      ├─ RSC pages: / /tablero /tickets /salidas /kit
                         │      ├─ REST API  /api/*
                         │      ├─ long-polls /api/wait (sessions), /api/approvals/:id?wait= (hook)
                         │      └─ sweeper (1 s): undo windows, schedules, expiry, approval expiry
                         │
 lead session (MESA_SESSION=lead) ──▶ bin/mesa ──▶ REST API ◀── mesa wait
   ├─ ephemeral agents (MESA_AGENT, MESA_TICKET) ─▶ bin/mesa
   │    └─ PermissionRequest hook ─▶ scripts/hooks/mesa-approval.mjs ─▶ /api/approvals
   ├─ MCP: Slack, Basecamp (read via mesa-sweep, write only approved salidas)
   └─ engram (primary memory, topic mesa/<ref>)
 gh CLI (server side) ──▶ GitHub notifications polling, review requests, GitHub Project   [lane C]
 engram CLI (server side) ──▶ read-only memory panel                                     [lane C]
```

- **Mesa never talks to Slack or Basecamp.** Those connectors live in Claude sessions as MCP tools. There are no Slack or Basecamp tokens, apps, webhooks or OAuth routes in Mesa. Ingest for both comes from the `mesa-sweep` skill run by a session (on demand from "Barrer ahora", or a light periodic sweep by a cheap model during work hours) feeding `mesa item upsert` with a dedupe key per source item. Outgoing messages are approved salidas executed by the lead.
- **One stable lead session owns every ticket.** It runs with `MESA_SESSION=lead` (override with `MESA_LEAD_SESSION` on the server), blocks on `mesa wait`, and relays wakes to the ephemeral agents it spawns.
- **Agents are ephemeral.** No state may live only in a context window (the lead's is capped at 200k). Everything an agent needs to resume is on the ticket: brief, plan, messages, handoffs, team, approvals, findings and the engram topic key. `mesa ticket context <ref>` returns it in one payload.
- **GitHub is read server side** with the `gh` CLI (Andrés's own login): the notifications API polled honoring `X-Poll-Interval`, review requests and the GitHub Project mirror. **GitHub writes** (review approval, PR comments) are salidas with source `github`, approved by Andrés and executed by the lead.
- **Engram is the primary memory.** Every ticket thread and decision is saved to engram under topic key `mesa/<ref>` (scoped by the ticket's project) and linked in `engram_links`. Mesa only reads engram (CLI) for the memory panel.

## 2. Modules

| Path | What |
| --- | --- |
| `src/lib/domain/types.ts` | Domain and API response types (client safe). |
| `src/lib/domain/salida-machine.ts` | Pure salida state machine + `dueEvent` for time-driven transitions. |
| `src/lib/domain/ticket-machine.ts` | Pure ticket state machine. |
| `src/lib/db/sqlite.ts` | `node:sqlite` connection, migrations runner, `tx()`. |
| `src/lib/db/util.ts` | ids, row mapping (snake ↔ camel, JSON, booleans), errors. |
| `src/lib/repo/*` | Typed repositories: items, tasks, tickets, salidas, chips, sessions, engram, agents (briefs, handoffs, team, context), approvals, reviews, health. `createRepos(db)` for tests, `repos()` for the app. |
| `src/lib/wake/wake.ts` | Wake events (persist + in-process emitter + `waitForEvents`) and in-process signals for approval long-polls. |
| `src/lib/wake/sweeper.ts` | 1 s interval started from `src/instrumentation.ts`. |
| `src/lib/api/*` | Route wrapper (`route()`: sweep, error mapping) and zod request schemas. |
| `src/app/api/**/route.ts` | REST routes (contract below). |
| `src/proxy.ts` | Access guard (local only unless `MESA_TOKEN`). |
| `scripts/hooks/mesa-approval.mjs` | PermissionRequest hook (§7). |
| `src/styles/*`, `src/components/*`, `src/lib/motion` | Design system in code (§10). |
| `bin/mesa` | CLI for sessions and agents (§9). |
| `db/migrations/*.sql` | Schema, applied in order at startup (`schema_migrations`). |

## 3. Data model

All timestamps are ISO-8601 UTC strings. JSON columns are TEXT. Ids are `<prefix>_<12 base36>`. Tickets also get a short `ref` (`t1`, `t2`, …) used everywhere agents and `@` references name a ticket.

### Work
- **items** (`0001`): one row per thing waiting on Andrés, unique by `(source, external_id)`. That pair is the dedupe key: `pr:<owner>/<repo>#<n>`, `slack:<channel>:<ts>`, `basecamp:<recording id>`, and so on. Columns: `source` github|slack|basecamp|claude, `kind`, `title`, `excerpt`, `project`, `url`, `need`, `station` (inbox|todo|doing|waiting|done), `wait_on` (you|client|claude|none|person:<name>), `tag`, `task_id`, `meta`, `is_sample`, `received_at`. Hoy draws items.
- **tasks** (`0001`): kanban cards on Tablero. `source` is the card's lane (Tablero B), plus `station`, `wait_on`, `position`, and the GitHub Project mapping `gh_item_id`, `gh_content_url`, `sync_state` synced|pending|error|local, `sync_error`, `synced_at`. Items link with `items.task_id`; moving a task moves its items. Project ids live in `settings` (`gh_project.*`, written by lane C). Station ↔ Status: Inbox, Todo, In Progress, Waiting, Done.

### Tickets and agents
- **tickets** (`0001`): `ref`, `direction` (claude_asks|andres_asks), `title`, `status` (§4), `project` (engram scope), `owner_session` (normally `lead`), `item_id`, `woke_at`, `closed_at`. Engram topic key: `mesa/<ref>` (`ticketTopicKey`).
  - **ticket_messages**: `author` andres|claude, `body` (Markdown), `options` (`[{key,label,detail}]`), `recommended`, `recommendation`, `chosen`.
  - **attachments**: files under `data/uploads/<ticket id>/`.
  - **ticket_refs**: `@` references (`ticket`|`item`|`url`).
  - **planned_actions**: the "Claude va a hacer" plan: `seq`, `kind`, `source` (line colour), `label`, `mode` direct|needs_ok, `state`, `target`. Anything that writes outside Mesa (Slack, Basecamp, GitHub) is a salida, never a direct action.
- **ticket_briefs** (`0002`): the living summary, one per ticket, rewritten by the owner on every milestone: `body` (Markdown), `goal`, `decisions[]`, `plan_step`, `open_questions[]`, `next_action`, `revision`, `updated_by`.
- **handoffs** (`0002`): append-only checkpoints: `agent`, `role`, `status` done|paused|blocked, `body`, `done`, `remaining`, `artifacts` (`{branch, pr, files[], …}`).
- **team_agents** (`0002`): agents attached to a ticket: `name` (PK, `<role>-<ticketRef>[-k]`, never reused), `role`, `owner`, `status` live|retired (alive|spent), `spawned_at`, `retired_at`.

### Approvals and reviews
- **approvals** (`0002`): permission requests from the hook: `ticket_id` (NULL → shown on Hoy), `agent`, `tool`, `summary` (file or command description), `detail` (diff or exact command), `cwd`, `hints[]` (closest allow rules), `status` pending|decided|expired, `decision` allow|read_config|deny, `note`, `decided_by`, `decided_at`, `expires_at`.
- **reviews** (`0002`): one per PR (`repo`, `pr` unique), `ticket_id`, `head_sha` (the reviewed head), `state` open|approving|approved, `salida_id` (the approve write).
- **review_findings** (`0002`): `n` (stable within the review), `label` blocker|nit|comment, `at` (`path:line`), `anchor` (code excerpt), `summary`, `explanation`, `state` open|fixed|waived|dismissed, `sha`, `gh_comment_id` (set by the lead after posting), `salida_id` (the post write).

### Salidas
- **salidas** (`0001`): `status` (§4), `source` slack|basecamp|github, `destination` JSON, `title`, `context`, `ticket_id`, `links`, `owner_session`, `current_version`, `approved_version`, `undo_until`, `released_at`, `send_at`, `expires_at`, `sent_at`, `permalink`, `error`, `delete_requested_at`, `deleted_at`.
  - Destination kinds: `slack_thread|slack_channel {workspace, channel, channelId?, threadTs?, threadLabel?, postAs}`; `basecamp_comment|basecamp_campfire|basecamp_message {project, projectId?, recordingId?, recordingTitle?, postAs}`; `github_review {repo, pr, event APPROVE|COMMENT|REQUEST_CHANGES, commitId?, postAs}`; `github_comment {repo, pr, path?, line?, commitId?, findingN?, postAs}`.
  - Delete policy (`DELETE_POLICY`): Slack none (the undo window is the only way back), Basecamp comment/message trash (restorable 25 days), Campfire permanent, GitHub review none, GitHub comment permanent.
  - **salida_versions** (immutable, `n` from 1, `author` claude|andres, `turn_id`, `starred`), **salida_turns** (refine chat; Andrés turns carry semáforo `marks`; an open turn blocks approve), **learned_chips** (labels from Andrés's own requests, top 4).

### Plumbing
- **sessions**: `id`, `label`, `cwd`, `project`, `cursor`, `waiting_since`, `last_seen_at`. Unknown owner ids are registered on first use.
- **wake_events**: `id` (cursor), `session_id` (NULL = any), `kind`, `entity_type`, `entity_id`, `payload`.
- **source_health** (`0002`): `source` github|github_project|slack|basecamp|engram, `state` ok|down|limited, `note`. Sessions report Slack and Basecamp, since they are the ones that see MCP failures. The server reports GitHub (lane C).
- **engram_links**: `entity_type`, `entity_id`, `project`, `topic_key`, `observation_id`. **settings**: key/value.

## 4. State machines

### Salida

```
draft ─propose─▶ pending ─approve(vN)─▶ sending ─(20 s)─ release ─▶ sending·released ─sent─▶ sent ─request_delete─▶ … ─deleted─▶ deleted
                  │  ▲ ▲  │                │                               │   │                                        └─request_restore/restored (trash only)
                  │  │ └──┼──── undo ──────┘ (only inside the window)      │   └─failed─▶ failed ─retry─▶ pending
                  │  │    │                                                 └─hold─▶ queued_until_back
                  │  │    └─approve while the source is down ──────────────────────▶ queued_until_back ─resume (source back)─▶ sending·released (re-check thread)
                  │  │                                                                   ├─unqueue─▶ pending
                  │  │                                                                   └─bounce (thread changed)─▶ pending
                  │  └──unschedule── scheduled ◀──schedule(at, vN)──┘   scheduled ─(send_at)─ release ─▶ sending·released
                  ├─deny─▶ denied        (also from draft, scheduled, queued_until_back)
                  └─expire─▶ expired     (pending past expires_at)
```

Rules (`transitionSalida`, tested in `salida-machine.test.ts`):
- Approve sends the version shown (`approve.version` must equal `current_version`) and is refused while a refine turn is open.
- `approve` sets `undo_until = now + 20 s`, and `undo` works only inside the window. The sweeper releases the salida when the window ends and wakes the owner with `salida.released`. **The lead sends only after that event**; `sent`/`failed` before release are refused (409).
- **Aprobar al volver.** If the source is reported down when Andrés approves, the salida goes straight to `queued_until_back` (`salida.queued` wake). If the lead finds the source down at send time, it calls `hold`. When the source is reported `ok` again, every queued salida of that source is resumed: released with `recheckThread: true`. The lead re-reads the thread first; if there are new messages it calls `bounce {reason}`, which returns the salida to pending for a fresh approval.
- `schedule` needs a future time; at `send_at` the sweeper releases it.
- `request_delete` follows the destination policy.

### Ticket

| Status | UI | Who acts |
| --- | --- | --- |
| `waiting_andres` | Te espera | Andrés |
| `waiting_claude` | Espera a Claude | the lead (woken) |
| `working` | Claude trabaja | the lead / its agents |
| `closed` | Cerrado · Reabrir | nobody |

Events: `andres_reply` → waiting_claude (wake `ticket.answered`); `claude_reply` → waiting_andres; `claude_plan(needsOk)` → waiting_andres if any action needs OK, else working; `approve_plan` → working (wake `ticket.plan_approved`); `claim` → working; `close` → closed (wake when Andrés closes); `reopen` → waiting_claude (wake). A new `andres_asks` ticket wakes its named owner, or every session.

### Approval

`pending` → `decided` (allow | read_config | deny) by `POST /decision` before `expires_at`, or → `expired` at `expires_at` (lazily and by the sweeper). Decisions are final: a second decision, or any decision after expiry, is refused (409). Only `allow` lets the call run.

### Review

`open` → `approving` when Approve / Approve anyway creates the approve salida → `approved` once that salida is sent; back to `open` if it is undone, denied, failed or expired. Findings go from `open` to one of: `fixed` (set by the reviewer on a new head), `waived` (Approve anyway) or `dismissed` (Dismiss).

## 5. Ephemeral agents and the resume payload

- **Naming:** `<role>-<ticketRef>[-k]` (`dev-t17`, `review-t17-2`). `POST /api/team` refuses a name that was ever used.
- **Lifecycle:**
  1. The lead adds the agent (`mesa team add`) and starts it with `MESA_AGENT` and `MESA_TICKET` in its environment and `MESA_SESSION=lead`.
  2. The agent starts with `mesa ticket context <ref>`.
  3. While it works, it rewrites the brief on every milestone (`mesa ticket brief`).
  4. Before it stops, it records a handoff (`mesa handoff … --status done|paused|blocked`).
  5. The lead retires it (`mesa team retire`).
- **Resume payload** (`GET /api/tickets/:ref/context?messages=20`, `TicketContext`): `ticket`, `brief`, `plan`, `messages` (last N, oldest first), `openQuestions` (brief questions plus an unanswered Claude choice), `team`, `handoffs` (latest per agent), `latestHandoff`, `approvals` (pending), `salidas` (not final), `findings`, `engram {topicKey: "mesa/<ref>", project, links}`.
- **Memory:** after each milestone the owner saves the thread and decisions to engram under `mesa/<ref>` (MCP `mem_save` with that `topic_key`) and links the observation with `mesa engram link`.

## 6. Reviews

The reviewer agent upserts findings with `mesa finding upsert <ref> --json -`, keyed by `repo`, `pr` and `n`. Andrés's buttons call `POST /api/reviews/:id/actions`:

| Action | Effect | GitHub write |
| --- | --- | --- |
| `approve` | refused while open blockers exist | github_review APPROVE salida |
| `approve_anyway` | waives every open finding | github_review APPROVE salida |
| `post {findingNs}` | one comment per finding; the text is the summary plus the explanation, as shown on the card | one github_comment salida each |
| `dismiss {findingNs}` | finding → dismissed | none |
| `explain {findingNs}` | asks the reviewer for more | none |

The button press is the approval of the exact text and destination shown on the card. The salida is therefore created already approved and enters the 20 s undo window. Every action wakes the ticket owner with `review.action {action, repo, pr, findingNs, salidaIds, note, ticketRef}`. After sending, the lead records the comment id with `mesa finding upsert` (`ghCommentId`).

## 7. Permission approvals (hook)

`scripts/hooks/mesa-approval.mjs` is a Claude Code **PermissionRequest** hook for the sessions that work in `G:/WorkSpace/designli`. Register it in that project's `.claude/settings.json`. Its timeout must be longer than `MESA_APPROVAL_TIMEOUT_MS` (default 540 s):

```json
{ "hooks": { "PermissionRequest": [ { "matcher": "*", "hooks": [ { "type": "command", "command": "node G:/WorkSpace/designli/ops/scripts/hooks/mesa-approval.mjs", "timeout": 600 } ] } ] } }
```

1. It reads the hook JSON and builds the card: tool, summary, diff or exact command, and cwd. It also collects the closest allow rules from `.claude/settings.json`, `.claude/settings.local.json` and `~/.claude/settings.json`.
2. It files `POST /api/approvals {ticketRef: $MESA_TICKET, agent: $MESA_AGENT, tool, summary, detail, cwd, hints, expiresAt}`. The card shows in the ticket thread, or on Hoy when there is no ticket.
3. It long-polls `GET /api/approvals/:id?wait=25` until the approval is decided or expired, then prints the decision:
   - **Dar permiso** (`allow`) → `{behavior: "allow"}` for this one call.
   - **Lee tus configuraciones** (`read_config`) → deny with a fixed message: read your own allow rules and retry with an allowed command shape instead of asking. The message includes the closest rule.
   - **Denegar** (`deny`) → deny with Andrés's optional note.
   - Timeout → deny, telling the agent not to retry and to post a ticket question instead.
4. An unreachable Mesa, bad input or any crash is a deny. The output never contains `updatedInput` or `updatedPermissions`, so no standing rule is ever created.

## 8. REST API

JSON in and out. Errors: `{ error: { code, message, details? } }` with 400 `invalid_request|invalid_json`, 404 `not_found`, 409 `invalid_transition`, 413 `too_large`, 500 `internal`. Every request first runs the sweep. Request schemas: `src/lib/api/schemas.ts`. Response types: `src/lib/domain/types.ts`. The endpoints for agents, approvals, reviews and health wrap their payload in a named key (`{ brief }`, `{ handoffs }`, …).

| Method & path | Body / query | Response |
| --- | --- | --- |
| GET `/api/health` | | `{ ok, now }` |
| GET `/api/counts` | | `Counts` (rail, stations, pending approvals) |
| GET/POST `/api/items` | `?station=&source=` / `ItemInput` | `Item[]` / `Item` 201 |
| POST `/api/items/upsert` | `ItemInput` (by source + externalId) | `{ item, created }` |
| GET/PATCH/DELETE `/api/items/:id` | `ItemPatch` | `Item` / 204 |
| GET/POST `/api/tasks` | `?station=&source=` / `TaskInput` | `Task[]` / `Task` 201 |
| GET/PATCH/DELETE `/api/tasks/:id` | `TaskPatch` | `Task` / 204 |
| POST `/api/tasks/:id/move` | `{ station, position? }` | `Task` (sync pending) |
| POST `/api/tasks/:id/sync` | `{ syncState, ghItemId?, ghContentUrl?, syncError? }` | `Task` |
| POST `/api/tasks/:id/items` | `{ itemIds }` | `Task` |
| GET/POST `/api/tickets` | `?status=&open=1` / `TicketInput` | `Ticket[]` / `TicketDetail` 201 |
| GET `/api/tickets/:idOrRef` | | `TicketDetail` |
| GET `/api/tickets/:ref/context` | `?messages=20` | `TicketContext` |
| GET/PUT `/api/tickets/:ref/brief` | PUT `BriefInput` | `{ brief }` |
| GET/POST `/api/tickets/:ref/handoffs` | POST `{ agent, role?, status, body?, done?, remaining?, artifacts? }` | `{ handoffs }` / `{ handoff }` 201 |
| GET/POST `/api/tickets/:ref/findings` | POST `FindingInput` (upsert) | `{ findings }` / `{ finding }` |
| POST `/api/tickets/:id/messages` | `{ author, body?, options?, recommended?, recommendation?, chosen?, refs?, session? }` | `TicketDetail` |
| POST `/api/tickets/:id/plan` | `{ actions, session? }` | `TicketDetail` |
| POST `/api/tickets/:id/plan/approve` | `{ reject? }` | `TicketDetail` |
| POST `/api/tickets/:id/transition` | `{ event: claim\|close\|reopen, by?, session? }` | `TicketDetail` |
| POST `/api/tickets/:id/attachments` | multipart `file`, `messageId?` | `Attachment` 201 |
| PATCH `/api/actions/:id` | `{ state }` | `PlannedAction` |
| GET `/api/handoffs` | `?agent=&ticket=&limit=` | `{ handoffs }` newest first |
| GET/POST `/api/team` | `?status=live\|retired&ticket=` / `{ ticketRef, agent, role, owner? }` | `{ agents }` / `{ agent }` 201 |
| POST `/api/team/:name/retire` | | `{ agent }` |
| GET/POST `/api/approvals` | `?status=&ticket=&hoy=1` / `ApprovalInput` | `{ approvals }` / `{ approval }` 201 |
| GET `/api/approvals/:id` | `?wait=SECONDS` (≤ 55) | `{ approval }` |
| POST `/api/approvals/:id/decision` | `{ decision: allow\|read_config\|deny, actor, note? }` | `{ approval }`; 409 after expiry or once decided |
| GET `/api/reviews` | `?ticket=` | `{ reviews }` (with findings) |
| GET `/api/reviews/:id` | | `{ review }` |
| POST `/api/reviews/:id/actions` | `{ action, findingNs?, note? }` | `{ review, salidaIds }` |
| GET/POST `/api/salidas` | `?status=` / `SalidaInput` | `Salida[]` / `SalidaDetail` 201 |
| GET `/api/salidas/:id` | | `SalidaDetail` |
| POST `/api/salidas/:id/versions` | `{ body, author?, turnId?, chipLabel? }` | `SalidaDetail` |
| PATCH `/api/salidas/:id/versions/:n` | `{ starred }` | `SalidaDetail` |
| POST `/api/salidas/:id/select` | `{ n }` | `SalidaDetail` |
| POST `/api/salidas/:id/edit` | `{ body }` | `SalidaDetail` |
| POST `/api/salidas/:id/turns` | `{ body?, marks?, chipLabel? }` | `SalidaDetail` |
| POST `/api/salidas/:id/turns/:turnId/cancel` | | `SalidaDetail` |
| POST `/api/salidas/:id/transition` | `SalidaEvent` | `SalidaDetail` |
| GET `/api/chips` | | `LearnedChip[]` |
| GET/POST `/api/sources/health` | POST `{ source, state, note? }` | `{ health }` / `{ health, resumed }` |
| POST `/api/sweep` | `{ sources? }` | `{ event }` 202 ("Barrer ahora") |
| GET/POST `/api/sessions` | `{ id, label?, cwd?, project? }` | sessions / `Session` |
| GET `/api/wait` | `?session=&after=&timeout=` | `{ events, cursor }` |
| POST `/api/wait/ack` | `{ session, cursor }` | `Session` |
| GET/POST `/api/engram/links` | | `EngramLink[]` / `EngramLink` 201 |
| GET `/api/engram/search` | `?q=&project=&limit=5` | 501 until lane C |

Salida events over HTTP: `propose`, `approve {version}`, `undo`, `sent {permalink?}`, `failed {error}`, `retry`, `deny`, `schedule {at, version}`, `unschedule`, `request_delete`, `deleted`, `request_restore`, `restored`, `hold {reason}`, `unqueue`, `bounce {reason}`. `release`, `expire` and `resume` are internal (sweeper, health).

## 9. Wake protocol and CLI

**Wake (long-poll):** the lead blocks on `mesa wait` (`GET /api/wait?session=lead`). The server answers as soon as there are events after the session's cursor (targeted or broadcast), or with `[]` after `timeout`.
- **Delivery is at least once.** The CLI acks only after handling (`POST /api/wait/ack`), so a handler must check current state before it acts.
- **Kinds:** `ticket.created|answered|plan_approved|closed|reopened`, `salida.turn|released|queued|undone|denied|delete_requested|restore_requested`, `review.action`, `sweep.requested`, `task.moved` (reserved).
- **On `salida.released`:**
  1. `mesa salida show <id>`.
  2. If `recheckThread` is set, re-read the thread and `bounce` if it changed.
  3. Send `versions[approvedVersion-1].body` to exactly `destination`.
  4. Report with `mesa salida sent|failed|hold`.
- **On `sweep.requested`:** run `mesa-sweep` for the listed sources.

**CLI (`bin/mesa`, `bin/mesa.cmd`):** zero-dependency Node over the REST API.
- Env: `MESA_URL`, `MESA_SESSION`, `MESA_AGENT`, `MESA_TOKEN`.
- Output: JSON on stdout, errors on stderr (exit 1, usage exit 2). `--body -` reads stdin.
- Commands (`node bin/mesa help` lists them all): `session`, `wait [--once|--loop]`, `ticket ask|reply|plan|claim|close|action|show|list|context|brief`, `handoff`, `handoffs`, `team add|retire|list`, `finding upsert|list`, `review list`, `approval show`, `salida propose|version|sent|failed|hold|bounce|deleted|restored|show|list`, `health set|list`, `sweep`, `item upsert`, `engram link`.
- Missing on purpose: there is no approve, schedule, deny or undo for salidas, and no decision for approvals. Those are Andrés's buttons.

## 10. Design system in code

- `src/styles/tokens.css`: every DESIGN.md token as a CSS custom property, Tokio on `:root`, Grafito on `[data-theme="dark"]`, plus semáforo `--keep-*`, `--redo-*`, `--drop-*`, `--shade`, radii, spacing, layout widths. Names match the mocks (`--gnd`, `--raise`, `--gh`, …); the header maps them to DESIGN.md names.
- `src/styles/components.css`: shared classes from the mocks (`.btn`, `.ap3`, `.chip`, `.lk`, `.st`, `.kind`, `.k`, `.ln`, `.ring`, `.s-*`/`.sv-*`, `.tabs`/`.tab`, `.ctx`, `.msg`, `mark.m-*`, `.alert`, `.sheet`, `.toast`). `.src-<source>` sets `--c`, `--t`, `--ci`.
- `src/components/ui/primitives.tsx`: `Btn`, `Chip`, `LinkChip`, `StatusTag`, `Kind`, `Label`, `ContextQuote`, `ExactText`, `Alert`. `interactive.tsx`: `SplitApprove`, `Tabs`, `Sheet`, `ToastProvider`/`useToast`, `ThemeToggle` (+ `THEME_BOOT`).
- `src/components/line/Line.tsx`: `SourceDot`, `LineStub`, `Ring`, `Interchange`, `DirectionMarker`, `BrokenLine`, `BrandMark`.
- `src/components/shell/*`: `AppShell`, `Rail` (counts, source health slot, theme toggle), `PhoneTabs`, `ScreenFrame` (temporary).
- `src/lib/motion`: `layLines`, `arrive`, `rise`, `riseSheet`, `confirmPick`, `paintMarks`, `travel`, `pressable`, hooks `useLayLines`, `useArrive`, `usePress`, `useRise`. All of them respect `prefers-reduced-motion`.
- `/kit` renders every shared component.

## 11. Security

- **Local first.** The server binds `0.0.0.0:8790`, but `src/proxy.ts` only serves requests addressed to `localhost`/`127.0.0.1`/`[::1]`. Other hosts need `MESA_TOKEN` (header `x-mesa-token`, cookie `mesa_token`, or `?token=` once); without it they get 403. The Host check is not a network boundary: keep the firewall closed for 8790 and expose Mesa only through the tunnel with a token.
- **No secrets in the repo, and no Slack or Basecamp credentials at all.** Those connectors live in Claude's MCP, and GitHub uses the `gh` login. `.env.local` (gitignored) holds only Mesa settings, which `.env.example` lists. `data/` and `*.db` are gitignored.
- **Every outgoing write needs Andrés's explicit approval of the exact text and destination.** Slack and Basecamp messages and GitHub reviews/comments are salidas, and the review buttons approve the exact text shown on the card. Mesa refuses `sent` before the 20 s undo window ends.
- **Permission approvals allow one call at a time.** Allow comes only from an explicit "Dar permiso" before expiry. Everything else is deny, and the hook never emits `updatedPermissions`.
- **Approval rules are not enforced by the API.** The local API does not authenticate callers, so "sessions and agents never approve, schedule, deny, undo or decide" rests on CLAUDE.md and on the CLI having no such commands.
- **Uploads** are stored under `data/uploads/<ticket>/` with sanitized names and a 25 MB cap.
- **Sample data is labelled** (`is_sample`) and shown with "Datos de muestra.".
