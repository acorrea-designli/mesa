---
name: mesa-sweep
description: Ingest of everything waiting on Andrés into Mesa with mesa item upsert - Slack messages that expect his answer (slack-triage logic) and Basecamp assignments, mentions and client comments without his reply, plus GitHub review requests (pr-monitor gate) on demand. Read-only toward every source. Covers the periodic two-stage sweep the sweeper agent runs every ~60 s and the full on-demand pass. Use when Andrés says "barre", "barrer ahora", "sweep", "qué hay pendiente", "actualiza mesa", "revisa Slack/Basecamp/GitHub", or when the sweeper is down.
---

# Mesa sweep (read-only toward every source)

**Sandbox: no-op.** If `echo $MESA_ENV` prints `sandbox`, stop here: say "Sandbox: no se barre Slack ni Basecamp
(la copia ya trae los items)." and do nothing else. The sandbox board refuses `sweep.requested` (409 `sandbox`), and
the lead spawns no sweeper there.

Slack and Basecamp are read only by Claude sessions through MCP (Andrés, 2026-11-03: no Slack app, no Basecamp
OAuth), so this skill is their only ingest path. GitHub is polled by the Mesa server; § 1 is the on-demand
fallback. Nothing here writes to a source: no comments, no reactions, no mark-as-read. The only writes are
`mesa item upsert` (idempotent by `source` + `externalId`, the dedupe key, so a re-sweep never duplicates) and the
watermarks.

`MESA` = `node G:/WorkSpace/designli/ops/bin/mesa` (Bash tool, bare). Item JSON is the server's ItemInput:
`{source, externalId, kind, title, excerpt?, project?, url?, need?, station?, waitOn?, meta?, receivedAt?}` with
`waitOn` one of `you | client | claude | none | person:<name>`. Upsert one item per call:
`MESA item upsert --json -` with the JSON on stdin (heredoc). Private content stays in Mesa.

## 0. Two ways it runs

**Periodic (the sweeper agent, `.claude/agents/sweeper.md`, haiku).** During work hours, a two-stage tick:

1. *Probe*, per source since its watermark. Slack: one `mcp__claude_ai_Slack__slack_search_public_and_private`
   call with exactly `{"query": "(to:me OR <@U06E2UBDC73>) after:<YYYY-MM-DD of the watermark minus 1 day>",
   "sort": "timestamp"}` and no other parameter (2026-11-09: extra `filters`/`keywords` fields made every probe
   return nothing, and a DM from Sebastián never reached Hoy). A probe with zero results while the watermark is
   older than an hour is suspect: re-check the call against this line. A DM from a person (not a bot) to Andrés is
   never Ruido, even when it is only a link (a bare PR link is a review ask).
   Basecamp, exactly this:

> **Basecamp probe** (every Basecamp tick, two calls):
> 1. `mcp__basecamp__search` with `{query: "Andres", sort: "recency", limit: 3}`. New = hits whose `created_at` is after the probe watermark and not written by Andrés. If all 3 hits are new, repeat the call once with `{query: "Andres", sort: "recency", limit: 10}`. The probe watermark advances to the newest `created_at` seen.
> 2. `mcp__basecamp__get_my_assignments` with `{group: "priorities"}`. New = assignments this instance has not upserted yet.
>
> **Basecamp catch-up** (client comments that do not name him): `mcp__basecamp__get_my_notifications` with no parameters, on this instance's first Basecamp tick and then every `fullScanEveryTicks`-th Basecamp tick. `fullScanEveryTicks` and `scanSince.basecamp` come from the `sweep-tick.mjs wait` output, never from prose. New = notifications with `unread_at` after `scanSince.basecamp` (it falls back to the probe watermark while no catch-up window is stored; null only before the first probe, then all). Its window is kept apart from the probe watermark: the report carries `--scan-since <newest unread_at seen>`.
>
> Ignored projects (`mesa-sweep` § 0b) are dropped from the probe hits and from the catch-up before any `get_by_url`.

   Nothing new: `sweep-tick.mjs report <source> --new 0` and silence.
2. *Triage*: only for what the probe or the catch-up found, § 2 or § 3 below, then upserts and
   `report --new N --watermark W` (Basecamp after a catch-up: also `--scan-since S`).

The clock is `scripts/sweep-tick.mjs`; every number (60 s active, 5 min after 30 quiet minutes, exponential
backoff to 30 min on errors, work hours, probe limit, ticks per instance, the Basecamp catch-up interval
`sources.basecamp.fullScanEveryTicks`) is in `config/sweep.json`; the catch-up window lives in Mesa, in the Basecamp
`source_state.watermark` as `<probe>|<scan>`. It snaps back to 60 s on any new
item or when Andrés interacts with Mesa (`lastInteractionAt`). "Barrer ahora" (or `mesa sweep`) emits
`sweep.requested` to the Mesa session `sweeper`, which `wait` long-polls, so the probe runs at once
(`sweep-tick.mjs force` is the lead's manual equivalent). A 429 or an MCP error backs that source off and sets its
health to `degraded` (`down` after repeated failures that are not rate limits) in `source_state`, which the rail
shows (Estados B); the next good probe sets it back to `ok`, which also resumes the salidas held for that source.

**On demand (the lead).** "Barre" from Andrés: if the sweeper is alive, nothing to do but tell him the button does
it; for a wider window ("qué hay desde el viernes") or with the sweeper down, run § 1-3 over the window yourself
(default: since 18:00 yesterday, local time) and report one line per source with counts.

## 0b. Ignored projects (read first, skip before triage)

Andrés ignores projects from Hoy or Tablero ("Ignorar proyecto «X»"). Read the list once per tick, before any
triage: `MESA ignore list --json` → `[{ id, source, project, label, hidden }]` (`source` is `github`, `slack`,
`basecamp`, `claude` or `*` for every source). Drop a probed message or notification whose project matches a row
**before** reading threads or recordings, so an ignored project costs no tokens:

- Slack: the row's `project` is the **channel id** (`C…`, `D…`, `G…`, the part of the externalId before the `:`).
- Basecamp: the row's `project` is the **project name** (the bucket name, as in `project` below).
- GitHub: the row's `project` is `owner/repo` (a hand-added row may hold the bare repo name: match either).
- A `*` row matches the same key or project name in any source.

Dropped items count as noise: the watermark still advances past them, and they are never upserted. If one slips
through, `mesa item upsert` answers `{ "ignored": true }` and stores nothing; that is not an error. To manage the
list by hand: `MESA ignore add <source|'*'> <projectKey> --label L`, `MESA ignore remove <id>`.

A skipped item ("Saltar", `MESA item skip <id>`) is never reopened by an upsert of the same `externalId`: it stays
done with waitOn none and only its content refreshes. A new `externalId` (a new comment) is a normal item.

## 1. GitHub: review requests (gate from pr-monitor step 2)

Source of truth for the rules: `C:/Users/z4yross/.claude-work/commands/pr-monitor.md` § "Step 2" and § "The gate"
(read those two sections, nothing else; never edit that file). Repos: `7-Arrow/dre-backend`, `7-Arrow/dre-frontend`,
`7-Arrow/dre-infra`, `7-Arrow/dre-connect-intake`, `designli/prospec-backend`, `designli/prospec-frontend`,
`designli/prospec-admin`.

```
gh search prs --review-requested=@me --state=open --limit 50 --json repository,number,title,url,updatedAt --repo 7-Arrow/dre-backend --repo 7-Arrow/dre-frontend --repo 7-Arrow/dre-infra --repo 7-Arrow/dre-connect-intake --repo designli/prospec-backend --repo designli/prospec-frontend --repo designli/prospec-admin
gh api repos/<repo>/pulls/<n> -q '[.head.sha, .draft, .user.login, .base.ref, .head.ref, .title] | @tsv'
gh api repos/<repo>/pulls/<n>/reviews --paginate -q '[.[] | select(.user.login=="acorrea-designli")] | last | [.state, .commit_id] | @tsv'
```

A PR enters when ANY holds: GitHub lists Andrés as requested reviewer (the search, which expands team requests);
its Mesa review ticket (open, or closed as Done after a post) has an `open` finding and the head moved or someone other than Andrés acted
(pr-monitor box B/C); a push dismissed his approval (`approvedHead` ≠ head). Discard: drafts, PRs authored by
`acorrea-designli`, release-train PRs (title `^\s*create\s+(staging|prod|production)\s+pr\s*$` AND both branches
long-lived: develop, staging, main, master, production, prod) unless Andrés names one. Already APPROVED by him at
the current head: skip (fast exit).

The Mesa server already upserts every open review request on its own (notifications poll + review search, every
`X-Poll-Interval`), so start with `MESA github sync` and only upsert by hand what the gate adds beyond plain review
requests (open findings, a dismissed approval). Use the server's dedupe key so both paths hit the same item:
`{"source":"github","externalId":"pr:<owner>/<repo>#<n>","kind":"pr_review","title":"<repo>#<n> <title>","url":"<url>","project":"<owner>/<repo>","need":"approve_pr","waitOn":"you","meta":{"head":"<sha>","author":"<login>"}}`.
Then each entering PR gets (or keeps) its own review ticket and reviewer: `mesa-review` § Spawning.

## 2. Basecamp: assignments, mentions, client comments

Read tools only: `mcp__basecamp__get_my_assignments`, `get_my_notifications`, `get_my_due_assignments`, `search`,
`get_by_url`, `list_comments`.

- **Assigned to him and open** (to-dos, cards): `kind: "assignment"`, `waitOn: "you"`.
- **Mentions of him** in the window: read the recording; it counts only if it asks him for something.
- **Client comments without his reply**: a comment by someone outside Designli on a recording in his projects,
  with no later comment by Andrés on the same recording. `kind: "client_comment"`, `waitOn: "you"`, excerpt = the
  ask in one line in the client's words.

`externalId` = the recording id (comments: `<recording>#<comment>`), `url` = the app URL, `project` = the project name.

In the periodic triage the input is only what the probe and the catch-up marked new. A new search hit or
notification: read its recording or comment (`get_by_url`) and apply the three rules above. A new priority assignment
is upserted as it is (`kind: "assignment"`, no `get_by_url`). The probe watermark advances to the newest hit's
`created_at`, the catch-up window to the newest notification's `unread_at`; they never share a value.

**Files (t41).** A recording or comment whose content (the `get_by_url` result, HTML) has a `<bc-attachment>` tag
or lists uploads carries files. Its `excerpt` starts with `[imagen] ` when every file is an image
(`content_type` `image/*`), else `[adjunto] `, then the ask in one line, and `meta.files` =
`[{"id":"<sgid, or the upload id when there is no sgid>","name":"<filename>","mime":"<content_type>","url":"<the attachment or upload URL>"}]`,
one entry per file. Take them from the content you already read; no extra call, and the sweeper never opens the
files (`get_upload`, `download_file` belong to the agents that draft or answer, preamble rule 18). A Basecamp-hosted
image with no `content_type` in the tag: judge by the filename extension (png, jpg, jpeg, gif, webp, heic).

## 3. Slack: who is waiting on him (slack-triage logic)

Source of truth: `C:/Users/z4yross/.claude-work/commands/slack-triage.md` (read it; never edit it). His user id is
`U06E2UBDC73`, workspace `designli.slack.com`. Three searches with `response_format: "detailed"`, `sort: "timestamp"`,
`sort_dir: "desc"`, `include_context: false`, up to 3 pages each:

1. `to:me after:<date>`, `channel_types: "im,mpim"`
2. `<@U06E2UBDC73> after:<date>`, `channel_types: "public_channel,private_channel"`
3. `from:me after:<date>`, all types (answers he already gave)

Group by conversation, keep the last incoming message, classify hard: **Te esperan** (an explicit ask AND he did not
write in that conversation afterwards; in a group DM it must be addressed to him) → upsert
`{"source":"slack","externalId":"<channelId>:<ts>","kind":"message","title":"<person> · <one-line ask>","url":"<permalink>","project":"<#channel-name, or the person for a DM>","meta":{"channel":"<#channel-name or DM person>"},"waitOn":"you"}`
(`project` and `meta.channel` are what "Ignorar proyecto «X»" shows; the ignore key is the channel id). With files,
`excerpt` and `meta.files` are added (§ Files below).
**Ya respondiste** and **Ruido** are not upserted; give their counts in the summary line only. Names, never user ids.

**Files (t41).** Search output omits attached files (a DM with a screenshot looked like plain text). So every
message classified **Te esperan** is read once more, before its upsert, with `slack_read_thread` and
`response_format: "detailed"` (its channel id and its own `ts`); noise and "Ya respondiste" are never read
this way. When the detailed read lists `Files: image.png (ID: F0CG7DCM8KC, image/png, 153.1 KB)`:
- `excerpt` starts with `[imagen] ` when every file is `image/*`, else `[adjunto] `, then the ask in one line;
- `meta.files` = `[{"id":"F0CG7DCM8KC","name":"image.png","mime":"image/png"}]`, one entry per file (id, name, mime
  from that line). Mesa shows an "imagen" or "adjunto" chip from it. The sweeper only detects and records files; it
  never opens them (`slack_read_file` belongs to the agents that draft or answer, preamble rule 18).
No `Files:` line: no marker and no `meta.files`. The extra read costs one call per "Te esperan" message, never one per
message probed.

In the periodic triage the input is only the new messages from the probe (ts above the watermark): group them by
conversation and apply the same rule; checking "he wrote afterwards" uses `slack_read_thread` or the conversation's
latest messages, not the three full searches; the detailed `slack_read_thread` of each **Te esperan** message is also
the file check above (one read serves both). The `externalId` is `<channelId>:<ts>`, so a message seen again
upserts the same item. The watermark advances to the newest ts seen, noise included.

## 4. Close (on-demand pass only)

Advance the watermarks you covered (`node G:/WorkSpace/designli/ops/scripts/sweep-tick.mjs report <source> --new N
--watermark W`) so the sweeper does not triage the same window again. One line to Andrés:
`GitHub N · Basecamp N · Slack N nuevos (te esperan M)`. The periodic sweep says nothing.
