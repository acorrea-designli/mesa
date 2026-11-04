---
name: mesa-sweep
description: On-demand sweep of everything waiting on Andrés - GitHub review requests (the pr-monitor gate), Basecamp assignments, mentions and client comments without his reply, and Slack messages that expect his answer (the slack-triage logic) - fed into Mesa with mesa item upsert. Read-only toward the sources. Use when Andrés says "barre", "sweep", "qué hay pendiente", "actualiza mesa", "revisa GitHub/Basecamp/Slack", or when the Mesa poller or a push integration is down. Lead only.
---

# Mesa sweep (lead, read-only toward every source)

The Mesa server polls GitHub on its own; Slack and Basecamp push come later. This skill is the fallback and the
on-demand pass. It never writes to GitHub, Basecamp or Slack: no comments, no reactions, no mark-as-read. Its only
writes are `mesa item upsert` (idempotent by `source` + `externalId`, so a re-sweep never duplicates).

`MESA` = `node G:/WorkSpace/designli/ops/bin/mesa` (Bash tool, bare). Item JSON is the server's ItemInput:
`{source, externalId, kind, title, excerpt?, project?, url?, need?, station?, waitOn?, meta?, receivedAt?}` with
`waitOn` one of `you | client | claude | none | person:<name>`. Upsert one item per call:
`MESA item upsert --json -` with the JSON on stdin (heredoc).

Window: since the last sweep (`mem_search session/mesa-lead` gives it; default: since 18:00 yesterday, local time).
Say one line per source with counts. Private content stays in Mesa; never copy it elsewhere.

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
its Mesa review ticket has an `open` finding and the head moved or someone other than Andrés acted
(pr-monitor box B/C); a push dismissed his approval (`approvedHead` ≠ head). Discard: drafts, PRs authored by
`acorrea-designli`, release-train PRs (title `^\s*create\s+(staging|prod|production)\s+pr\s*$` AND both branches
long-lived: develop, staging, main, master, production, prod) unless Andrés names one. Already APPROVED by him at
the current head: skip (fast exit).

Upsert: `{"source":"github","externalId":"<repo>#<n>","kind":"pr_review","title":"<repo>#<n> <title>","url":"<url>","need":"review","waitOn":"you","meta":{"head":"<sha>","author":"<login>"}}`.
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

## 3. Slack: who is waiting on him (slack-triage logic)

Source of truth: `C:/Users/z4yross/.claude-work/commands/slack-triage.md` (read it; never edit it). His user id is
`U06E2UBDC73`, workspace `designli.slack.com`. Three searches with `response_format: "detailed"`, `sort: "timestamp"`,
`sort_dir: "desc"`, `include_context: false`, up to 3 pages each:

1. `to:me after:<date>`, `channel_types: "im,mpim"`
2. `<@U06E2UBDC73> after:<date>`, `channel_types: "public_channel,private_channel"`
3. `from:me after:<date>`, all types (answers he already gave)

Group by conversation, keep the last incoming message, classify hard: **Te esperan** (an explicit ask AND he did not
write in that conversation afterwards; in a group DM it must be addressed to him) → upsert
`{"source":"slack","externalId":"<channel>:<ts>","kind":"message","title":"<person> · <one-line ask>","url":"<permalink>","waitOn":"you"}`.
**Ya respondiste** and **Ruido** are not upserted; give their counts in the summary line only. Names, never user ids.

## 4. Close

`mem_save` topic `session/mesa-sweep` (upsert): the time of this sweep and the counts per source. One line to Andrés:
`GitHub N · Basecamp N · Slack N nuevos (te esperan M)`.
