---
name: mesa-review
description: Per-PR review in Mesa - one reviewer agent per pull request runs the pr-review skill unchanged in quality, reviews incrementally (only new commits, verify open findings, never re-review what was reviewed), keeps finding state (open/fixed/waived/dismissed, comment ids), and offers Andrés Approve, Approve anyway, Post, Dismiss and Explain more on the review card; Post sends one batched GitHub review per decision, sent by the lead after the 20 s undo. Use for "haz un review pass", "revisa la PR", "review pass en GitHub", a review request found by mesa-sweep, or a team PR a tl needs reviewed.
---

# Mesa review (one reviewer per PR)

`pr-review` (`C:/Users/z4yross/.claude-work/skills/pr-review/SKILL.md`) is the quality bar and is used unchanged:
read the conversation before the code, only real issues, terse, English, no attribution, the Copilot report on the
`designli/prospec-*` repos. This skill replaces only its delivery: where pr-review shows findings in chat and posts
after the user decides, Mesa shows them on the ticket's review card and posts through github salidas. pr-monitor's rules for state and
incremental review (`C:/Users/z4yross/.claude-work/commands/pr-monitor.md` steps 2, 3 and "When a click arrives")
apply as written. Never edit or disable pr-monitor or pr-review.

`MESA` = `node G:/WorkSpace/designli/ops/bin/mesa`. The reviewer's command sheet is in `.claude/agents/reviewer.md`.

## Spawning (lead)

- **Requested review**: one ticket per PR, titled `Review <owner/repo>#<n> · <author login>: <PR title>` (Andrés, 2026-11-09: he wants the author on every PR ticket). Find it by the PR, never by
  the title (a renamed PR would not match): `MESA review list` (no `--ticket`), take the row with that `repo` and
  `pr`, and its `ticketId` is the PR's ticket, closed or not (`MESA ticket show <ticketId>` gives the `ref`). A closed
  one comes back with `MESA ticket reopen <ticketId> --reason "new push"` (Mesa also reopens it by itself on a new
  head). Never `ticket ask` for a PR that has a review row with a `ticketId`: `MESA review open` would move the review
  to the duplicate and the original would reopen with no owner. Only when no review row exists, or its `ticketId` is
  null (a pr-monitor import), look for a ticket with that title
  (`MESA ticket list`, closed included) and, finding none, `MESA ticket ask --title "Review <owner/repo>#<n> · <author>:
  <title>" --body "FYI: revisión en curso <url>"`. Brief: repo, PR, URL, author, why it entered (requested / tracked
  advance / post-approve push).
  Spawn `reviewer-<ref>` (next suffix if that name was used) as the owner.
  **Card first** (Andrés, 2026-11-09: tickets and Tablero cards move together): never open a review ticket with
  `ticket ask`, because that ticket has no card. Find the PR's card in `MESA task list --source github` (match
  `items[].url`). If there is none, create one with `MESA task create --title "<repo>#<n> · <author>: <PR title>"
  --project <owner/repo> --source github --station todo`. Then run `MESA task dispatch <taskId> --kind review`. That
  gives a linked ticket and a `ticket.created` wake, which the lead routes like a card Andrés handed over: claim, move
  the card to doing, spawn the reviewer. The card goes to waiting on READY and to done when the ticket closes.
- **Review pass** ("haz un review pass"): run `mesa-sweep` § 1, then one ticket and one reviewer per entering PR,
  at most 5 at a time in pr-monitor's order (tracked advance, moved, new, untracked advance; oldest first). The
  rest wait for a slot; say `+N en cola`.
- **Team review**: the tl's `NEED reviewer <ref> PR <url>` → `reviewer-<ref>` (or `-2`, `-3` for further PRs) as a
  teammate. Verdict by message to the implementer and the tl; findings still recorded; no GitHub writes.

## Review (reviewer)

1. **Boot.** `MESA ticket context <ref>` (its `findings` are the stored findings with their state; `reviews[]` has the
   reviewed `headSha` and, when the ticket was reopened by a new push, `seenHead`: review `headSha..seenHead`; the latest
   reviewer handoff's `review-state` block has `head` and `approvedHead`, § State). None in Mesa: read (never write) the PR's entry in `C:/Users/z4yross/.claude-work/pr-monitor-state.json`,
   which has the same shape, so a PR pr-monitor already reviewed is not re-reviewed. Neither: the PR is new
   (pr-monitor box A).
2. **Fast exit.** Andrés already APPROVED at the current head (the reviews GET): every `open` finding → `waived`,
   `approvedHead` = head, handoff, `DONE <ref> approved at head`, stop.
3. **Box.** State `head` absent → full review (pr-monitor 3A). Head moved → `compare <head>...<new>`: `ahead` →
   review only that range (3B); `diverged`/`behind` → full review and say `rebase — full review`. Same head with a
   human (not Andrés, not a bot) acting after `checkedAt` → verification only (3C). A post-approve push → incremental
   from `approvedHead`; closed findings never resurrect.
4. **Read the conversation first** (pr-review rule 7): reviews, review comments (outdated and resolved included),
   issue comments. A point already raised continues in its thread (`ghCommentId`), never as a new finding.
5. **Verify every `open` finding** at the new head by its `anchor` text, not its line: `fixed` (say what the code does
   now), still `open`, or changed (close as `fixed`, open a new one). The author's "fixed in abc" verifies nothing.
   `dismissed` and `waived` findings are never reported again, even if found again in the same place.
6. **New findings** come from the range, or from something in it that breaks code outside it. Verify each before
   writing it: a false blocker costs more than a missed nit.
7. **Record**, always starting with `MESA review open <ref> --repo owner/name --pr N --sha <head>` (the full head
   sha you reviewed). It creates the review card on the ticket, with Approve, even when the pass has zero findings;
   it is idempotent, and a new head reopens a card that was already approved. Without it a clean pass has no card.
   Then every finding with `MESA finding upsert <ref> --json -` (new ones without `n`, Mesa numbers them; changed
   states with their `n`), then a handoff with the `review-state` block, before anything else.

## Ask (reviewer → Andrés)

The findings are the ask: Mesa renders them on the ticket's review card with pr-monitor's buttons, so there is no
A/B question. Post one ticket reply as the summary: ONE line in Spanish with the counts and, if there is one, what
the blocker is in plain words (e.g. `1 blocker, 1 nit: el permiso por tipo de evaluación solo lo aplica el selector.`).
Never repeat the findings, paths, line numbers or sha in the reply: they are already on the review card (hook G12 refuses a reviewer's
`mesa ticket reply` with more than 2 non-empty lines, a `path/file.ext:NN` or a sha). Andrés,
2026-11-09 (t3): "en los tickets de pr hay como mucho ruido". Add a second line only for something the card cannot
show (e.g. a merge order: "no mergear antes de be#473"). Incremental passes say `re-review: K arreglados · M
pendientes · P nuevos`; verification passes `verificación: K arreglados · M pendientes`. A clean pass says
`Sin hallazgos, recomiendo Approve.` Then wait, handoff written.

`--ask` only on a review Andrés requested (his decision is pending on the card): that summary reply goes with `--ask`,
so the ticket moves to "Te espera"; a reply without `--ask` or options leaves the status alone. A team review for a
tl reports without `--ask`: the tl's ticket must not park in "Te espera" for a card Andrés does not own.

Buttons by state, as in pr-monitor: open blockers → Post, Explain more, Dismiss, Approve anyway; open nits only →
Post, Dismiss, Approve; nothing open → Approve (and Re-review, which is a ticket reply asking for it).

## Act on his click (reviewer)

Each press calls `POST /api/reviews/:id/actions`. Mesa wakes the lead with `review.action {action, repo, pr,
findingNs, salidaIds, note, ticketRef}`, and the lead relays `ANSWER <ref> review.action <action> <findingNs>
<salidaIds>`. The press is Andrés's approval of the exact text on the card: approve, approve_anyway and post create
github salidas that are already approved and in the 20 s undo window. You never propose GitHub salidas yourself.

- **approve / approve_anyway**: nothing to send. On the lead's `SENT`: every open finding → `waived` at the head
  sha (never `fixed`), `approvedHead`/`approvedAt` in the review-state, DONE. Approving publishes nothing else, not
  even nits (pr-monitor, 2026-09-07); approve_anyway's trail is the waived blockers listed in your DONE.
- **post**: on `SENT <ref> <salidaIds> <commentIds>`, the lead has already stored each `ghCommentId`; set
  `posted: true` in the review-state.
- **dismiss**: `MESA finding upsert` each listed finding with `state: "dismissed"` (keep `at` and `anchor`) unless
  Mesa already did; an FYI reply naming any blocker among them. No GitHub write.
- **explain**: reread the code with more context, write the English long form (*Why it is a problem*, *What breaks,
  concretely*, *The fix* with a fenced code block) into the finding's `explanation` with `finding upsert`. The card
  shows it; it never goes into the ticket reply too (that would show it twice, t50). The reply is one line: `Detalle
  en el hallazgo N de la tarjeta.` Say so in that line if the finding is already closed.
- **Re-review** (a ticket reply): incremental from `head`; if `head` is the current head, a full review (never a no-op).

Then the final handoff and `DONE <ref> reviewer-<ref> <N fixed · M open · K new | approved | posted N>` to
`team-lead`, and stop. Once Andrés's choice is executed (approved, or posted and waiting on the
author), nothing depends on us: the lead closes the ticket (Done), even with `open` findings. The next push reopens the
same ticket and brings a new reviewer
(`mesa-sweep` gate) that boots from the stored findings and your state.

## State

Findings live in Mesa (`mesa finding upsert|list`, keyed by repo, pr and `n`), with pr-monitor's fields: `label`,
`at`, `anchor`, `summary`, `explanation`, `state` (`open`, `fixed` = the code changed, `dismissed` = not valid,
`waived` = valid and approved anyway), `sha`, `ghCommentId`. What the findings table does not hold goes in the
handoff's `review-state` block:

```review-state
{"repo":"7-Arrow/dre-backend","pr":352,"head":"15e6fb79…","checkedAt":"2026-11-03T20:10:00Z","outcome":"reported",
 "posted":true,"approvedHead":null,"approvedAt":null}
```

Timestamps in UTC with `Z`. When Mesa has no state for a PR, seed it from pr-monitor-state.json (read-only, § Review 1).

## Lead writes (on `salida.released` for github salidas)

One click is one GitHub write, as in pr-monitor. The salidas of one `review.action` (its `salidaIds`) are released
together; send them as a batch through pr-gh.mjs (PowerShell tool, bare; hook G5 checks each write has a released
github salida for that repo and PR):

- **approve / approve_anyway** (`github_review`, event APPROVE): `node C:/Users/z4yross/.claude-work/pr-gh.mjs approve
  <repo> <pr> <commitId>`, always with an empty body.
- **post**: ONE review per decision. Every new finding (`github_comment` with `path`/`line`) goes into a single
  payload, `{"body":"","commit_id":"<commitId>","comments":[{"path","line","body"}, …]}` written with the Write tool
  to `<scratchpad>/lead/review-<ref>-<n>.json`, sent with
  `node C:/Users/z4yross/.claude-work/pr-gh.mjs review <repo> <pr> <REQUEST_CHANGES if any is a blocker, else COMMENT> <payload>`.
  A finding that already has a thread (`inReplyTo` on the destination, or its `ghCommentId`) continues there:
  `node C:/Users/z4yross/.claude-work/pr-gh.mjs reply <repo> <pr> <inReplyTo> <scratchpad>/lead/reply-<salida>.txt`.
  A finding whose file is not in the diff has no `path`: its text goes in the review body.
- Then for each salida `MESA salida sent <id> --permalink <url>` (or `failed --error`), `MESA finding upsert` with the
  returned `ghCommentId`, and one `SENT <ref> <salidaIds> <commentIds>` to the reviewer.
- **Sandbox** (`echo $MESA_ENV` prints `sandbox`): no pr-gh.mjs call (hook G11 blocks it). For each salida
  `MESA salida sent <id> --simulated`, no `ghCommentId` on the findings, and `SENT <ref> <salidaIds> simulated` to
  the reviewer.
