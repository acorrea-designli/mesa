---
name: mesa-salida
description: Outgoing messages through Mesa Salidas - propose a draft with its exact destination, refine it turn by turn with Andrés (semáforo marks Mantener/Reformular/Quitar, versions, learned quick chips), send only after his approval and the 20 s undo window, report the permalink, scheduled sends, and delete per destination (Basecamp trash 25 days, Campfire permanent, Slack not deletable from Mesa). Use for any message to Slack, Basecamp or GitHub on Andrés's behalf, "respóndele a", "mándale", "contesta en Basecamp", "afinar", or a salida.* wake event.
---

# Salidas: nothing goes out unseen

Every message on Andrés's behalf is a salida: exact destination + exact text, approved by him in Mesa. Writers
propose and refine; only the lead sends, and only on `salida.released` (hook G5 checks it). No session ever calls
approve, schedule, deny or undo: those are his clicks (hook G10). `MESA` = `node G:/WorkSpace/designli/ops/bin/mesa`.

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
| `slack_thread` / `slack_channel` | `workspace` ("designli"), `channel` ("#name"), `channelId`, `threadTs` (thread only), `threadLabel`, `postAs` |
| `basecamp_comment` / `basecamp_message` / `basecamp_campfire` | `project`, `projectId`, `recordingId` (comment: the recording it attaches to; campfire: the chat id), `recordingTitle`, `mentions` (`basecamp_comment` only), `postAs` |
| `github_review` / `github_comment` | `repo`, `pr`, `event`, `path`, `line`, `commitId`, `findingN`, `postAs` (see `mesa-review`) |

**Mentions.** A `basecamp_comment` pings people only through `mentions: [{ "id": "9001", "name": "Matt Myers" }]`
in its destination: `id` is the person id as a string from `list_project_people` (the exact person of that
project, never guessed), `name` is what the card shows ("Menciona a: Matt Myers"). The lead sends the ids to
`create_comment` as `mentions` and hook G5 checks they equal the destination's (same set; none = none). A typed
"@Name" notifies nobody. Campfire lines (plain text) and message-board posts (no mentions param) cannot mention
through the MCP: the server answers 400 if their destination carries `mentions`; say in `--context` that nobody
gets pinged.

**No attribution.** No Claude or AI attribution in any Slack or Basecamp text: no "sent by Claude", no "written
with Claude", no robot sign-off (unless Andrés asks for that exact line on purpose). The Slack connector already
stamps "Sent using @Claude" on what it sends, which is why Slack never goes out through `slack_send_message`
(§ Send); the text you write must not add a second one.

Read the thread before writing so the text answers what was actually asked. Link the ticket that produced it
(`--ticket`) and its sources (`--link`), which Mesa shows as the Origen strip.

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

Delivery is at least once: first `MESA salida show <id>`; if it is already `sent`, do nothing.

0. If the event carries `recheckThread: true` (the salida waited for its source to come back), re-read the
   destination thread first; if it has new messages since the draft, `MESA salida bounce <id> --reason "<what
   changed>"` (it returns to Andrés for a fresh approval), tell the writer, and stop.
1. Body = `versions[approvedVersion - 1].body`, unchanged. Destination = the salida's `destination`, exactly.
2. Send with one MCP call: Basecamp `create_comment` (comment on `recordingId`; pass the destination's
   `mentions` ids as `mentions`, numbers: `"9001"` becomes `9001`; none when the destination has none, never add one),
   `create_message`, or `create_campfire_line`, converting Markdown to the HTML the tool takes without changing words
   (for `create_comment` the server builds the mention markup itself: do not type an `@Name` or a mention tag in
   `content`). GitHub: `mesa-review` § Lead writes.
   **Slack: never `slack_send_message`** (hook G5 refuses it for everyone). The connector appends "Sent using
   @Claude" to the message and cannot be told not to. The Slack path is pending Andrés's decision on t32 (a draft he
   sends himself); until the ticket says it is built, `MESA salida hold <id> --reason "slack path pending (t32)"`
   and tell Andrés in the ticket.
3. `MESA salida sent <id> --permalink <url>` with the URL the tool returned, or
   `MESA salida failed <id> --error "<message>"`. Tell the writer `SENT <ref> <salida>`.
4. Source down at send time (the MCP call fails as unreachable or rate limited): `MESA salida hold <id> --reason
   "<error>"` ("Aprobar al volver") and `MESA source set <slack|basecamp> --health down --note "<error>"`. When the
   source is set back to `ok` (the sweeper's next good probe does it) Mesa resumes every held salida with `recheckThread: true` (step 0).

**Sandbox** (`echo $MESA_ENV` prints `sandbox`): step 2 is skipped, never call the MCP tool (hook G11 blocks it).
Step 3 is `MESA salida sent <id> --simulated` (no `--permalink`; Mesa records `sandbox://<source>/<id>` and shows
"Simulado · no salió"). Steps 0, 1 and 4 are the same. A delete is `MESA salida deleted <id>` alone, a restore
`MESA salida restored <id>`.

Scheduled sends (Programar) need nothing from you: at `send_at` Mesa releases the salida and the same
`salida.released` arrives. Never use `slack_schedule_message` (hook G5).

## Delete (lead, on `salida.delete_requested` / `salida.restore_requested`)

| Destination | Delete | Then |
|---|---|---|
| Basecamp comment / message | `trash_comment` / `trash_message` (recoverable 25 days) | `MESA salida deleted <id>`; restore: `restore_recording`, then `MESA salida restored <id>` |
| Campfire line | `delete_campfire_line` (permanent; Mesa warned him) | `MESA salida deleted <id>` |
| Slack | not possible from Mesa (no delete tool): Mesa already refuses it; the 20 s undo was the only way back | nothing |
| GitHub | not supported: tell Andrés in the ticket with the comment link | nothing |
