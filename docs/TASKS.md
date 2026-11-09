# Mesa: remaining work in three lanes

The foundation (`feat/foundation`) ships the app shell, design system, SQLite schema, repositories, REST API, wake protocol, CLI, placeholder screens, and the data/API layer for ephemeral agents (briefs, handoffs, team, resume payload), permission approvals (with the PermissionRequest hook), PR reviews and source health. The rest splits into three lanes that can run in parallel. Read `CLAUDE.md` and `docs/ARCHITECTURE.md` first.

Chosen variants (from `.impeccable/mocks/screens/*.md`, the `*.html` next to each is the approved mock):

| Screen | Variant | Mock |
| --- | --- | --- |
| Hoy | single | `hoy.html` |
| Tablero | **B** carriles por fuente | `tablero.html` (`data-variant="b"`) |
| Tickets | **A** lista + hilo | `tickets.html` |
| Salidas | **B** una por una, orden libre, queue strip | `salidas.html` |
| Teléfono | **A** corredor + the `#paridad` block | `telefono.html` |
| Estados | **B** aviso en el riel | `estados.html` |
| Motion | all screens | `motion.md`, `mesa-motion.js` |

Ignore `.impeccable/live/` and the `impeccable-live` script tags.

## Ownership rules

- Each lane owns the files listed under it. Do not edit another lane's files; ask in its PR or open a tiny PR against `main`.
- **Shared (frozen, change by small PR to `main` that every lane rebases on):** `src/styles/*`, `src/components/ui/*`, `src/components/line/*`, `src/lib/domain/*`, `src/lib/db/*`, `src/lib/repo/*`, `src/lib/api/*`, `src/lib/motion/*`, `scripts/hooks/mesa-approval.mjs`, `db/migrations/0001_init.sql`, `db/migrations/0002_agents_approvals_reviews.sql`, `package.json`, configs. Adding a new shared primitive is fine in a small PR; restyling an existing one is not.
- New migrations use a per-lane number range so they never collide: lane A `01xx_*.sql`, lane B `02xx_*.sql`, lane C `03xx_*.sql`. Never edit an applied migration.
- Screen CSS goes in CSS modules or a CSS file inside the lane's folders. Reuse the shared classes (`.btn`, `.chip`, `.st`, …); do not redefine them.
- Feature code lives in `src/features/<screen>/` (components, client hooks, read models). Pages in `src/app/<route>/page.tsx` stay thin.
- Use sample data only through lane C's seed, labelled "Datos de muestra." Never fabricate real-looking PRs, clients or messages in code.
- Branch + PR per lane: `feat/hoy-tablero` (A), `feat/tickets-salidas` (B), `feat/integrations` (C). Commits follow `CLAUDE.md`.

## Cross-lane contracts

- **`<SalidaApproval salidaId compact />`** (lane B, `src/features/salidas/SalidaApproval.tsx`): the approval block (kind line, destination route/chips, context, exact text, split approve, Editar, Denegar, undo window). Lane A embeds it in the Hoy detail pane for the "Salidas · esperan tu firma" rows. Until it lands, lane A renders the static mock markup with the shared primitives.
- **Live updates** (lane C, `src/lib/live/useLive.ts` + `GET /api/stream` SSE): emits `{ entityType, entityId, kind }` whenever a repository writes. Lanes A and B call `useLive(cb)` to refresh (`router.refresh()` or refetch). Until it lands, poll with `router.refresh()` every 5 s behind the same hook name (lane C replaces the body).
- **Source state** (foundation: `source_state` table, `GET /api/sources` → `{ sources: {slack, basecamp, …}, lastInteractionAt }`, `GET/PATCH /api/sources/:source`, `repos().sources`, `mesa source get|set`). Lane C adds the server-side GitHub checks and `getSourceHealth()` mapping rows to the rail `SourceHealth` (ok|degraded|down). Lane A wires it into the rail notice (Estados B) and the Hoy states.
- **`<ApprovalCard approval />`** (lane B, `src/features/approvals/ApprovalCard.tsx`): the permission card (agent, tool, summary, diff or command, hints, countdown to expiry) with **Dar permiso**, **Lee tus configuraciones** and **Denegar** (+ optional note) → `POST /api/approvals/:id/approve`, `/read-config` or `/deny` (`{ note? }`). Lane B shows it in the ticket thread; lane A shows approvals without a ticket (`GET /api/approvals?status=pending&hoy=1`) on Hoy.
- **"Barrer ahora"** (lane A button on Hoy → `POST /api/sweep`): wakes the `sweeper` session with `sweep.requested`. The sweep tick (`scripts/sweep-tick.mjs`, mesa-team PR #2) answers it.
- **Engram search** (lane C, `GET /api/engram/search?q=&project=&limit=5` → `{ status: "connected" | "offline", observations: { id, type, title, createdAt, project }[] }`). Lane B renders it in the memory panel.

---

## Lane A: Hoy and Tablero B (desktop + phone)

**Owns:** `src/app/page.tsx`, `src/app/tablero/**`, `src/features/hoy/**`, `src/features/band/**`, `src/features/tablero/**`, `src/components/shell/**` (rail health notice, phone tab bar refinements), migrations `01xx`.

**Hoy (`hoy.html`, `telefono.html` frame 1, `estados.html` B):**
1. Line band (`src/features/band/LineBand.tsx`): four source lines through five station capsules with counts, items as source-coloured ticks, interchange rings joined by a 45° connector for items linked to two sources (same task). Selected station solid on porcelain with a 3.5px outline, everything past it at about 35%. Source filter burns its line and dims the rest. Cap ticks per station with "+N". Fix the sketch defects: the title must not collide with the Inbox label, nor the legend with Esperando.
2. Motion: lines draw in, ticks roll in, rings pop (`useLayLines`); when an item changes station its tick travels along its line (`cubic-bezier(.16,1,.3,1)`), and jumps under reduced motion.
3. Source tabs (`Tabs` with source dots and counts), "Estación: X · por hora".
4. Rows on the fixed grid `52px 112px 1fr 104px 98px` (hora, origen, asunto + excerpt, necesita, estado), 58px, selected row on porcelain. Status tags: Te espera solid, Limpio, Espera a Claude, others outline.
5. "Salidas · esperan tu firma" group; selecting one shows `<SalidaApproval compact>` in the 392px detail pane. Other items show their detail (kind, title, context quote, source link, actions that make sense: open source, move station, create task).
6. Approvals with no ticket appear at the top of Hoy as `<ApprovalCard>` (lane B component); the rail shows pending approvals. "Barrer ahora" button in the Hoy header (`POST /api/sweep`, then a toast "Claude está barriendo Slack y Basecamp").
7. States: "Nada te espera" (band at rest, done ticks at Hecho, Hecho hoy list), "Conecta tus fuentes" checklist (GitHub, GitHub Project, Basecamp, Slack), rail notice for outages (Estados B: Fuentes block in the rail, affected rows "Sin datos", affected line dotted with a 45° slash, approvals during a Slack outage queue as "Aprobar al volver").
8. Phone (≤ 720px): band collapsed to the selected station's corridor (lines solid into the station, dimmed after, next station named at the edge), scrolling station tabs, 66px rows, detail as a full screen with docked actions (primary ≥ 56px), bottom tab bar. Offline phone: "Sin conexión con tu PC", cached view, band greyscale, sign/answer disabled.

**Tablero B (`tablero.html` variant B, `telefono.html` paridad frame 6):**
1. One lane per source with its line running behind its cards, five station columns, header lines passing through station capsules. A quiet lane collapses to one line.
2. Card: line stub (interchange ring when linked to two sources), project, time, title as `h2` (2 lines max), one-line excerpt, link chips (`LinkChip`), wait tag. Hover: edge border + float low. Done cards compact; every column caps cards and ends with "+N más"; Hecho shows 4 + "N más hechas hoy".
3. Move: drag between columns and a keyboard/phone "Mover" menu (bottom sheet with the five stations on phone) → `POST /api/tasks/:id/move`. Show "Sin sincronizar" until `syncState` is `synced`.
4. Sync states: syncing (dot travels the sync track), sync error (alert + header lines dotted, local moves queued), empty column, source filter.
5. Rail Tablero count = open tasks (Inbox + Todo + En curso + Esperando).

**Acceptance (A):**
- [ ] Hoy and Tablero match the mocks in Tokio and Grafito at 1440×900 and 390×844; no horizontal scroll at 390px.
- [ ] Band reacts to station and source filter; counts come from `/api/counts` / repos, not literals.
- [ ] Moving a card updates the station in SQLite, shows "Sin sincronizar", and clears it when lane C acks (`POST /api/tasks/:id/sync`).
- [ ] Reduced motion: no draw/travel/rise; ticks jump; press feedback and fades remain.
- [ ] Keyboard: every row, tab and card reachable and operable; visible focus ring; card titles are `h2`.
- [ ] No text in `--dim`; station counts in `--mute`; no colour used as error/success.
- [ ] `pnpm check` and `pnpm build` pass; component tests for band layout math (tick placement, caps, "+N").

---

## Lane B: Tickets A and Salidas B (desktop + phone)

**Owns:** `src/app/tickets/**`, `src/app/salidas/**`, `src/features/tickets/**`, `src/features/salidas/**`, `src/features/approvals/**`, `src/features/reviews/**`, new routes under `src/app/api/tickets/**` and `src/app/api/salidas/**` that the UI needs (e.g. attachment download `GET /api/tickets/:id/attachments/:attId`), migrations `02xx`.

**Tickets A (`tickets.md`, `telefono.html` paridad frames 4–5):**
1. One stream, never split by direction. 54px rows: `DirectionMarker` (asker line into receiver ring), title, one-line excerpt, status tag, age.
2. Thread pane (520px): question as `h2`, A/B option buttons (recommended outlined in Claude orange), "Claude recomienda B: …", the client's own words, source chips, reply composer (Markdown hint, attach image). Picking A/B fills the reply and sends it (`chosen`).
3. Composer: files by drag, paste and clip as removable chips with size (`POST /api/tickets/:id/attachments`); `@` opens a ticket picker (open tickets and this week's, with their direction line) and inserts ink-bordered ref chips; `/` opens actions.
4. New request ("Nuevo pedido"): text, optional link to PR/recording/thread, project, files, refs. After Claude posts its plan, "Claude va a hacer" lists one row per action coloured by source line, each marked "directo" or "te pide OK"; approve with optional rejections (`POST /plan/approve`). Frequent action chips under the plan.
5. Header indicator "Claude escuchando · te despierta al responder" when the owner session is listening (`GET /api/sessions`); dot travels a short orange track (static under reduced motion).
6. Agents on the ticket: thread meta shows the brief (goal, current step, next action, open questions), the team (agent, role, live/retired) and the handoff log, from `GET /api/tickets/:ref/context`.
7. Permission approvals: `<ApprovalCard>` inline in the thread for each pending approval of the ticket (export it for lane A). Expired cards collapse to "Caducó · el agente preguntará por ticket".
8. Reviews: for tickets with a review, a findings list (label, `at`, summary, explanation, state) with **Approve**, **Approve anyway** (waives open findings), and per finding **Post**, **Dismiss**, **Explain more** → `POST /api/reviews/:id/actions`. Approve is disabled while blockers are open. Post sends the findings selected in one decision as ONE batched review; the card shows every comment text and its file/line before the press, then the 20 s undo like any salida. In Salidas, a github_review shows `destination.comments[]` as its exact text, and an empty-body APPROVE reads "Aprobación sin comentario".
9. States: sin tickets; Claude no escucha (dashed pill + alert; primary becomes "Guardar respuesta"); respondido ("Claude trabaja · despertó 10:47" from `wokeAt`); cerrado (Reabrir); "En engram · <project>" in the thread meta (from `engram` links).

**Salidas B (`salidas.md`, `telefono.html` paridad frames 1–3):**
1. Queue strip: every pending/scheduled salida (source line, destination, first line, age, expiry); any opens on click; J/K or arrows move (no action hotkeys; approve, edit, deny, programar, "Saltar por ahora" and deshacer are buttons only). Counter "3 pendientes · 1 programada". Decided items stay dashed with Enviada/Denegada.
2. Card, two columns. Left: origin strip (ticket + links as line chips joined by rings, "Historial N" toggle), destination as a route in the source colour (Slack: Workspace → Canal → En el hilo de → Publica como; Basecamp: Proyecto → recording or Campfire → Como), "Texto que se enviará" (`ExactText`), version stepper (collapse to v1 · … · starred · … · last three; "…" opens the version list where any two can be diffed; stars; "Volver a vN"), one-line diff vs the previous version, `SplitApprove` with the version number, Editar (manual edit → "tu versión"), Denegar. Right: Historial + "Afinar con Claude" on top, "Memoria · engram" below (two scrolling halves).
3. Refine chat: compact turns, older turns fold into "N vueltas anteriores · ver", input "Pídele un cambio a Claude…" + Enviar, learned chips (`GET /api/chips`, hover "agrupa: …", cold start "Aquí aparecerán tus pedidos frecuentes"), after 8 versions "¿Lo escribes tú? Editar a mano". While a turn is open: pending vN dashed in Claude orange, Aprobar/Editar disabled, "Cancelar el cambio".
4. Semáforo: selecting text in the exact-text block (drag, double-click, touch) snaps to words and opens the fixed toolbar Mantener / Reformular / Quitar / Limpiar (K/R/Q/Esc). Marks are `<mark class="m-keep|m-redo|m-drop">` rebuilt from a per-character model; overlaps split cleanly. While marks exist, a chip above the input reads "Con marcas: 3 mantener · 2 reformular · 1 quitar ×", the inline diff hides, and Enviar sends text + marks as one turn (works with marks and no text) and consumes them. Next version shows kept marks on identical text.
5. Undo and delete: approve → "Enviando en 20 s · Deshacer" with the tick travelling the source line (`travel()`), Z undoes; then the next pending item opens. Sent: permalink + delete per `DELETE_POLICY` (Basecamp comment "Eliminar mensaje" → trash 25 días → "Eliminado · Restaurar"; Campfire "Eliminar" with a permanent warning; Slack disabled with "Slack no permite borrar desde Mesa todavía · ábrelo en Slack" + "Abrir en Slack", and the countdown says the undo window is the only way back).
6. Programar: ▾ menu or P → time picker (Hoy 16:00 · mié 9:00 · mar 9:00 · custom) → "Sale mar 9:00 · Cambiar · Cancelar", text locked as "Texto programado", clock mark in the strip.
7. Memoria panel: status dot (solid connected, dashed ring offline), "Buscar en la memoria", up to 5 observations matched from the ticket title (type chip, title, age; never bodies), "aplica a este mensaje" with a 45° stub to the phrase (hover outlines it), pinned footer "Registrado en engram · …". States: engram caído (signing never blocked), nada relacionado.
8. Other states: enviando, enviado, falló (retry), denegada, caducada, "Aprobar al volver" (`queued_until_back`: shown in the strip with the dotted source line; Sacar de la cola = `unqueue`; a bounced salida shows its reason), Basecamp comment, Campfire and GitHub (review/comment) destinations.
9. Export `<SalidaApproval salidaId compact />` for lane A.

**Acceptance (B):**
- [ ] Every feature and state listed in `tickets.md` and `salidas.md` is reachable with seeded data, in Tokio and Grafito, desktop and 390px (paridad frames 1–5).
- [ ] Aprobar always sends the version shown (label carries the number); impossible while a rewrite is pending; destination visible above the text at every version.
- [ ] Undo inside 20 s returns the salida to pending with the same version; after release the UI shows sending until the session reports sent/failed.
- [ ] Answering a ticket wakes the owner: `node bin/mesa wait` in another terminal prints `ticket.answered` within a second.
- [ ] Approval cards: Dar permiso / Lee tus configuraciones / Denegar reach the hook within a second (verify with `scripts/hooks/mesa-approval.mjs` piped a sample hook JSON); an expired card cannot be decided.
- [ ] Review buttons: Approve is disabled with open blockers; Approve anyway waives them; Post shows the exact comment text and destination first; each press appears in Salidas with the 20 s undo.
- [ ] Semáforo selection works with mouse, keyboard and touch; marks survive a re-render; unit tests for the per-character mark model.
- [ ] Shortcuts never fire while typing in an input; all controls keyboard reachable; focus ring visible.
- [ ] `pnpm check` and `pnpm build` pass.

---

## Lane C: integrations, CLI, wake, memory, seed

**Owns:** `src/lib/integrations/**` (gh, engram), `src/lib/live/**`, `src/lib/wake/**`, `src/app/api/github/**`, `src/app/api/stream/route.ts`, `src/app/api/engram/search/route.ts`, `bin/**`, `scripts/**` (except `scripts/hooks/mesa-approval.mjs`, shared), `src/instrumentation.ts`, the `mesa-sweep` skill, migrations `03xx`.

Real-time ingest is **GitHub only**: no Slack app, no Basecamp OAuth or webhooks, and no Slack/Basecamp tokens or `.env` entries. May add change notifications inside `src/lib/repo/*` for `/api/stream` (one small PR, announced to A and B).

1. **GitHub ingest**: poll the notifications API server side (`gh api /notifications`, honoring `X-Poll-Interval` and `Last-Modified`/`If-Modified-Since`) and, on each change and on `POST /api/github/sync`, list open PRs where `acorrea-designli` is a requested reviewer (`gh search prs --review-requested=@me --state=open --json …` or GraphQL), upsert items (`source github`, `externalId pr:<owner>/<repo>#<n>`, kind `pr_review`, need `approve_pr`, url, project = repo, excerpt with +/− and review state). When a request disappears (reviewed, closed, merged), move the item to Hecho. Rate limit → source health "límite de API".
2. **GitHub Project sync for Tablero**: find the private Project "Mesa" owned by `acorrea-designli` (`gh project list --owner acorrea-designli --format json`); **create it only if it does not exist** (`gh project create`), ensure the Status field has Inbox, Todo, In Progress, Waiting, Done, and record `gh_project.id`, `gh_project.number`, `gh_project.status_field_id`, `gh_project.status_options` in `settings` (also log them in the PR description). Push: tasks with `syncState pending` → create a draft item (or add the PR as content), set Status, then `markSync(synced)`; errors → `markSync(error)`. Pull: periodically read Project items and update task stations changed in GitHub; a local pending move wins until acked. If `gh` lacks the `project` scope, report health "GitHub Project · sin permiso" and tell Andrés to run `gh auth refresh -s project`; never store tokens.
3. **CLI** (`bin/mesa`): arg parsing tests (`bin/mesa.test.mjs`), `mesa ticket ask --wait` (blocks until answered, prints the answer), `mesa salida propose --wait-release`, clearer human output with `--json` default for sessions, Windows/Git Bash install notes, and a session guide in `docs/SESSIONS.md` (how a Claude session registers, asks, waits, sends after `salida.released`, saves the thread to engram, and links it with `mesa engram link`).
4. **Wake protocol**: `GET /api/stream` SSE for the UI + `useLive()` hook; prune wake events older than 7 days; `task.moved` events if a session needs them; tests for long-poll timeout, abort and ack.
5. **Engram read**: `/api/engram/search` via the `engram` CLI if it is on PATH (`engram search <q> --project P --limit N`; check for a JSON output flag), returns `{ status, observations }`; `offline` when the CLI is missing or fails. Read only: Mesa never writes to engram.
6. **Source health**: the server sets `github` and `github_project` (`gh auth status`, rate limit, project scope) through `repos().sources`; the sweeper reports Slack and Basecamp with `mesa source set`. `getSourceHealth()` maps rows for the rail.
7. **Sample data**: `pnpm seed` inserts clearly labelled samples (`isSample: true`) that cover every screen state in the mocks (all stations, both ticket directions, plans, many versions, semáforo marks, scheduled, sent per destination kind, failed, denied, expired, learned chips, cold start, briefs and handoffs, live and retired agents, pending/decided/expired approvals, a review with findings in every state, queued_until_back). `pnpm seed --reset` deletes samples only.
8. **`mesa-sweep` skill** (Claude Code skill shipped in the repo under `.claude/skills/mesa-sweep/`): reads Slack (messages to or mentioning Andrés, U06E2UBDC73) and Basecamp (his readings, assignments and client messages without his reply) through MCP and feeds `mesa item upsert` with a dedupe key per source item (`slack:<channel>:<ts>`, `basecamp:<recording id>`). A haiku sweeper runs it as often as possible: a ~60 s two-stage tick per source (a cheap probe against `watermark`, then a full triage only when the probe finds something new) with adaptive backoff written back through `mesa source set` (`watermark`, `--checked`, `--new`, `--health`, `--cadence`, `--backoff-until`). On `sweep.requested` it runs immediately, ignoring backoff. Reports outages with `mesa source set slack --health down`.

**Acceptance (C):**
- [ ] Notifications polling respects `X-Poll-Interval` (never faster) and uses conditional requests.
- [ ] "Barrer ahora" → `sweep.requested` → the skill upserts items without duplicates on a second run.
- [ ] With `gh` logged in, review requests appear on Hoy within one sync; removing a review request moves the item to Hecho.
- [ ] The Project is created only when missing; its ids are in `settings`; moving a card in Mesa updates the Project Status and clears "Sin sincronizar"; a change made in GitHub shows up in Mesa.
- [ ] `mesa` commands covered by tests; `node bin/mesa help` documents every command; a full ticket and salida round trip works from a second terminal.
- [ ] UI updates without reload when a session posts a version or answers (SSE).
- [ ] Engram panel works with and without the CLI on PATH.
- [ ] `pnpm seed` then every screen shows its states; `pnpm seed --reset` leaves real data untouched.
- [ ] No secrets in the repo; `pnpm check` and `pnpm build` pass.
