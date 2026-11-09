# Mesa architecture

Mesa is Andrés's personal work-ops board: one place for what waits on him (GitHub PR reviews, Basecamp client requests, Slack replies, Claude's questions), a kanban mirrored to a private GitHub Project, two-way tickets with Claude Code agents, permission approvals for blocked tool calls, PR reviews, and an approval queue (Salidas) for every outgoing Slack, Basecamp or GitHub write.

Product and design sources: `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, `.impeccable/surfaces/src-app-page-tsx.md`, and the approved mocks in `.impeccable/mocks/screens/` (see `docs/TASKS.md` for which variant each screen uses).

## 1. Shape of the system

```
 phone ──▶ Cloudflare Access (his email) ──▶ cloudflared (this PC) + MESA_TOKEN ───────┐
 desktop browser (localhost) ──────────────────────────────────────────────────────────┼──▶ Next.js app (127.0.0.1:8790) ──▶ SQLite  data/mesa.db
                                                                                       │      ├─ RSC pages: / /tablero /tickets /salidas /telefono /kit
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

- **Mesa never talks to Slack or Basecamp.** Those connectors live in Claude sessions as MCP tools. There are no Slack or Basecamp tokens, apps, webhooks or OAuth routes in Mesa: Mesa holds no Slack token at all. Slack salidas go out as drafts in Andrés's own Slack composer by default (he presses send, so it is his own message, with no "Sent using @Claude" footer), or, when he picks "Aprobar y que Claude lo envíe", through the connector's `slack_send_message`, which carries the footer. Ingest for both comes from the `mesa-sweep` skill run by a session (on demand from "Barrer ahora", or a light periodic sweep by a cheap model during work hours) feeding `mesa item upsert` with a dedupe key per source item. Outgoing messages are approved salidas executed by the lead.
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
| `src/proxy.ts`, `src/lib/access.ts` | Access guard: local only, otherwise a valid Cloudflare Access JWT (`src/lib/cf-access.ts`) plus the `MESA_TOKEN` cookie/header, §11. |
| `src/app/pair/route.ts`, `src/app/api/pairing/route.ts`, `src/lib/repo/pairing.ts`, `src/lib/pair-page.ts`, `src/lib/public-url.ts` | Phone pairing: one-time code (QR or typed short code) to cookie (§11). |
| `src/features/phone/*`, `src/app/telefono`, `src/app/manifest.webmanifest`, `public/sw.js`, `public/offline.html` | Phone: `/telefono` (QR, short code, install), install banner, tunnel status strip, service worker (§11). |
| `scripts/serve.mjs`, `scripts/tunnel.mjs` | `pnpm dev` / `pnpm start` bind, `pnpm tunnel` (cloudflared, Access probe). |
| `scripts/hooks/mesa-approval.mjs` | PermissionRequest hook (§7). |
| `src/styles/*`, `src/components/*`, `src/lib/motion` | Design system in code (§10). |
| `bin/mesa` | CLI for sessions and agents (§9). |
| `db/migrations/*.sql` | Schema, applied in order at startup (`schema_migrations`). |

## 3. Data model

All timestamps are ISO-8601 UTC strings. JSON columns are TEXT. Ids are `<prefix>_<12 base36>`. Tickets also get a short `ref` (`t1`, `t2`, …) used everywhere agents and `@` references name a ticket.

### Work
- **items** (`0001`): one row per thing waiting on Andrés, unique by `(source, external_id)`. That pair is the dedupe key: `pr:<owner>/<repo>#<n>`, `slack:<channel>:<ts>`, `basecamp:<recording id>`, and so on. Columns: `source` github|slack|basecamp|claude, `kind`, `title`, `excerpt`, `project`, `url`, `need`, `station` (inbox|todo|doing|waiting|done), `wait_on` (you|client|claude|none|person:<name>), `tag`, `task_id`, `meta`, `is_sample`, `received_at`, `skipped_at` (`0710`). Hoy draws items.
  - **Saltar (`skipped_at`).** "Saltar" on a Hoy row or detail pane marks an item Andrés does not want to act on: `items.skip(id)` sets `station` done, `wait_on` none and `skipped_at` now, and never touches the card (`task_id`) or a ticket. It is its own column because `meta` is replaced on every upsert. **Upsert rule:** `items.upsert` of an existing skipped item drops `station` and `waitOn` from the patch, so a sweeper or GitHub re-upsert of the same `(source, external_id)` keeps it done and skipped while title, excerpt, url and meta still refresh; a new external id (a new comment) is a normal Te espera item. The GitHub review sync leaves a skipped PR alone (no detail read, no upsert, no reopen), even if the review is requested again. `items.unskip(id, { station, waitOn })` (Deshacer) restores both and clears `skipped_at`; so does any move to a station other than done (`PATCH /api/items/:id`, the card move, the Project pull). In Hecho a skipped item reads "Saltado".
- **tasks** (`0001`): kanban cards on Tablero. `source` is the card's lane (Tablero B), plus `station`, `wait_on`, `position`, and the GitHub Project mapping `gh_item_id`, `gh_content_url` (always null since `0320`: the mirror holds drafts only), `sync_state` synced|pending|error|local, `sync_error`, `synced_at`. Items link with `items.task_id`; moving a task moves its items. `ticket_id` (`0500`) is the ticket Claude works the card in ("Dárselo a Claude"); null for a note-only card. The repository fills `owner` (`TaskOwner`: `ticketRef`, `ticketStatus`, and the live owner agent from `ticket_team`, null until the lead spawns one) for the owner chip. Project ids live in `settings` (`gh_project.*`, written by lane C). Station ↔ Status: Inbox, Todo, In Progress, Waiting, Done.
- **ignored_projects** (`0400`): projects Andrés chose to ignore ("Ignorar proyecto «X»"). Columns `source` (one of the four, or `*` for every source), `project` (the project key), `label` (what «X» reads), `created_at`; unique `(source, project)`. The project key is the most specific stable id, read from the dedupe key by the generated column `items.project_key` (mirrored by `projectKey()` in `src/lib/domain/ignore.ts`): GitHub `owner/repo` (from `pr:<owner>/<repo>#<n>`; `items.project` is the bare repo name), Slack the channel id (the segment before the last `:` of `<channelId>:<ts>`), Basecamp the project name, Claude the project. A row matches an item when the source is the same (or the row is `*`) and the row's project equals the item's key or its plain `project`; a task matches by its own `project` or by a linked item of its lane's source (a GitHub task made from Hoy carries the bare repo name, its PR item carries `owner/repo`).
  - **Filtered by query, never flagged or deleted.** `items.list({ ignored: "exclude" })`, `tasks.list({ ignored: "exclude" })` and `counts()` leave them out, so they leave Hoy, the band, the rail counts and the Tablero; deleting the row brings them all back as they were. The ingest never upserts them: the GitHub review search skips them (and leaves their existing items alone instead of moving them to Hecho), `POST /api/items/upsert` answers `{ ignored: true }` without storing, and the sweeper reads `mesa ignore list` each tick and skips them before triage. `tasks.pendingSync()` skips them, so the GitHub Project is not written. Salidas and tickets are never filtered: a pending salida of an ignored project stays in Salidas.

### Tickets and agents
- **tickets** (`0001`): `ref`, `direction` (claude_asks|andres_asks), `title`, `status` (§4), `project` (engram scope), `owner_session` (normally `lead`), `item_id`, `task_id` (`0500`, the board card it works; `tasks.ticket_id` points back), `woke_at`, `closed_at`. Engram topic key: `mesa/<ref>` (`ticketTopicKey`).
  - **ticket_messages**: `author` andres|claude, `body` (Markdown), `options` (`[{key,label,detail}]`), `recommended`, `recommendation`, `chosen`, `kind` (`0700`: `permission_request` for the "Pídeme permiso" message, else NULL), `about_message_id` (the latest Claude message at that moment).
  - **attachments**: files under `data/uploads/<ticket id>/`.
  - **ticket_refs**: `@` references (`ticket`|`item`|`url`).
  - **planned_actions**: the "Claude va a hacer" plan: `seq`, `kind`, `source` (line colour), `label`, `mode` direct|needs_ok, `state`, `target`. Anything that writes outside Mesa (Slack, Basecamp, GitHub) is a salida, never a direct action.
- **ticket_briefs** (`0002`): the living summary, one per ticket, rewritten by the owner on every milestone: `body` (Markdown), `goal`, `decisions[]`, `plan_step`, `open_questions[]`, `next_action`, `revision`, `updated_by`.
- **ticket_handoffs** (`0002`): append-only checkpoints: `agent`, `role`, `status` done|paused|blocked, `body`, `done`, `remaining`, `artifacts` (`{branch, pr, files[], …}`).
- **ticket_team** (`0002`): agents attached to a ticket: `name` (PK, `<role>-<ticketRef>[-k]`, never reused), `role`, `owner`, `status` live|retired (the API values for "alive" and "spent"), `spawned_at`, `retired_at`.

### Approvals and reviews
- **approvals** (`0002`): permission requests from the hook: `ticket_id` (NULL → shown on Hoy), `agent`, `tool`, `summary` (file or command description), `detail` (diff or exact command), `cwd`, `hints[]` (closest allow rules), `status` pending|decided|expired, `decision` allow|read_config|deny, `note`, `decided_by`, `decided_at`, `expires_at`.
- **reviews** (`0002`): one per PR (`repo`, `pr` unique), `ticket_id`, `head_sha` (the reviewed head), `state` open|approving|approved, `salida_id` (the approve write).
- **review_findings** (`0002`): `n` (stable within the review), `label` blocker|nit|comment, `at` (`path:line`), `anchor` (code excerpt), `summary`, `explanation`, `state` open|fixed|waived|dismissed, `sha`, `gh_comment_id` (set by the lead after posting), `salida_id` (the post write).

### Salidas
- **salidas** (`0001`): `status` (§4), `source` slack|basecamp|github, `destination` JSON, `title`, `context`, `ticket_id`, `links`, `owner_session`, `current_version`, `approved_version`, `send_mode` (`0900`: Slack only, `draft` default | `send`, set with the approval or Programar, cleared by an undo; null for every other source), `undo_until`, `released_at`, `send_at`, `expires_at`, `drafted_at` (`0900`), `sent_at`, `permalink`, `error`, `delete_requested_at`, `deleted_at`.
  - Destination kinds: `slack_thread|slack_channel {workspace, channel, channelId?, threadTs?, threadLabel?, postAs}`; `basecamp_comment|basecamp_campfire|basecamp_message {project, projectId?, recordingId?, recordingTitle?, postAs}`; `github_review {repo, pr, event APPROVE|COMMENT|REQUEST_CHANGES, commitId?, postAs}`; `github_comment {repo, pr, path?, line?, commitId?, findingN?, postAs}`.
  - Delete policy (`DELETE_POLICY`): Slack none (a direct send: the undo window is the only way back; a Slack draft is Andrés's to delete in Slack), Basecamp comment/message trash (restorable 25 days), Campfire permanent, GitHub review none, GitHub comment permanent.
  - **salida_versions** (immutable, `n` from 1, `author` claude|andres, `turn_id`, `starred`), **salida_turns** (refine chat; Andrés turns carry semáforo `marks`; an open turn blocks approve), **learned_chips** (labels from Andrés's own requests, top 4).

### Plumbing
- **sessions**: `id`, `label`, `cwd`, `project`, `cursor`, `waiting_since`, `last_seen_at`. Unknown owner ids are registered on first use.
- **wake_events**: `id` (cursor), `session_id` (NULL = any), `kind`, `entity_type`, `entity_id`, `payload`.
- **source_state** (`0002`): one row per source (github|github_project|slack|basecamp|engram) holding sweep state and health: `watermark` (opaque per source: Slack ts, Basecamp updated_at, GitHub Last-Modified), `last_checked` (last probe), `last_new_at` (last probe that found something new), `backoff_until`, `cadence_s` (current probe interval, default 60), `error_count`, `last_error`, `health` ok|degraded|down, `note` (`0003` renamed `last_checked_at` and added the error fields). The sweeper reports Slack and Basecamp, and the server reports GitHub (lane C). Health feeds the Estados B rail notice and drives "Aprobar al volver".
- **settings** `last_interaction_at`: stamped whenever Andrés acts in the UI. That covers answering a ticket, approving a plan, any salida decision, refine or edit, deciding an approval, a review action, moving a card (single or batch, and its Deshacer), "Dárselo a Claude" and "Barrer ahora". Claude's writes never stamp it.
- **engram_links**: `entity_type`, `entity_id`, `project`, `topic_key`, `observation_id`. **settings**: key/value.

## 4. State machines

### Salida

```
draft ─propose─▶ pending ─approve(vN)─▶ sending ─(20 s)─ release ─▶ sending·released ─sent─▶ sent ─request_delete─▶ … ─deleted─▶ deleted
                  │  ▲ ▲  │                │                               │   │                                        └─request_restore/restored (trash only)
                  │  │ └──┼──── undo ──────┘ (only inside the window)      │   └─failed─▶ failed ─retry─▶ pending
                  │  │    │                                                 └─hold─▶ queued_until_back
                  │  │    │      Slack, mode draft: sending·released ─drafted─▶ draft_created ─confirm_sent ("Ya lo envié", Andrés)─▶ sent
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
- **Slack send modes.** `approve` and `schedule` take `mode` for a Slack salida only (omitted = `draft`; any other source refuses one with 409): `draft` = "Aprobar", `send` = "Aprobar y que Claude lo envíe" (the card says next to the button that it goes out with "Sent using @Claude"). The mode is stored on the salida with the approval (`send_mode`), kept through release, hold and resume, cleared by an undo, unschedule, unqueue, bounce, retry and deny, and carried in the `salida.released` payload (`mode`) and in `mesa salida show` (`sendMode`). No session can set it: the approve call is Andrés's click (G10). Programar records a mode too (default draft).
- **Draft state.** For a `draft` salida the lead calls `slack_send_message_draft` and then `drafted` (`mesa salida drafted <id>`, lead only, G4 for teammates; sandbox needs `--simulated` like `sent`): status `draft_created`, shown as "Borrador en Slack · envíalo tú", distinct from sent. Only Andrés closes it with "Ya lo envié" (`confirm_sent`, his click; G10). `draft_created` never counts as sent, never re-releases and is not time-driven. A refused draft call is `hold` (never a switch to `slack_send_message`).
- `schedule` needs a future time; at `send_at` the sweeper releases it.
- `request_delete` follows the destination policy.

### Ticket

| Status | UI | Who acts |
| --- | --- | --- |
| `waiting_andres` | Te espera | Andrés |
| `waiting_claude` | Espera a Claude | the lead (woken) |
| `working` | Claude trabaja | the lead / its agents |
| `closed` | Cerrado · Reabrir | nobody |

Events: `andres_reply` → waiting_claude (wake `ticket.answered`); `claude_reply` → waiting_andres; `claude_plan(needsOk)` → waiting_andres if any action needs OK, else working; `approve_plan` → working (wake `ticket.plan_approved`; needs a step still planned, from any non-closed status); `claim` → working; `close` → closed (wake when Andrés closes); `reopen` → waiting_claude (wake). A new `andres_asks` ticket wakes its named owner, or every session; tickets made by the dispatch service (below) always name `lead`.

### Dispatch: tasks go straight to an agent

`src/lib/repo/dispatch.ts`. Every way Andrés creates a task hands it to Claude unless he ticks "Solo anotar (sin agente)": Tablero "+ Tarea" and `mesa task create` (`POST /api/tasks`), Nuevo pedido (`POST /api/tickets` with `andres_asks`, which also creates the card on the Claude lane). "Dárselo a Claude" (`POST /api/tasks/:id/dispatch`, or `action: dispatch` in the batch) does the same for an existing card, including cards of ingested items. Handing a card to Claude creates, in one transaction, an `andres_asks` ticket owned by `lead`, linked both ways (`tickets.task_id`, `tasks.ticket_id`), sets the card's `wait_on` to `claude`, and emits one `ticket.created` wake `{ ref, ticketRef, taskId, kind? }` (`kind` review|request|investigation|reply: given, or `review` when the card links a GitHub PR). Rules: idempotent (a card with an open ticket returns it, `created: false`, no second wake; a closed ticket lets it dispatch again); sample cards are refused (409; skipped in a batch); cards created from ingested items (`itemIds`, e.g. Hoy "Crear tarea") never auto-dispatch; dispatching writes only to Mesa, nothing goes to Slack, Basecamp or GitHub.

**Batches and grouping.** Handing 2+ NEW cards to Claude in one call (Tablero "Dárselas a Claude", `action: dispatch`; Hoy "Abrir tarea y pasar a Claude", `action: dispatch_items`, which first makes the card of every item that has none the way "Crear tarea" does) opens exactly the same tickets, one per card, but suppresses their `ticket.created` and wakes `lead` ONCE with `ticket.batch { batchId: "bt_…", origin: hoy|tablero|cli, tickets: [{ ticketRef, taskId, title, kind?, urls }] }` (`entityId` = the first new ticket; existing and sample cards are never listed; the response carries `batchId`, null when no batch wake was sent). Exactly one new ticket keeps the plain `ticket.created`; none wakes nobody. The lead then groups same-topic tickets: `mesa ticket fold <primary> <ref>... --why W` (`POST /api/tickets/:id/fold`, one transaction) re-points every card of the folded tickets to the primary (`tasks.ticket_id`) and moves it to the primary card's station, copies their refs to the primary (deduped by target) plus a ticket ref to each, posts ONE informational message on the primary ("Agrupé: t25 «título», … porque W", no status change), and closes each folded ticket with "Agrupado en tN: W" and a ticket ref to the primary (label `Agrupado en`, which is how unfold knows) with no wake and no card move; 409 on a closed, sample or `claude_asks` ticket, or when `from` holds the primary. `mesa ticket unfold <primary> <ref>` (`POST /api/tickets/:id/unfold`) undoes one: the ticket reopens unclaimed, its original card (`tickets.task_id`) points back at it, both tickets say so ("Separé tN de este ticket" / "Separado de tM"), and the lead gets `ticket.created { ref, ticketRef, taskId, kind?, splitFrom }`; 409 when it was not folded into that primary. The card follows the ticket on every status change: all cards with `tasks.ticket_id = T` move (plus `tickets.task_id` while that card has no ticket or points at T), so a primary moves its grouped cards and a folded ticket moves none. No migration: fold lives in `tasks.ticket_id`, `ticket_refs` and messages.

### Approval

`pending` → `decided` (allow | read_config | deny) by a decision before `expires_at`, or → `expired` at `expires_at` (lazily and by the sweeper). Decisions are final: a second decision, or any decision after expiry, is refused (409). Only `allow` lets the call run.

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

The reviewer agent first opens the review with `mesa review open <ref> --repo owner/name --pr N --sha <head>` (`POST /api/tickets/:id/reviews`; the sha is required, the call is idempotent, a new head reopens an approved review), so a clean pass with zero findings still gets its card with Approve. It then upserts findings with `mesa finding upsert <ref> --json -`, keyed by `repo`, `pr` and `n`. Andrés's buttons call `POST /api/reviews/:id/actions`:

| Action | Effect | GitHub write |
| --- | --- | --- |
| `approve` | refused while open blockers exist | github_review APPROVE salida |
| `approve_anyway` | waives every open finding | github_review APPROVE salida |
| `post {findingNs}` | the chosen findings become inline comments; each text is the summary plus the explanation, as shown on the card | ONE github_review salida per decision (REQUEST_CHANGES when any posted finding is a blocker, else COMMENT), with `destination.comments[]` |
| `dismiss {findingNs}` | finding → dismissed | none |
| `explain {findingNs}` | asks the reviewer for more | none |

GitHub salidas may have an empty body only for an APPROVE review (pr-review approves with no comment) or a batched review whose text lives in `destination.comments[]`. `inReplyTo` (a comment id) on the destination or on a comment makes the reply land in the existing review thread.

The button press is the approval of the exact text and destination shown on the card. The salida is therefore created already approved and enters the 20 s undo window. Every action wakes the ticket owner with `review.action {action, repo, pr, findingNs, salidaIds, note, ticketRef}`. After sending, the lead records the comment id with `mesa finding upsert` (`ghCommentId`).

## 7. Permission approvals (hook)

`scripts/hooks/mesa-approval.mjs` is a Claude Code **PermissionRequest** hook for the sessions that work in `G:/WorkSpace/designli`. Register it in that project's `.claude/settings.json`. Its timeout must be longer than `MESA_APPROVAL_TIMEOUT_MS` (default 540 s):

```json
{ "hooks": { "PermissionRequest": [ { "matcher": "*", "hooks": [ { "type": "command", "command": "node G:/WorkSpace/designli/ops/scripts/hooks/mesa-approval.mjs", "timeout": 600 } ] } ] } }
```

1. It reads the hook JSON and builds the card: tool, summary, diff or exact command, and cwd. It also collects the closest allow rules from `.claude/settings.json`, `.claude/settings.local.json` and `~/.claude/settings.json`.
2. For the lead (`MESA_APPROVAL_LEAD=1`) it first reads `GET /api/lead/focus`; the ticket named there replaces the missing ticket. It files `POST /api/approvals {ticketRef: $MESA_TICKET, agent: $MESA_AGENT, tool, summary, detail, cwd, hints, expiresAt}`. The card shows in the ticket thread, or on Hoy when there is no ticket.
3. Tests: `scripts/hooks/test/mesa-approval.test.mjs`, run by `pnpm test:team` (part of `pnpm test`). Agent identity comes from the spawn name (in-process teammates share the lead's environment); `MESA_AGENT`/`MESA_TICKET` apply to separately launched sessions.
4. It long-polls `GET /api/approvals/:id?wait=25` until the approval is decided or expired, then prints the decision:
   - A decision counts only when `decidedBy` is `andres` (the UI routes stamp it); any other value is a deny with that reason.
   - **Dar permiso** (`allow`) → `{behavior: "allow"}` for this one call.
   - **Lee tus configuraciones** (`read_config`) → deny with a fixed message: read your own allow rules and retry with an allowed command shape instead of asking. The message includes the closest rule.
   - **Denegar** (`deny`) → deny with Andrés's optional note.
   - Timeout → deny, telling the agent not to retry and to post a ticket question instead.
5. An unreachable Mesa, bad input or any crash is a deny. The output never contains `updatedInput` or `updatedPermissions`, so no standing rule is ever created.

## 8. REST API

JSON in and out. Errors: `{ error: { code, message, details? } }` with 400 `invalid_request|invalid_json`, 404 `not_found`, 409 `invalid_transition`, 413 `too_large`, 500 `internal`. Every request first runs the sweep. Request schemas: `src/lib/api/schemas.ts`. Response types: `src/lib/domain/types.ts`. The endpoints for agents, approvals, reviews and health wrap their payload in a named key (`{ brief }`, `{ handoffs }`, …).

| Method & path | Body / query | Response |
| --- | --- | --- |
| GET `/api/health` | | `{ ok, now }` |
| GET/POST `/api/pairing` | (PC only; 403 `local_only` through the tunnel) | `{ publicUrl }` / `{ url, code, expiresAt }` 201 (409 `no_public_url` without `MESA_PUBLIC_URL`) |
| GET `/api/counts` | | `Counts` (rail, stations, pending approvals) |
| GET/POST `/api/items` | `?station=&source=` / `ItemInput` | `Item[]` / `Item` 201 |
| POST `/api/items/upsert` | `ItemInput` (by source + externalId) | `{ item, created }`, or `{ ignored: true, created: false }` (200, nothing stored) for an ignored project |
| GET/POST `/api/ignored-projects` | / `{ source: github|slack|basecamp|claude|*, project, label? }` | `(IgnoredProject & { hidden: { items, tasks } })[]` / `{ ignored, created }` 201 (200 when already ignored) |
| DELETE `/api/ignored-projects/:id` | | the removed `IgnoredProject` (its items and tasks come back) |
| GET/PATCH/DELETE `/api/items/:id` | `ItemPatch` | `Item` / 204 |
| POST `/api/items/:id/skip` | | `Item` (done, waitOn none, `skippedAt` set; 404 on an unknown id) |
| POST `/api/items/:id/unskip` | `{ station, waitOn }` | `Item` (both restored, `skippedAt` null; 404 on an unknown id) |
| GET/POST `/api/tasks` | `?station=&source=` / `TaskInput & { noteOnly?, kind? }` | `Task[]` / `Task & { ticket: { id, ref } \| null }` 201 (dispatched unless `noteOnly`, ingested items or samples) |
| POST `/api/tasks/batch` | `{ action: move, ids, station }` · `{ action: dispatch, ids, kind? }` · `{ action: dispatch_items, itemIds, kind? }` (Hoy: each item's card, made when it has none) · `{ action: restore, moves: [{ id, station }] }` | move/restore: `{ tasks, previous: [{ id, station }] }`; dispatch/dispatch_items: `{ batchId, results: [{ task, ticket, created }], skipped: [{ id, reason }] }` (2+ new tickets wake the lead once with `ticket.batch`; a sample item is skipped with no card). One transaction (an unknown id rolls back, 404), one `/api/stream` change, stamps `lastInteractionAt` |
| POST `/api/tasks/:id/dispatch` | `{ kind? }` | `{ task, ticket: { id, ref }, created }`; 409 for sample cards |
| GET/PATCH/DELETE `/api/tasks/:id` | `TaskPatch` | `Task` / 204 |
| POST `/api/tasks/:id/move` | `{ station, position? }` | `Task` (sync pending) |
| POST `/api/tasks/:id/sync` | `{ syncState, ghItemId?, ghContentUrl?, syncError? }` | `Task` |
| POST `/api/tasks/:id/items` | `{ itemIds }` | `Task` |
| GET/POST `/api/tickets` | `?status=&open=1` / `TicketInput` | `Ticket[]` / `TicketDetail` 201 (`andres_asks` also gets its card, `taskId`) |
| GET `/api/tickets/:idOrRef` | | `TicketDetail` |
| GET `/api/tickets/:ref/context` | `?messages=20` | `TicketContext` |
| GET/PUT `/api/tickets/:ref/brief` | PUT `BriefInput` | `{ brief }` |
| GET/POST `/api/tickets/:ref/handoffs` | POST `{ agent, role?, status, body?, done?, remaining?, artifacts? }` | `{ handoffs }` / `{ handoff }` 201 |
| GET/POST `/api/tickets/:ref/findings` | POST `FindingInput` (upsert) | `{ findings }` / `{ finding }` |
| POST `/api/tickets/:id/messages` | `{ author, body?, options?, recommended?, recommendation?, chosen?, refs?, session? }` | `TicketDetail` |
| POST `/api/tickets/:id/plan` | `{ actions, session? }` | `TicketDetail` |
| POST `/api/tickets/:id/plan/approve` | `{ reject? }` or `{ only: [actionId] }` | `TicketDetail`; works on any non-closed status that still has planned steps. `only` pre-approves just those needs_ok steps (wake `ticket.plan_approved { approved, partial: true }`, status unchanged while others stay planned; the full approval once none remain) |
| POST `/api/tickets/:id/permission-request` | | `TicketDetail`; "Pídeme permiso": posts the marked andres message, wakes the owner with `ticket.permission_requested { ref, ticketRef, messageId }`, hands a waiting_andres ticket to Claude; 409 on a closed ticket |
| POST `/api/tickets/:id/fold` | `{ from: [id\|ref], why, session? }` | `TicketDetail` (the primary); the lead groups a `ticket.batch`, see "Batches and grouping"; 409 on a closed, sample or `claude_asks` ticket, or `from` holding the primary |
| POST `/api/tickets/:id/unfold` | `{ ticket: id\|ref }` | `TicketDetail` (the reopened ticket); emits `ticket.created { …, splitFrom }`; 409 when it was not folded into `:id` |
| POST `/api/tickets/:id/transition` | `{ event: claim\|close\|reopen, by?, session? }` | `TicketDetail` |
| POST `/api/tickets/:id/attachments` | multipart `file`, `messageId?` | `Attachment` 201 |
| PATCH `/api/actions/:id` | `{ state: running\|done\|failed }` | `PlannedAction`; 400 for any other state. A needs_ok step in state `approved` was pre-approved by Andrés, so the owner runs it without asking again |
| GET `/api/handoffs` | `?agent=&ticket=&limit=` | `{ handoffs }` newest first |
| GET/POST `/api/team` | `?status=live\|retired&ticket=` / `{ ticketRef, agent, role, owner? }` | `{ agents }` / `{ agent }` 201 |
| POST `/api/team/:name/retire` | | `{ agent }` |
| GET/POST `/api/approvals` | `?status=&ticket=&hoy=1` / `ApprovalInput` | `{ approvals }` / `{ approval }` 201 |
| GET `/api/approvals/:id` | `?wait=SECONDS` (≤ 55) | `{ approval }` |
| GET/PUT/DELETE `/api/lead/focus` | `{ ticket }` (PUT) | `{ ticketRef, expiresAt }`; the ticket the lead acts on (`mesa lead focus`): the hook files the lead's prompts there; PUT sets or renews a 2 h window; 404 unknown, 409 closed; an expired window or a closed ticket reads as null; Hoy, Permisos shows it with "Quitar foco" |
| POST `/api/approvals/:id/approve` · `/read-config` · `/deny` | `{ note? }` (the UI's three buttons; they stamp `decidedBy: "andres"`, the only decisions that exist) | `{ approval }`; 409 after expiry or once decided |
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
| GET `/api/sources` | | `{ sources: { slack, basecamp, …: SourceState }, lastInteractionAt }` (slack and basecamp always present) |
| GET/PATCH `/api/sources/:source` | PATCH `{ health?, note?, watermark?, lastChecked?, lastNewAt?, backoffUntil?, cadenceS?, errorCount?, lastError? }` | `{ source }` / `{ source, resumed }` |
| POST `/api/sweep` | `{ sources? }` | `{ event }` 202 ("Barrer ahora": wakes session `sweeper`) |
| GET/POST `/api/sessions` | `{ id, label?, cwd?, project? }` | sessions / `Session` |
| GET `/api/wait` | `?session=&after=&timeout=&peek=1` (peek never acks) | `{ events, cursor }` |
| POST `/api/wait/ack` | `{ session, cursor }` | `Session` |
| GET/POST `/api/engram/links` | | `EngramLink[]` / `EngramLink` 201 |
| GET `/api/engram/search` | `?q=&project=&limit=5` | `{ status: connected\|offline, observations: { id, type, title, createdAt, project }[] }` (engram CLI, titles only, always 200) |
| GET `/api/stream` | | `text/event-stream`: `event: change` `{ entityType, entityId, kind }` per write; `useLive()` / `useLiveRefresh()` in `src/lib/live/useLive.ts`. When the stream fails no screen callback runs (router.refresh() hard-navigates when its fetch fails): the hook probes `/api/health` until it answers, reopens the stream and delivers one `reconnect` change; if the stream cannot be held on a healthy server it polls, each tick gated on `/api/health` |
| POST `/api/github/sync` | | `{ ingest, project }`: notifications, review requests, Project push and pull now |
| GET `/api/github/status` | | `{ enabled, project, github, githubProject }` |
| POST `/api/github/import-reviews` | | `{ prs, findings, skipped }` from pr-monitor's state file (read only) |

Salida events over HTTP: `propose`, `approve {version, mode?}`, `undo`, `sent {permalink?}`, `drafted`, `confirm_sent`, `failed {error}`, `retry`, `deny`, `schedule {at, version, mode?}`, `unschedule`, `request_delete`, `deleted`, `request_restore`, `restored`, `hold {reason}`, `unqueue`, `bounce {reason}`. `release`, `expire` and `resume` are internal (sweeper, health).

Browser notifications (`src/features/notify/`, no server part): the `Notifier` mounted in `AppShell` listens to `/api/stream` (`useLive`, ticket, salida, review, approval; its 5 s poll fallback too) and re-reads `GET /api/tickets?status=waiting_andres`, `/api/salidas?status=pending` and `/api/approvals?status=pending`, because frames carry no state. The pure `decide()` turns that set plus the seen keys into the notifications to show (`ticket:<id>` while it waits, `salida:<id>:v<n>`, `approval:<id>`), so an undo (same version), a reload or a second tab never repeats one. The seen keys live in localStorage (bounded); every tab scans on its own pokes under a `navigator.locks` lock on the seen keys, so each entry is shown once even when one tab's stream is down, and none is shown while a visible, focused tab is looking. A tab also stores the time of its last scan: a load within 10 minutes of it (a reload, the hard reload after a Mesa restart) starts with a normal scan, an older or missing record (first enable, long-closed browser) with a silent baseline. Each notification is created with `requireInteraction` (it stays until clicked) and the tab that shows a batch plays a short WebAudio chime (`chime.ts`, unlocked by the first click or key press of the tab) unless the rail switch "Sonido" is off (`mesa.notify.sound`, default on). The permission is asked only from the rail control "Activar avisos".

## 9. Wake protocol and CLI

**Wake (long-poll):** the lead blocks on `mesa wait` (`GET /api/wait?session=lead`). The server answers as soon as there are events after the session's cursor (targeted or broadcast), or with `[]` after `timeout`.
- **Delivery is at least once.** `mesa wait` acks a batch after printing it (`--manual-ack` leaves it to `mesa ack <cursor>`), so a handler must check current state before it acts. Waiters inside a command (`ticket ask --wait`, `salida propose --wait-release`) poll with `peek=1`, which never acks. Events older than 7 days are pruned hourly. `docs/SESSIONS.md` is the session guide.
- **`ticket.created`** payload: `{ ref, ticketRef, taskId, kind? }`, targeted at `lead` for dispatched cards and Nuevo pedido. The lead triages by `kind` (TEAM.md § 4), claims, spawns the owner and records the team; handlers check the ticket first (at least once).
- **`ticket.batch`** payload: `{ batchId, origin: hoy|tablero|cli, tickets: [{ ticketRef, taskId, title, kind?, urls }] }`, targeted at `lead`, sent instead of N `ticket.created` when 2+ new tickets open in one call (Hoy "Abrir tarea y pasar a Claude", Tablero "Dárselas a Claude"). The tickets are already open and owned by `lead`; the lead groups and routes them (`mesa-start` § 5, TEAM.md § 4 Batches). Handlers check every ticket first (at least once).
- **Kinds:** `ticket.created|batch|answered|plan_approved|closed|reopened`, `salida.turn|released|queued|undone|denied|delete_requested|restore_requested`, `review.action`, `sweep.requested`, `task.moved` (reserved; the UI gets task moves from `/api/stream`).
- **On `salida.released`:**
  1. `mesa salida show <id>`.
  2. If `recheckThread` is set, re-read the thread and `bounce` if it changed.
  3. Send `versions[approvedVersion-1].body` to exactly `destination`. Slack: by the event's `mode`, `draft` = one `slack_send_message_draft` (`channel_id` = `destination.channelId`, `thread_ts` = `destination.threadTs`), `send` = one `slack_send_message` with the same fields. Guardrail G5 passes each tool only for a released, unsent salida in that mode with exactly that text and target.
  4. Report with `mesa salida sent|drafted|failed|hold`. A failed draft call (a draft already in that channel, any tool error) is `hold --reason "<clear reason>"`, never a direct send.
- **On `sweep.requested`** (sent to the sweeper session, `MESA_SWEEPER_SESSION`, default `sweeper`): run the sweep for the listed sources now, ignoring `backoff_until`.

**Sweep tick (lane C):** the haiku sweeper runs about every 60 s per source in two stages. A cheap probe compares the source against `watermark`. When the probe finds something new, a full triage upserts items (`mesa item upsert`, deduped on `(source, external_id)`). The sweeper then writes back `watermark`, `lastChecked`, `lastNewAt`, `health`, and an adaptive `cadenceS`/`backoffUntil` with `mesa source set`: It backs off while a source is quiet or failing. It goes back to 60 s when something new arrives or when `lastInteractionAt` shows Andrés is active.

**CLI (`bin/mesa`, `bin/mesa.cmd`):** zero-dependency Node over the REST API.
- Env: `MESA_URL`, `MESA_SESSION`, `MESA_AGENT`, `MESA_TOKEN`.
- Output: JSON on stdout, errors on stderr (exit 1, usage exit 2). `--body -` reads stdin.
- Commands (`node bin/mesa help` lists them all): `session`, `wait [--once|--loop]`, `ticket ask|reply|plan|claim|close|action|show|list|context|brief|handoff`, `handoff`, `handoffs`, `team add|join|retire|spent|list`, `finding upsert|list`, `review open|list|show`, `approval show`, `salida propose|version|sent|drafted|failed|hold|bounce|deleted|restored|show|list`, `source get|set`, `sweep`, `task create [--note-only]|dispatch|list|move`, `item upsert|skip`, `engram link`.
- Missing on purpose: there is no approve (and so no Slack mode), schedule, deny, undo or "Ya lo envié" for salidas, and no decision for approvals. Those are Andrés's buttons.

## 10. Design system in code

- `src/styles/tokens.css`: every DESIGN.md token as a CSS custom property, Tokio on `:root`, Grafito on `[data-theme="dark"]`, plus semáforo `--keep-*`, `--redo-*`, `--drop-*`, `--shade`, radii, spacing, layout widths. Names match the mocks (`--gnd`, `--raise`, `--gh`, …); the header maps them to DESIGN.md names.
- `src/styles/components.css`: shared classes from the mocks (`.btn`, `.ap3`, `.chip`, `.lk`, `.st`, `.kind`, `.k`, `.ln`, `.ring`, `.s-*`/`.sv-*`, `.tabs`/`.tab`, `.ctx`, `.msg`, `mark.m-*`, `.alert`, `.sheet`, `.toast`). `.src-<source>` sets `--c`, `--t`, `--ci`.
- `src/components/ui/primitives.tsx`: `Btn`, `Chip`, `LinkChip`, `StatusTag`, `Kind`, `Label`, `ContextQuote`, `ExactText`, `Alert`. `interactive.tsx`: `SplitApprove`, `Tabs`, `Sheet`, `ToastProvider`/`useToast`, `ThemeToggle` (+ `THEME_BOOT`).
- `src/components/line/Line.tsx`: `SourceDot`, `LineStub`, `Ring`, `Interchange`, `DirectionMarker`, `BrokenLine`, `BrandMark`.
- `src/components/shell/*`: `AppShell`, `Rail` (counts, source health slot, theme toggle), `PhoneTabs`, `ScreenFrame` (temporary).
- `src/lib/motion`: `layLines`, `arrive`, `rise`, `riseSheet`, `riseBar` (docked bars, e.g. the Tablero batch bar), `lift` (a selected card rises 2 px), `confirmPick`, `paintMarks`, `travel`, `pressable`, hooks `useLayLines`, `useArrive`, `usePress`, `useLift`, `useRise`. All of them respect `prefers-reduced-motion`.
- `/kit` renders every shared component.

## 11. Security

- **Local first.** The server binds `127.0.0.1:8790` (`pnpm dev` and `pnpm start` go through `scripts/serve.mjs`; `MESA_HOST` overrides, and `0.0.0.0` is an explicit decision), so nothing on the LAN reaches the port. `src/proxy.ts` (policy in `src/lib/access.ts`) treats a request as local only when its Host is loopback AND it shows no sign of a proxy: none of `Cf-Access-Jwt-Assertion`, `Cf-Visitor`, `Forwarded`, `X-Real-IP`, `Via`, `CF-*`, and no `X-Forwarded-*` value that differs from what Next fills in for a direct connection (Host as host, a loopback client, `http`, the Host's port). Gotcha: Next 16 sets all four `X-Forwarded-*` itself on every request before the proxy runs, so their mere presence cannot be the test. The Host check is never a boundary on its own. `?token=` does not exist: the token never travels in a URL.
- **Phone access: Cloudflare Tunnel + Cloudflare Access, two keys.** A named cloudflared tunnel (`MESA_CF_TUNNEL`, default `mesa`) maps `MESA_PUBLIC_URL` (https://mesa.<his domain>) to `http://127.0.0.1:8790` with a catch-all 404 (`pnpm tunnel up` writes the config to `~/.cloudflared`, never into the repo, and holds no credentials). A Cloudflare Access app on that hostname lets only his email in (suggest a 30-day session). **Key 1** is the Access JWT, verified by Mesa itself, not trusted from the header's presence: `src/lib/cf-access.ts` takes `Cf-Access-Jwt-Assertion` (or the `CF_Authorization` cookie), checks the RS256 signature with WebCrypto against `https://<MESA_CF_ACCESS_TEAM>/cdn-cgi/access/certs` (keys cached 10 min, refetched at most once per 30 s on an unknown `kid`), `iss` = the team URL, `aud` contains `MESA_CF_ACCESS_AUD`, `exp`/`nbf`, and `email` = `MESA_CF_ACCESS_EMAIL` (case-insensitive). It fails closed: any missing variable, unreachable keys or failing check is a 403, public paths included. No new dependency; the proxy runs on the Node runtime. **Key 2** is the `MESA_TOKEN` cookie (401 without it), required everywhere except the public shell and `/pair`. The phone gets the cookie from `/pair`: `POST /api/pairing` (PC only) mints one pairing: a long code (32 random bytes) in the QR link `MESA_PUBLIC_URL/pair?c=<code>` and an 8-character short code (alphabet without 0/O/1/I/L) shown next to it; both are the same single use, expire in 10 minutes, and only their SHA-256 is stored (`phone_pairings`). A page load that passes Access but has no cookie gets a small Spanish page with a field for the short code (`POST /pair`; an installed iOS app may not share Safari's cookie jar, so pairing has to work inside it). 5 wrong tries in 10 minutes block redeeming (429; `pair_failures`). `/pair` sets `mesa_token` (httpOnly, Secure, SameSite=Strict, 30 days). The token is never shown, copied or put in a URL or chat. `pnpm tunnel status` probes `https://<host>/` with no credentials and requires Cloudflare Access to answer (redirect to `cloudflareaccess.com`, or a Cloudflare 403); if Mesa answers (its `x-mesa-guard` header, a Next.js response, a 2xx) it exits 3, `up` refuses to start (and stops a tunnel it started), and mesa-start treats exit 3 as a stop.
- **One-time setup, all `needs_ok`, done with Andrés in this order:** (1) install cloudflared; (2) `cloudflared tunnel login` with the Cloudflare account that owns his domain (not Designli's); (3) `cloudflared tunnel create mesa`; (4) **create the Access app for `mesa.<domain>` (one policy: his email; session 30 d) BEFORE the DNS route**; (5) `cloudflared tunnel route dns mesa mesa.<domain>`; (6) put `MESA_PUBLIC_URL`, `MESA_CF_ACCESS_TEAM`, `MESA_CF_ACCESS_AUD`, `MESA_CF_ACCESS_EMAIL`, `MESA_TOKEN` in `.env.local` and restart Mesa; (7) `pnpm tunnel up` (or install the Windows service with the generated `~/.cloudflared/<tunnel>-mesa.yml`); (8) `pnpm tunnel status` must exit 0. No Cloudflare API token is ever stored in the repo.
- **PWA under Access.** `/manifest.webmanifest` (a route handler, `src/app/manifest.webmanifest/route.ts`), the icons (`scripts/make-icons.mjs`, drawn from the BrandMark), `sw.js` and `offline.html` need no Mesa token (they hold no data) but, like everything else, they need the Access JWT. A browser fetches `<link rel="manifest">` without cookies unless the link says `crossorigin="use-credentials"`, and Access would answer that fetch with its login redirect and break installability; `src/app/layout.tsx` therefore emits the link itself with `crossOrigin="use-credentials"` (Next's own manifest convention does not, so the file convention is not used). Same-origin icon and `sw.js` requests carry the `CF_Authorization` cookie. Fallback if a phone still cannot fetch an icon: an Access Bypass policy limited to exactly the public paths (`/manifest.webmanifest`, `/sw.js`, `/offline.html`, the four icons), which hold no board data. The service worker (`public/sw.js`, scope `/`, production builds only; dev unregisters it) precaches only that shell (one file at a time, so an expired Access session does not fail the install), caches `/_next/static/*`, answers navigations network-first and falls back to `offline.html` ("Sin conexión con tu PC", actions disabled) when the PC does not answer (network error, timeout, 502/503/504/530); it never caches `/api/*` or any HTML with board data and never queues a write. The install banner uses `beforeinstallprompt` on Chrome/Android and a written guide on iOS, hidden when standalone and for 14 days after a dismiss. The phone strip shows "vía túnel", "sin túnel", or "Vuelve a entrar" (with an Entrar button that reloads into the Access login) when the health ping is redirected to Access or refused (403).
- **No secrets in the repo, and no Slack or Basecamp credentials at all.** Those connectors live in Claude's MCP, and GitHub uses the `gh` login. `.env.local` (gitignored) holds only Mesa settings, which `.env.example` lists. `data/` and `*.db` are gitignored.
- **Every outgoing write needs Andrés's explicit approval of the exact text and destination.** Slack and Basecamp messages and GitHub reviews/comments are salidas, and the review buttons approve the exact text shown on the card. Mesa refuses `sent` and `drafted` before the 20 s undo window ends. For Slack the approval click also picks the mode: Aprobar leaves a draft Andrés sends himself; "Aprobar y que Claude lo envíe" sends through the connector with its "Sent using @Claude" footer.
- **Permission approvals allow one call at a time.** Allow comes only from an explicit "Dar permiso" before expiry. Everything else is deny, and the hook never emits `updatedPermissions`.
- **Approval rules are only partly enforced by the API.** The local API does not authenticate callers, so "sessions and agents never approve, schedule, deny, undo or decide" rests on CLAUDE.md, guardrail G10 and on the CLI having no such commands. What holds: the only routes that decide an approval are the UI's approve / read-config / deny (decidedBy `andres`), and the hook honours a decision only with `decidedBy` `andres` (anything else is a deny). What does not: those three routes have no credential, so any local process (a script, browser automation, or a shell shape G10 misses) that calls one counts as Andrés. G10 is partial (literal loopback host and port, curl-style tools only; it misses `$MESA_URL`, other host spellings, doubled slashes, quoted or spliced segments and disguised tool names, see docs/TEAM.md section 6), and it also covers `permission-request`. That is the known residual risk until improvement 13; hardening is on hold.
- **Uploads** are stored under `data/uploads/<ticket>/` with sanitized names and a 25 MB cap.
- **Sample data is labelled** (`is_sample`) and shown with "Datos de muestra.".

## 12. GitHub, server side (lane C)

`src/lib/integrations/github-worker.ts`, started from `src/instrumentation.ts`. It runs with Andrés's `gh` login (the token is read from gh's keyring for `MESA_GH_USER`, default `acorrea-designli`, and passed only to the child process; nothing is stored). It is enabled when `MESA_GITHUB=on`, or when neither `MESA_GITHUB` nor `MESA_DB` is set (the real board). Dev servers on scratch databases stay off GitHub unless they opt in.

- **Notifications** (`github-ingest.ts`): `GET /notifications` with `If-Modified-Since` (the last `Last-Modified`, kept as `source_state.github.watermark`), never sooner than `X-Poll-Interval` (floor 60 s, kept as `cadenceS`). A 304 costs nothing.
- **Review requests**: REST search `is:pr is:open review-requested:@me` (GraphQL is left to pr-monitor), when the notifications changed, every 5 minutes, or on `POST /api/github/sync`. Each non-draft PR is an item `{source: github, externalId: pr:<owner>/<repo>#<n>, kind: pr_review, need: approve_pr, project: <owner>/<repo>, excerpt: "+120 −34 · sin revisar"}`. Details (`+/−`, Andrés's last review) are fetched only when the PR's `updated_at` moved. A request that disappears from a complete search moves its item to Hecho; one that comes back returns to the inbox. A release-train PR (title `Create staging|prod|production PR` with both branches in develop, staging, main, master, production, prod; the auto-created one approved at deploy time) is never an item: only a matching title costs the extra branch read (same `pulls/<n>` GET), the PR is not `seen` (an older item moves to Hecho) and `skippedRelease` counts it.
- **Health**: success sets `github` ok; a rate limit sets degraded with note `límite de API · HH:MM` and waits for the reset; auth or a missing `gh` sets down.
- **GitHub Project** (`github-project.ts`): the private Project "Mesa" owned by `acorrea-designli`, created only when missing. Its Status field carries Inbox, Todo, In Progress, Waiting, Done (existing option ids are kept). Settings: `gh_project.id`, `.number`, `.url`, `.owner`, `.status_field_id`, `.status_options` (name → option id), `.known_items`, `.last_pull_at`. Push (every 5 s when there are pending tasks): a task without `gh_item_id` becomes a **draft** item (`gh project item-create`: title, then a body with the excerpt, `Proyecto: <project>`, the linked PR or issue URL as plain text and `Mesa: <taskId>`); then its Status is set and `markSync(synced)` clears "Sin sincronizar". A task moved again while the write was in flight stays pending. Write errors mark the task `error`; a missing `project` scope sets `github_project` down ("sin permiso": run `gh auth refresh -s project`). Pull (every 2 min): a Status changed in GitHub moves a synced task and its items; a pending local move wins until acked; draft items added in GitHub become tasks once (items of tasks deleted in Mesa are never re-imported); PR and issue items added by hand are counted (`skipped`), recorded in `.known_items` and never imported nor edited. **Drafts only, never linked content:** Mesa never adds a PR or issue to the Project (`item-add` / `addProjectV2ItemById` link a client PR and write a timeline event on it at every card move). `guardProjectGh` refuses those calls (and `linkProjectV2*`) with a thrown error before gh runs, `gh_content_url` stays null for items Mesa creates, and migration `0320` cleared the content links the earlier mirror left (those tasks got a fresh draft). Sample tasks never leave Mesa.
- Mesa never writes PR reviews or comments: those are salidas the lead sends.
- **Sandbox** (`MESA_ENV=sandbox`, `docs/SANDBOX.md`): the worker never starts and `POST /api/github/sync` answers 409 `sandbox`.
