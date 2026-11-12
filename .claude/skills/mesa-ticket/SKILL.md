---
name: mesa-ticket
description: The Mesa ticket protocol for the lead and every teammate - how to ask Andrés (a question card: 1-6 questions with options and a recommendation each), how to reply, the "Claude va a hacer" plan with the / action catalogue and its directo vs "te pide OK" gates, @ ticket refs, files, brief and handoff discipline, and what goes to engram. Use whenever you open, answer, plan, reference or close a Mesa ticket, or when Andrés writes a new request ("pídele a Claude", "nuevo ticket", "ticket").
---

# Mesa tickets

A ticket is one unit of work between Andrés and Claude, in one stream: `claude_asks` (we ask him) or `andres_asks`
(he asks us). Every ticket has an owner agent; the lead routes, the owner works. State lives in Mesa; durable memory
in engram. `MESA` = `node G:/WorkSpace/designli/ops/bin/mesa` (Bash tool, bare; bodies through `--body -` and a
heredoc so text never passes through shell quoting).

## Asking (the only way to ask Andrés anything)

- Every question is a card. One decision: `ticket reply --option` makes a 1-step card. Several decisions: bundle them
  into ONE card with `ticket questions` (up to 6 questions, each with 2-6 options, keys A-F). Never several messages
  with one question each.
- Each question: the question in one line naming the choice, one option per line (`label`, optional `detail`), the
  recommended key (the one you would pick if he said "tú decide") and its reason in one line. Spanish. The message
  body is the context, at most 3 lines.
- Quote the client's own words when the question is about what the client wants.
- Never ask what the code, the thread or engram already answers. Never ask in chat or by message: the lead's chat
  is not where his decisions live.
- One open card per ticket at a time (Andrés, 2026-11-11, t107: "como mandas otro mensaje anulas la anterior").
  Each question now stays open until he answers it or you withdraw it, but a second card on top of an open one
  still splits his attention: with a card pending, post nothing else in that ticket (no new card, no `--ask`
  nudge, no FYI) until `ticket.answered` arrives. Ask the next decisions after, or bundle them into the first card.
- He may answer part of a card: `ticket.answered` carries `openLeft`, the questions still open. Those stay open; do
  not ask them again. Work on what he answered; a later reply of his may answer the rest.
- A question that became moot (he answered it in his own words, or the plan changed) is withdrawn, with the reason:
  `MESA ticket question withdraw <tq id> --why "<one line>"`. Never leave a dead question open, never re-ask it in a
  new card without withdrawing the old one. Closing the ticket withdraws whatever is still open.
- A message that asks nothing starts with `FYI:` so he can skip it, and it does not put the ticket in "Te espera":
  a reply only goes to him with a card (`--option` or `ticket questions`) or `--ask` (a question without options,
  e.g. `ticket reply <ref> --ask --body "¿Lo cierro?"`). A reply without either is informational: the status stays as
  it is (an open question stays open; an unclaimed request becomes "Claude trabaja"). Plans keep their rule.

One decision:

```
node G:/WorkSpace/designli/ops/bin/mesa ticket reply t14 --body - --option "A:Bucket nuevo" --option "B:Reusar dre-staging-docs" --recommend A --why "aísla datos de prueba y el costo es mínimo" <<'EOF'
¿Bucket nuevo (A) o reusar el de staging (B) para los uploads de Matt?
Matt: "we just need somewhere private to drop test files".
EOF
```

Several decisions, one card (`recommend` and `why` per question; `refs` optional):

```
node G:/WorkSpace/designli/ops/bin/mesa ticket questions t14 --json - <<'EOF'
{"body": "Antes de cortar la release 2.4 necesito tres decisiones.",
 "questions": [
  {"text": "¿Cuándo corto la release?", "options": [{"key": "A", "label": "Hoy 17:00"}, {"key": "B", "label": "Mañana 09:00", "detail": "entra el fix de Laura"}], "recommend": "B", "why": "el fix cierra el bug que vio Matt"},
  {"text": "¿Quién avisa al cliente?", "options": [{"key": "A", "label": "Yo por Slack"}, {"key": "B", "label": "Tú en la llamada"}], "recommend": "A", "why": "Matt pidió el aviso por escrito"}
 ]}
EOF
```

The board shows the card as a stepper: one step per question with its state (abierta, elegida, respondida,
retirada), the options as buttons with the recommended one marked, "Otra respuesta" for his own words, and "Enviar
respuestas (n de k)". He can also type `1A 2C` (or `1: B, 2-A`); a bare `B` answers only when exactly one question is
open. His answer arrives as `ticket.answered { messageId, answers: [{questionId, n, chosen, label, text}], openLeft }`;
the lead relays `ANSWER <ref> <message id>` with the answers inline to the owner, who reads the rest with
`MESA ticket context <ref>` (its `questions` list every question with its state).

## Checklists (manual steps for Andrés)

When you need him to do several manual things (paste a URL in `.env.local`, restart something, authorize a connector
with `/mcp`), post ONE checklist instead of a long message: `ticket checklist` (up to 30 steps, each with a one-line
`text` and an optional `detail` in Markdown; a fenced block or `inline code` in the detail gets a copy button). It is
not a question card: it does not count against "one open card per ticket", and nothing else changes while it waits.

```
node G:/WorkSpace/designli/ops/bin/mesa ticket checklist t112 --json - <<'EOF'
{"body": "Para conectar el calendario faltan dos cosas tuyas.",
 "steps": [
  {"text": "Pega la URL iCal en .env.local", "detail": "Google Calendar, tu calendario, dirección secreta en formato iCal.\n\n```\nMESA_ICS_URL=...\n```"},
  {"text": "Autoriza el conector de Google con /mcp"}
 ]}
EOF
```

- He ticks (and unticks) on the board or the phone. Each tick wakes you with `ticket.checklist { ref, ticketRef,
  messageId, stepId, n, done, doneCount, total, allDone }` (the lead relays `ANSWER <ref> checklist <n> done|open
  <doneCount>/<total>`); `allDone` is your cue to continue. Read the states with `MESA ticket context <ref>`: its
  `checklists` list every step with `state`, `doneBy` and `note`. Open steps keep the ticket in "Te espera" ("Hacer
  pasos · 2 de 5 hechos").
- Mark a step yourself only when you verified it: `MESA ticket check <ref> <n> --note "Mesa dice configured:true"`
  (`<n>` is the step number while the ticket has one checklist; with several use `<message id>/<n>` or the step id,
  `ck_…`, from the context). The note is one line of proof; the card shows "Verificado por Claude" with it and you wake
  nobody. Never mark a step he has to do, and never tick one you only assume. `--undo` reopens a step; he can untick
  yours too.
- Steps cannot be edited or reordered after posting. A step that became moot stays open: say so in a reply (`FYI:`),
  he can tick it to clear it from "Te espera".

## "Pídeme permiso" (a blocked call)

When a call of yours is blocked and Andrés presses **Pídeme permiso** on the ticket, his message "Pídeme permiso"
(`kind: permission_request`) arrives with the wake `ticket.permission_requested { ticketRef, messageId }`; the lead
relays `ANSWER <ref> permission_requested <message id>` to the live owner, who passes it to the teammate that is
blocked. Mesa never edits settings or files the card for you. The blocked agent:

1. Adds the narrowest `permissions.ask` rule for the exact call to `.claude/settings.local.json` in the project root
   of the session (the cwd, not your worktree): tool plus the exact command or path, no wildcard. Never an `allow`
   rule, never a broader pattern, never another settings file, and only on this wake.
2. Retries the exact call once. The `mesa-approval` hook files the ApprovalCard on this ticket; wait for it.
3. After his decision, removes the ask rule, unless he says to keep it (then say so in the handoff).

## "Bloqueado por el modo automático" (a call auto mode denied)

When auto mode denies a call of a teammate (or of the lead while it has a focus ticket), the `PermissionDenied` hook
(`mesa-denied.mjs`) files a card on that ticket with the tool, the exact call, the denial reason and the proposed
rule, and waits 120 s. Nobody in the team writes the rule: Andrés presses **Permitir esta regla** and the Mesa server
derives it from the stored call (only `Edit(//g/WorkSpace/designli-wt/<worktree>/<dir>/**)`, never `.claude`,
settings, a worktree root, a command or an MCP tool) and appends it to `settings.local.json`; the hook then tells the
agent to retry once. **Denegar**, a timeout or no rule: the denial stands. The owner reads the card's outcome in the
ticket, never works around a denial and never edits a settings file; a call with no rule goes to Andrés as a ticket
question (`docs/TEAM.md` § 6.7).

The lead's own prompts with no ticket show in Hoy, Permisos. While it acts for a ticket it runs
`mesa lead focus <ref>` (`--clear` when done; it lapses 2 h after the last set, so run it again to renew) so the
hook files them to that ticket.

## Replying to his request

Answer first, then evidence (one line each, linked), then what you could not check. At most 6 lines. Long output
(logs, diffs, tables) goes in a file attached to the ticket or in the PR, never pasted in the reply.
Andrés, 2026-11-09 (t21: "que es esto, mucho texto"): aim for 2-3 short lines in plain Spanish, one line per point.
Keep run numbers, ids, sha and file:line out of the body. Put them behind a link or in the attached file. If the
6 lines are not enough, the reply is still too long: cut it, do not split it into more messages.

## The plan: "Claude va a hacer"

Before work that does anything beyond reading, the owner posts the plan, one action per step:
`MESA ticket plan <ref> --action "<kind>:<source>:<direct|needs_ok>:<label in Spanish>"`.

| kind (the `/` catalogue) | source | gate | examples |
|---|---|---|---|
| `investigate` | any | direct | read threads, logs, code |
| `review_pr` | github | direct (verdict needs OK) | review owner/repo#n |
| `branch_pr` | github | direct | worktree, commits, a draft PR |
| `create_task` | claude | direct | a task on the Mesa board: `MESA task create --title T --note-only` (without `--note-only` it would open a new ticket for the lead) |
| `move_card` | github / basecamp | needs_ok | move a GitHub Project or Basecamp card |
| `send_message` | slack / basecamp | needs_ok | always a salida (`mesa-salida`) |
| `cancel_message` | slack / basecamp | needs_ok | undo or delete a sent salida |
| `apply_infra` | github | needs_ok | terraform apply, any change to a live environment |
| `merge_pr` | github | needs_ok | merge or mark ready |
| `post_github` | github | needs_ok | approve, review comments, replies (`mesa-review`) |

Rule of thumb: reading and preparing are `direct`; anything another person can see, or that changes a live system,
is `needs_ok`. Anything that writes to a client goes through Salidas. Mark progress with
`MESA ticket action <actionId> --state running|done|failed`. A `needs_ok` action waits for
`ticket.plan_approved`; a `needs_ok` action already `approved` was pre-approved by Andrés: run it without
asking again (a wake with `partial: true` approved only its `approved` ids). Andrés can take a pre-approval back
(the chip toggles "autoaprobado" <-> "te pide OK") while you have not started it: that wake carries
`revoked: [ids]` and no `approved`; the lead relays it as `ANSWER <ref> plan_revoked <ids>` (and a partial approval
as `plan_approved partial <ids>`). A revoked id is back to `planned`: do not run it. Mark a step `running` before you
start it: after that Mesa refuses the revoke, and before that Mesa answers 409 to `running` on a step that is not
`approved` (do not run it then). Re-read `MESA ticket context` for the action states when a `plan_approved` or
`plan_revoked` message arrives.

## Cards handed to Claude

A ticket created from a Tablero card ("+ Tarea", "Dárselo a Claude", Nuevo pedido, `mesa task create`) carries
`taskId`; its card shows the owner chip ("Claude · por asignar" until the lead claims it and adds the owner with
`mesa team add … --owner`, then "<owner> · <estado>"). The lead handles `ticket.created` by kind (`mesa-start` § 5,
`docs/TEAM.md` § 4). The card follows the ticket: Mesa moves it in the same transaction as every status change
(`working` and `waiting_claude` → En curso, `waiting_andres` → Esperando, `paused` → Esperando, `ongoing` → En curso, `closed` → Hecho, so a reopen lands in
En curso). Never move it by hand for a status change (no `MESA task move`); a card Andrés drags stays put until the
next status change. Moving a GitHub Project or Basecamp card stays `needs_ok`.

## Closing and reopening

The owner closes a ticket with `MESA ticket close <ref>`; a closed ticket comes back with
`MESA ticket reopen <ref> [--reason R]` (owner wakes with `ticket.reopened`). A review ticket whose PR gets a new head
from its author reopens by itself (GitHub poll, or `MESA review open` at a new head): same ticket, `waiting_claude`,
wake `ticket.reopened { ref, repo, pr, oldHead, newHead }`; pushes by Andrés or a bot do not reopen it. Boot from
`MESA ticket context <ref>`: `reviews[].headSha` is the reviewed head, `seenHead` the new one.

## Pausar (En pausa / En proceso)

A ticket that is neither Andrés's turn nor yours has its own state, so the board does not call it "Claude trabaja" or
"Te espera":

- **Waiting on another ticket, a third party or a date:** `MESA ticket pause <ref> --reason "<why>" [--until-ticket tN]`
  ("En pausa"). The reason is required; put a date in it ("espera al cliente hasta el viernes"). With `--until-ticket`
  (an open ticket, not this one) it comes back by itself the moment that ticket closes, by any path: the ticket goes to
  `waiting_claude` and its owner session gets `ticket.resumed`.
- **Going on with nobody active** (CI running, a third party working): `MESA ticket ongoing <ref> --reason "<what>"`
  ("En proceso"). No dependency, no auto-resume.
- **Back to work yourself:** `MESA ticket resume <ref>` (to `working`, no wake). A claim, your own question or plan, or
  Andrés replying also end it. An informational `ticket reply` does not.
- Pausing never withdraws a question, plan step or salida: whatever Andrés owes still reads "Te espera".
- **The lead relays `ticket.resumed`** (`RESUMED <ref> by <andres|dependency>`) to the owner and respawns one if none
  is live; the owner boots from `MESA ticket context <ref>` (`ticket.status`, `pauseReason`, `pausedUntil`) and continues.
  Andrés can also pause and resume from the ticket header; "En proceso" is only set from here.

## @ refs and files

- Reference another ticket with `--ref <ref>` on ask, or `@t12` in the body; reference a PR, recording or thread
  by URL. The lead resolves `@` refs to the live owner of that ticket when work spans both.
- **Read every attachment before you draft or answer** (preamble rule 18). A Slack or Basecamp message that is the
  source of a ticket, a draft or an answer is read in detailed mode (`slack_read_thread` / `slack_read_channel` with
  `response_format: "detailed"`) with the 3-5 messages before it, and every file it lists is opened (`slack_read_file`;
  Basecamp `download_file <url>`: the `href` of the `<bc-attachment>`, or the `download_url` from
  `get_upload(upload_id)` or a record's attachments). Text comes back as text and images as an image; a PDF or other
  type comes back as a description with a `web_url`, a file over 10 MB as a description only. An item with
  `meta.files` (Hoy shows an "imagen" or "adjunto" chip) always has files to open. "Aquí", "esto", "esta" points at
  an attachment or a link. A file that cannot be read is `BLOCKED <ticket> cannot read <name> (<why>) <web_url>` to
  the owner (the `web_url` lets Andrés open it), never a guess.
- Files Andrés attaches arrive in `ticket context` as attachments with a local path; read them by path. Files you
  produce (PDFs, plans) live in your scratch folder and are named in the reply by absolute path.

## Meeting requests (Calendario)

A ticket whose first message begins with the line `Pedido de reunión (Calendario)` and whose title starts with
`Reunión:` comes from the Calendario screen ("Pedir a Claude"; his own words follow the marker line). It is a request
for ONE calendar event, always proposed as a salida (`mesa-salida` § Calendar events), never created directly:

1. Read what he asked (who, which day, how long, with or without Meet). Dates are Bogota; "el jueves" is the next
   Thursday; a missing duration is 30 minutes, a missing time means you pick a free slot.
2. `MESA calendar free --day <YYYY-MM-DD> --minutes <n>` for the slot (from the stored events; `mesa calendar status`
   says whether the calendar is connected, and without it there are no events to check: say so in the proposal).
3. `MESA calendar people` for each guest's address; also the ticket, Slack or Basecamp. An address you cannot find is ONE
   question card to Andrés (A: the address, B: without that guest), never a guess.
4. `MESA calendar propose ... --ticket <ref> --context "<slot checked, where the addresses came from>"` and answer
   the ticket in one or two lines in Spanish: what you proposed (title, day and hour, guests) and that it waits in
   Salidas for his signature. Plan the action as `create_event:calendar:needs_ok` when you use a plan.
5. On `salida.released` the lead creates the event (`mesa-salida` § Send, Calendar) and closes the loop on the ticket
   with the event link.

## Brief and handoff discipline

- **Brief** (owner writes it, `MESA ticket brief <ref> --body -`, replaced in full each time): the ask in one line,
  the requester's words quoted, acceptance criteria numbered, repo/base/destination, risks, links. Every teammate
  boots from it, so it must stand alone.
- **Handoff** (every agent, before every stop, preamble rule 6): status, what is done, what is left, where (file:line,
  PR, salida ids, URLs), open questions, the next step. Write it as if the reader has never seen the ticket.

## Engram

Every ticket's durable record is one observation with topic_key `mesa/<ref>` (the owner upserts it: request,
decisions with Andrés's words, outcome, links). Client preferences go to `client/<slug>`; reusable lessons to
`lesson/<slug>`. Mesa may also record the thread itself (`mesa engram link`); never `mem_save` a duplicate of what
the ticket already holds. English, no secrets.

## Closing

When the work is finished, the lead closes the ticket and moves its card to done, whether Andrés asked for the work
or Claude did. Andrés, 2026-11-09 (t19): "¿por qué dejaste esto abierto? cierra los tickets terminados". Finished
means: the owner sent DONE, nothing waits on Andrés, the result is posted in the ticket in 2-3 lines, and the
`mesa/<ref>` upsert and the final handoff are written. A ticket is NOT finished while it is only an open
conversation in which he keeps asking for things (t3 was one): leave that kind open. If he reopens a ticket,
it was not finished; work it again.
