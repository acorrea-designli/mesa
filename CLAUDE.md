# Mesa

Andrés's personal work-ops board: GitHub PR reviews, Basecamp requests, Slack replies and Claude's questions in one place, his Google Calendar (today, the week, the next meeting and a reminder before each), a kanban mirrored to a private GitHub Project, two-way tickets with Claude Code sessions, and an approval queue for every outgoing message. Read `docs/ARCHITECTURE.md` (system, data model, API, wake protocol) and `docs/TASKS.md` (lanes and file ownership) before changing anything.

@AGENTS.md

## Run

- Node **22.23.2** (`mise.toml`; `.npmrc` sets `use-node-version` so pnpm scripts use it even if the `node` on PATH is older). `node:sqlite` needs ≥ 22.13.
- `pnpm install`. Installing Mesa and its Claude team on another machine (prerequisites, `.env.local`, `install-team` with your identity, first run): `README.md`.
- `pnpm dev` serves on `127.0.0.1:8790` (never 8770 or 8771: other boards use them; `MESA_HOST` overrides the address). Open http://localhost:8790. `pnpm start` also starts the Cloudflare tunnel as its child (when `MESA_PUBLIC_URL` and `MESA_CF_TUNNEL` are set; `MESA_TUNNEL=on` for dev, `off` to disable). Phone: `pnpm tunnel` (Cloudflare Tunnel behind Cloudflare Access; `status` proves Access is in front, exit 3 if Mesa answers directly) and the QR or short code on `/telefono`; `docs/ARCHITECTURE.md` § 11.
- `pnpm check` runs typecheck, lint and tests (vitest, plus `pnpm test:team`: node:test for the team hooks and scripts). `pnpm build` must pass before a PR.
- Data lives in `data/mesa.db` (gitignored; `MESA_DB` overrides). Migrations in `db/migrations` apply on startup; `pnpm db:migrate` applies them by hand.
- `/kit` shows every shared component in both themes.
- CLI for sessions: `node bin/mesa help` (`bin/mesa.cmd` on Windows). Set `MESA_SESSION` to the session id.
- Sandbox (a dummy copy where nothing leaves, `docs/SANDBOX.md`): `pnpm sandbox:reset [--from live|seed]`, then `pnpm sandbox` serves `MESA_ENV=sandbox` on http://127.0.0.1:8796 over `data/sandbox.db`; open Claude Code in `G:/WorkSpace/designli-sandbox` (installed with `scripts/install-team.mjs --target G:/WorkSpace/designli-sandbox --env sandbox`). Never point it at `data/mesa.db` or :8790.
- The "SQLite is an experimental feature" warning from Node is expected.

## Conventions

- **English on disk**: code, identifiers, comments, docs, commit messages, PRs, log and error strings. **UI copy is Spanish** (it is product text, from the mocks). Error messages returned by the API are English.
- Commits: single-line conventional commits `type(scope): subject`, lowercase imperative subject, about 72 chars max. No body, no trailers, no `Co-Authored-By`, no attribution of any kind.
- One branch and one PR per lane (`feat/hoy-tablero`, `feat/tickets-salidas`, `feat/integrations`). Respect the file ownership in `docs/TASKS.md`; shared files change only through small PRs to `main`.
- TypeScript strict with `noUncheckedIndexedAccess`. Domain logic stays pure (`src/lib/domain`) and is unit tested; repositories take a `Db` so tests use `openDb(":memory:")`.
- No ORM, no Tailwind, no component kit. Plain CSS: tokens and shared classes in `src/styles`, screen CSS in the lane's folder.
- New SQL goes in a new migration file in your lane's number range. Never edit an applied migration.
- Sample data only through the seed, marked `isSample` and shown with "Datos de muestra.".

## Design source of truth

- `DESIGN.md` and `.impeccable/design.json`: tokens, components, rules (the five line colours mean source only: GitHub red, Slack teal, Claude orange, Basecamp green, Calendario indigo; `--mute` for secondary text, never `--dim`; only "Te espera" / "Por enviar" is solid ink; exact-text block has a top line stub).
- `.impeccable/surfaces/src-app-page-tsx.md`: direction contract ("Mapa de metro").
- `.impeccable/mocks/screens/*.md` + `*.html`: per-screen decisions and approved mockups. Chosen: Hoy, Tablero B, Tickets A, Salidas B, Teléfono A + paridad, Estados B, Calendario A (Agenda + pedir, with Calendario as the fifth line colour). Motion: `motion.md` + `mesa-motion.js`, implemented in `src/lib/motion`.
- Ignore `.impeccable/live/` and the `impeccable-live` script tags in the mocks. Do not edit the mocks.

## Safety rules for Claude sessions using Mesa

- Nothing is sent on Andrés's behalf without his approval of the exact text and destination. Slack, Basecamp and GitHub writes (review approvals, PR comments) are all salidas. A session or agent **never** calls approve (which carries the Slack mode), schedule, deny, undo, unqueue or "Ya lo envié" on a salida, and never decides a permission approval. It proposes, adds versions, and reports `sent`, `drafted`, `failed`, `hold` or `bounce`. The lead alone may also `withdraw` a stale pending or draft salida (`mesa salida withdraw <id> --reason`, final status `withdrawn`, never sends, not a deny) and close a stale review card (`mesa review close <id> --reason`); a teammate never does (G4).
- Slack salidas go out in the mode Andrés chose with his approval click (stored on the salida, carried in `salida.released`): **Aprobar** (default) = the lead leaves the exact text as a draft in his Slack with `slack_send_message_draft` and reports `drafted` (`draft_created`, "Borrador en Slack · envíalo tú"); he sends it himself, as his own message, with no "Sent using @Claude" footer, and closes it with "Ya lo envié". **Aprobar y que Claude lo envíe** = `slack_send_message`, which carries the footer (the button says so). Hook G5 passes each tool only for a released salida in its own mode with exactly that text and `channel_id`/`thread_ts`; a failed draft is `hold` with a clear reason, never a direct send.
- Send (or draft) a salida only after `mesa wait` delivers `salida.released` for it, and use exactly `versions[approvedVersion - 1].body` for exactly `destination`. If the event says `recheckThread`, re-read the thread first and `bounce` when it changed. If the source is down at send time, `hold` it ("Aprobar al volver") and report the outage with `mesa source set <source> --health down`.
- **Google Calendar (t112).** Mesa reads it server side from Andrés's private iCal feed (`MESA_GCAL_ICS_URL`: a secret that lives only in `.env.local`; never put it in the repo, a log, an API response, a ticket, a message or a chat, and never ask him to paste it anywhere but there). Writing is the lead's, through the Google Calendar connector, and every event (with or without invitees) is a salida with source `calendar`: create it only after `salida.released` with exactly the approved version's fields (hook G5 checks title, times, invitees, Meet and description, and refuses any other Google Calendar write). Moving an existing event is a calendar salida too (t131): its body starts with `Mover: <eventId>`, and G5 passes `update_event` only for a released one with exactly that eventId, start and end, and no other parameter. A teammate never writes to Google Calendar; in the sandbox nothing is fetched or written. Meeting reminders carry the meeting's title: the one exception to the rule that a push carries no titles (`docs/ARCHITECTURE.md` § 8, § 14).
- One lead session (`MESA_SESSION=lead`) owns every ticket and relays wakes to agents. Agents are ephemeral: start from `mesa ticket context <ref>`, rewrite the brief on every milestone (`mesa ticket brief`), write a handoff before stopping (`mesa handoff`), and keep nothing important only in the context window. Agent names are `<role>-<ticketRef>[-k]` and are never reused.
- Save ticket conversations and decisions to engram under topic key `mesa/<ref>` (scoped by the ticket's project) and link them with `mesa engram link`.
- Slack and Basecamp are read only through MCP by the sweeper session (`sweeper`, about every 60 s during work hours, state in `GET/PATCH /api/sources`). Mesa holds no Slack or Basecamp tokens, apps, webhooks or OAuth (Slack sends and drafts go through the lead's MCP connector only).
- Never put tokens, webhooks or secrets in the repo (`.env.local` is gitignored; `.env.example` lists the variable names). Never touch `G:/WorkSpace/designli` outside `ops/`.
