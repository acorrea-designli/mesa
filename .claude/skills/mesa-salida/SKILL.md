---
name: mesa-salida
description: Outgoing messages through Mesa Salidas - propose a draft with its exact destination, refine it turn by turn with Andrés (semáforo marks Mantener/Reformular/Quitar, versions, learned quick chips), send only after his approval and the 20 s undo window (Slack: a draft he sends himself, or "Claude lo envía"), report the permalink, scheduled sends, and delete per destination (Basecamp trash 25 days, Campfire permanent, a Slack draft is his to delete in Slack, a direct Slack send not deletable from Mesa). Also Google Calendar events (source `calendar`: the exact event, created by the lead through the connector after his approval). Use for any message to Slack, Basecamp or GitHub on Andrés's behalf, a meeting or Meet to create, "respóndele a", "mándale", "contesta en Basecamp", "afinar", or a salida.* wake event.
---

# Salidas: nothing goes out unseen

Every message on Andrés's behalf is a salida: exact destination + exact text, approved by him in Mesa. Writers
propose and refine; only the lead sends, and only on `salida.released` (hook G5 checks it). No session ever calls
approve (which carries the Slack mode), schedule, deny, undo or "Ya lo envié": those are his clicks (hook G10). `MESA` = `node G:/WorkSpace/designli/ops/bin/mesa`.

## Language and voice

- Client-facing text is English unless the destination thread is in Spanish; internal Designli Slack follows the
  thread. Match the thread's register.
- Run the `humanizer` skill (embedded mode, final text only) on every draft and every new version before it goes
  into Mesa. It changes wording only, never a fact, number, name, link or commitment.
- Tone per client from engram `client/<slug>` (`mem_search` before the first draft). No AI attribution, no sign-off
  Andrés would not write, no emojis unless the thread uses them. Never a Claude or AI attribution in Slack or
  Basecamp text (§ Propose, "No attribution").

## Propose

```
node G:/WorkSpace/designli/ops/bin/mesa salida propose --source basecamp --dest '<json>' --ticket <ref> --title "<short title>" --context "<why this message, one line>" --link "basecamp:<label>:<url>" --body - <<'EOF'
<the text>
EOF
```

Destination JSON (the server validates it; `postAs` is who it posts as):

| kind | fields |
|---|---|
| `slack_thread` / `slack_channel` | `workspace` ("designli"), `channel` ("#name"), `channelId` (required to send: it is the draft's and the send's `channel_id`), `threadTs` (thread only), `threadLabel`, `postAs` |
| `basecamp_comment` / `basecamp_message` / `basecamp_campfire` | `project`, `projectId`, `recordingId` (comment: the recording it attaches to; campfire: the chat id), `recordingTitle`, `mentions` (`basecamp_comment` only), `postAs` |
| `github_review` / `github_comment` | `repo`, `pr`, `event`, `path`, `line`, `commitId`, `findingN`, `postAs` (see `mesa-review`) |
| `calendar_event` | `calendar` ("primary"), `invitees` (addresses, for the chips), `meet` (true/false), `postAs`. The event itself is the BODY (see **Calendar events**) |

**Mentions.** A `basecamp_comment` pings people only through `mentions: [{ "id": "9001", "name": "Matt Myers" }]`
in its destination: `id` is the person id as a string from `list_project_people` (the exact person of that
project, never guessed), `name` is what the card shows ("Menciona a: Matt Myers"). The lead sends the ids to
`create_comment` as `mentions` and hook G5 checks they equal the destination's (same set; none = none). A typed
"@Name" notifies nobody. Campfire lines (plain text) and message-board posts (no mentions param) cannot mention
through the MCP: the server answers 400 if their destination carries `mentions`; say in `--context` that nobody
gets pinged.

**No attribution.** No Claude or AI attribution in any Slack or Basecamp text: no "sent by Claude", no "written
with Claude", no robot sign-off (unless Andrés asks for that exact line on purpose). A Slack message carries the
"Sent using @Claude" footer only when Andrés picks the direct mode ("Aprobar y que Claude lo envíe", § Send): the
connector stamps it on `slack_send_message` and cannot be told not to. In the default mode (Aprobar) the text goes
out as a draft he sends himself, as his own message, with no footer. Either way the text you write must not add a
second attribution.

Read the thread before writing so the text answers what was actually asked. Link the ticket that produced it
(`--ticket`) and its sources (`--link`), which Mesa shows as the Origen strip.

## Calendar events (source `calendar`)

Every event Andrés asks for, with or without invitees, is a salida (his decision 4A); nothing is created in Google
Calendar before he approves the exact event. The body IS the event, one field per line (the server and hook G5 parse
it; any other shape is a 400):

```
Título: Meet con Matt
Inicio: 2026-11-12T10:00:00-05:00
Fin: 2026-11-12T10:30:00-05:00
Zona: America/Bogota
Invitados: matt.r@scoutapp.example
Meet: sí
Descripción: optional free text, to the end
```

Times are ISO with their offset (never a bare local time), `Invitados` is omitted when nobody is invited, `Meet` is
`sí` or `no`. Use the CLI so the format is right:

```
node G:/WorkSpace/designli/ops/bin/mesa calendar propose --title "Meet con Matt" --start 2026-11-12T10:00:00-05:00 --end 2026-11-12T10:30:00-05:00 --invitee matt.r@scoutapp.example --ticket <ref> --context "<what you checked>"
```

Before proposing, check the slot against the stored events (`mesa calendar free --day <YYYY-MM-DD> --minutes <n>`) and
find each guest's address (`mesa calendar people`, the thread, the ticket); an address you cannot find is a question
to Andrés, never a guess. Say in `--context` which slot you checked and where each address came from. A refinement
("más temprano") is a new version with the same format (`mesa salida version`). No humanizer pass on the fields;
the title is the only wording that is yours, in the language Andrés used.

## Refine (Afinar con Claude)

Andrés's change request arrives as `salida.turn` (payload `turnId`); the lead relays
`ANSWER <ref> salida.turn <salida> <turn>`. `MESA salida show <salida>` gives the turn's text and its marks
(`{start, end, kind, text}` on the version it was made on):

- **keep (Mantener)**: the marked words stay character for character in the next version.
- **redo (Reformular)**: replace them with a synonym or another phrasing that keeps the meaning.
- **drop (Quitar)**: remove them entirely, and whatever only existed to support them.
- The turn's own text applies to the rest. Marks with no text are a complete request.

Write the next version from the shown one (not from your memory of it), humanize it, then:

```
node G:/WorkSpace/designli/ops/bin/mesa salida version <salida> --turn <turnId> --chip "<label>" --body - <<'EOF'
```

`--chip` is the request summarized as a 1-3 word label in Spanish, grouped by meaning with his past requests
(`acórtalo`, `menos texto` → `Más corto`; `quita el hola`, `sin saludo` → `Sin saludo`). Reuse an existing label
when the meaning matches (`curl -s http://127.0.0.1:8790/api/chips` lists the top ones; `:8796` in sandbox); never a preset.
Each version is immutable; he may star one or go back to an earlier one, and Aprobar always sends the version he
sees. A manual edit by him is his version: never overwrite it.

## Send (lead, on `salida.released`)

Delivery is at least once: first `MESA salida show <id>`; if it is already `sent` or `draft_created`, do nothing.

0. If the event carries `recheckThread: true` (the salida waited for its source to come back), re-read the
   destination thread first; if it has new messages since the draft, `MESA salida bounce <id> --reason "<what
   changed>"` (it returns to Andrés for a fresh approval), tell the writer, and stop.
1. Body = `versions[approvedVersion - 1].body`, unchanged. Destination = the salida's `destination`, exactly.
2. Send with one MCP call: Basecamp `create_comment` (comment on `recordingId`; pass the destination's
   `mentions` ids as `mentions`, numbers: `"9001"` becomes `9001`; none when the destination has none, never add one),
   `create_message`, or `create_campfire_line`, converting Markdown to the HTML the tool takes without changing words
   (for `create_comment` the server builds the mention markup itself: do not type an `@Name` or a mention tag in
   `content`). GitHub: `mesa-review` § Lead writes.
   **Slack goes out in the mode Andrés chose with his approval click**, carried in the event (`mode`) and stored on
   the salida (`MESA salida show <id>`: `sendMode`). Never choose or change it yourself.
   - **`draft`** ("Aprobar", the default; also what Programar records): ONE call to
     `mcp__claude_ai_Slack__slack_send_message_draft` with `channel_id` = `destination.channelId`, `thread_ts` =
     `destination.threadTs` (only for a `slack_thread`) and `message` = the approved body unchanged. This only leaves
     the text as a draft in his Slack composer; he presses send and it goes out as his own message, with no
     footer. Then step 3 is `MESA salida drafted <id>` (status `draft_created`, "Borrador en Slack · envíalo tú").
     You do not see whether he sent it: his "Ya lo envié" click closes it (never call that yourself, hook G10). A
     draft never counts as sent and never re-releases.
   - **`send`** ("Aprobar y que Claude lo envíe"): ONE call to `mcp__claude_ai_Slack__slack_send_message` with the
     same three fields. The connector appends "*Sent using* @Claude" to it; Andrés accepted that with that button,
     which says so next to it. Step 3 is `MESA salida sent <id> --permalink <url>`.
   Hook G5 passes each tool only for a released, unsent Slack salida in that mode with exactly that text and
   `channel_id` (and `thread_ts` when the destination has a thread). The wrong tool for the mode is refused with the
   right path: a draft-mode salida is never sent, whatever happens to the draft call.
   **The draft call fails** (a draft already exists in that channel or thread, or any error from the tool):
   `MESA salida hold <id> --reason "<clear reason, e.g. ya hay un borrador en ese canal>"` and tell Andrés in the
   ticket what to clear. Unreachable or rate limited: hold with that error and step 4. Never fall back to
   `slack_send_message`, and never retry with different text. A draft may replace what he is typing in that
   channel; the card says so next to Aprobar.
3. `MESA salida sent <id> --permalink <url>` with the URL the tool returned (Slack direct mode, Basecamp, GitHub),
   `MESA salida drafted <id>` (Slack draft mode, no permalink exists), or `MESA salida failed <id> --error
   "<message>"`. Tell the writer `SENT <ref> <salida>` (`DRAFTED <ref> <salida>` for a draft).
4. Source down at send time (the MCP call fails as unreachable or rate limited): `MESA salida hold <id> --reason
   "<error>"` ("Aprobar al volver") and `MESA source set <slack|basecamp> --health down --note "<error>"`. When the
   source is set back to `ok` (the sweeper's next good probe does it) Mesa resumes every held salida with
   `recheckThread: true` (step 0); its mode is kept.

**Calendar** (`source: calendar`, no mode): step 2 is ONE `create_event` call of the Google Calendar connector
(`mcp__claude_ai_Google_Calendar__create_event`) with exactly the fields of the approved body: title, start, end
(with the zone), the invitees as attendees, a Google Meet only when `Meet: sí`, and the description. Hook G5 passes
the call only when every field equals the approved ones (instants for the times, the set of addresses for the
guests) and refuses every other Google Calendar write (delete, respond, move to another calendar): never fix an event after the
fact, propose a new salida. Step 3 is `MESA salida sent <id> --permalink <the event's link>`; if the connector cannot
attach the Meet, do not create the event without it: `MESA salida hold <id> --reason "el conector no puede crear el Meet"`
and tell Andrés in the ticket. A feed outage (`mesa source get calendar` down) does not matter here: reading is not
creating. Guests receive Google's invitation e-mail when the event is created: that is what he approved.

**Calendar move** (`source: calendar`, body starts with `Mover: <eventId>`, fields `Mover`, `Título` (display only), `Inicio`, `Fin`,
`Zona`, `Avisar: sí|no`; propose it with `mesa salida propose --source calendar --dest '{"kind":"calendar_event","calendar":"primary","postAs":"Andrés Correa"}' --body -`):
step 1 is `get_event` with the `eventId`: if it is not found or its summary differs from `Título`, `MESA salida bounce <id>` with the reason and
tell Andrés in the ticket (never move an event you could not identify). Step 2 is ONE `update_event` call with exactly `eventId`,
`startTime` and `endTime` (local time `YYYY-MM-DDTHH:MM:SS`, no offset or Z) and `timeZone` (the approved Zona, required), plus `notificationLevel: NONE` only when `Avisar: no` (`Avisar: sí` is the default, ALL). Any other parameter
(summary, attendees, Meet, description, reminders, `allDay`, ...) makes G5 refuse the call. Step 3 is `MESA salida sent <id>`.
Guests get Google's update e-mail when `Avisar: sí`: that is what he approved.

**Sandbox** (`echo $MESA_ENV` prints `sandbox`): step 2 is skipped, never call the MCP tool (hook G11 blocks both
Slack tools). Step 3 is `MESA salida sent <id> --simulated` (no `--permalink`; Mesa records `sandbox://<source>/<id>`
and shows "Simulado · no salió"), or `MESA salida drafted <id> --simulated` for a Slack salida in mode draft. Steps
0, 1 and 4 are the same. A delete is `MESA salida deleted <id>` alone, a restore `MESA salida restored <id>`.

Scheduled sends (Programar) need nothing from you: at `send_at` Mesa releases the salida and the same
`salida.released` arrives. Never use `slack_schedule_message` (hook G5).

## Withdraw (lead only, stale leftovers)

A `pending` or `draft` salida nobody should send any more (its PR merged, the thread moved on, a leftover of a finished
ticket) is closed with `MESA salida withdraw <id> --reason "<why Andrés can read>"`. It is not a deny and not an
approval: final status `withdrawn`, never sent, no wake, the card reads "Retirada · <why>" and the ticket stops
counting it. Any other status is 409 (sending, scheduled, queued, sent, failed, denied...): it is not stale, leave it.
A withdrawn github review salida frees its findings so they can be posted again. After withdrawing the pending salidas of
a PR whose review card is stale, close the card with `MESA review close <reviewId> --reason "<why>"` (409 unless the
review is open). Teammates never run either verb (G4). Deny stays Andrés's click and has no CLI verb.

## Delete (lead, on `salida.delete_requested` / `salida.restore_requested`)

| Destination | Delete | Then |
|---|---|---|
| Basecamp comment / message | `trash_comment` / `trash_message` (recoverable 25 days) | `MESA salida deleted <id>`; restore: `restore_recording`, then `MESA salida restored <id>` |
| Campfire line | `delete_campfire_line` (permanent; Mesa warned him) | `MESA salida deleted <id>` |
| Slack, draft mode | a draft is Andrés's to delete in Slack (Mesa never touched a message); once he sends it, it is his own message and Mesa cannot delete it | nothing |
| Slack, direct send | not possible from Mesa (no delete tool): Mesa already refuses it; the 20 s undo was the only way back | nothing |
| GitHub | not supported: tell Andrés in the ticket with the comment link | nothing |
| Calendar event | not supported from Mesa (no delete or update tool is wired): tell Andrés in the ticket with the event link; he removes it in Google Calendar | nothing |
