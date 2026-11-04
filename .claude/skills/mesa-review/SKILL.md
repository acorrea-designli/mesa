---
name: mesa-review
description: Per-PR review in Mesa - one reviewer agent per pull request runs the pr-review skill unchanged in quality, reviews incrementally (only new commits, verify open findings, never re-review what was reviewed), keeps finding state (open/fixed/waived/dismissed, comment ids), and offers Andrés Approve, Approve anyway, Post, Dismiss and Explain more; GitHub writes go out as github salidas the lead sends after approval. Use for "haz un review pass", "revisa la PR", "review pass en GitHub", a review request found by mesa-sweep, or a team PR a tl needs reviewed.
---

# Mesa review (one reviewer per PR)

`pr-review` (`C:/Users/z4yross/.claude-work/skills/pr-review/SKILL.md`) is the quality bar and is used unchanged:
read the conversation before the code, only real issues, terse, English, no attribution, the Copilot report on the
`designli/prospec-*` repos. This skill replaces only its delivery: where pr-review shows findings in chat and posts
after the user decides, Mesa shows them in the ticket and posts through salidas. pr-monitor's rules for state and
incremental review (`C:/Users/z4yross/.claude-work/commands/pr-monitor.md` steps 2, 3 and "When a click arrives")
apply as written. Never edit or disable pr-monitor or pr-review.

`MESA` = `node G:/WorkSpace/designli/ops/bin/mesa`. The reviewer's command sheet is in `.claude/agents/reviewer.md`.

## Spawning (lead)

- **Requested review**: one ticket per PR, titled exactly `Review <owner/repo>#<n>: <PR title>`. Find it with
  `MESA ticket list --open`; none: `MESA ticket ask --title "Review <owner/repo>#<n>: <title>" --body "FYI: revisión
  en curso <url>"`. Brief: repo, PR, URL, author, why it entered (requested / tracked advance / post-approve push).
  Spawn `reviewer-<ref>` (next suffix if that name was used) as the owner.
- **Review pass** ("haz un review pass"): run `mesa-sweep` § 1, then one ticket and one reviewer per entering PR,
  at most 5 at a time in pr-monitor's order (tracked advance, moved, new, untracked advance; oldest first). The
  rest wait for a slot; say `+N en cola`.
- **Team review**: the tl's `NEED reviewer <ref> PR <url>` → `reviewer-<ref>` (or `-2`, `-3` for further PRs) as a
  teammate. Verdict by message to the implementer and the tl; findings still recorded; no GitHub writes.

## Review (reviewer)

1. **Boot.** `MESA ticket context <ref>`. The latest reviewer handoff's `review-state` block is the prior state
   (§ State). None in Mesa: read (never write) the PR's entry in `C:/Users/z4yross/.claude-work/pr-monitor-state.json`,
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
7. **Record** the state (§ State) in a handoff right away, before asking anything.

## Ask (reviewer → Andrés)

One ticket reply. First line in Spanish with the counts and the question; then the findings in English, numbered,
in pr-review's candidate format (`[blocker|nit] path:line`, the one-line problem, `fix:`). Options by state, exactly
pr-monitor's buttons:

| State | Options (`--option key:label`) | Recommend |
|---|---|---|
| open blockers | `post:Post` · `explain:Explain more` · `dismiss:Dismiss` · `bypass:Approve anyway` | post |
| open nits only | `post:Post` · `dismiss:Dismiss` · `approve:Approve` | approve, unless a nit is worth the author's time |
| nothing open (clean, or all fixed now) | `approve:Approve` · `rereview:Re-review` | approve |

Incremental passes start with `re-review <sha7>..<sha7> · K fixed · M pending · P new`; verification passes with
`verification · K fixed · M pending`. He may answer with numbers (`post 1,3`, `dismiss 2`, `explain 1`); no numbers
means every open finding.

## Act on his answer (reviewer)

- **approve / bypass**: propose one github salida: `--source github --dest
  '{"kind":"github_review","repo":"<repo>","pr":<n>,"event":"APPROVE","commitId":"<head>","postAs":"acorrea-designli"}'
  --title "Approve <repo>#<n>" --context "<waived findings, one line each; bypass: the blockers overridden>"
  --body "Approve at <sha7> with no comment."` Approving publishes nothing else, not even nits (pr-monitor,
  2026-09-07). On `SENT`: open findings → `waived` with the sha, `approvedHead`/`approvedAt`, DONE.
- **post**: one github salida per finding. New finding: `{"kind":"github_comment","repo":"<repo>","pr":<n>,
  "event":"REQUEST_CHANGES" for a blocker or "COMMENT","path":"<path>","line":<line>,"commitId":"<head>",
  "findingN":<n>,"postAs":"acorrea-designli"}` with the comment text as the body (English, terse, no praise). A
  finding that already has a `ghCommentId` continues in its thread: same destination without path/line, the body
  is the continuation, and the context says `reply to <ghCommentId>`. A finding whose file is not in the diff has no
  path: its text goes as the review body. On `SENT <ref> <salida> <commentId>`: store `ghCommentId`, `posted: true`.
- **dismiss**: those findings → `dismissed` (keep `at` and `anchor`); FYI reply listing them, blockers named. No
  GitHub write.
- **explain**: a reply in English with three parts, *Why it is a problem*, *What breaks, concretely*, *The fix*
  (fenced code), after rereading the code with more context. Say so at the end if the finding is already closed.
- **rereview**: incremental from `head`; if `head` is the current head, a full review (never a no-op).

Then the final handoff and `DONE <ref> reviewer-<ref> <N fixed · M open · K new | approved | posted N>` to
`team-lead`, and stop. The ticket stays open while findings are `open`; the next push brings a new reviewer
(`mesa-sweep` gate) that boots from your state.

## State (the handoff's `review-state` block)

The same fields as pr-monitor's state, so the next instance continues instead of starting over:

```review-state
{"repo":"7-Arrow/dre-backend","pr":352,"head":"15e6fb79…","checkedAt":"2026-11-03T20:10:00Z","outcome":"reported",
 "posted":true,"approvedHead":null,"approvedAt":null,
 "findings":[{"n":1,"label":"blocker","at":"src/x/y.service.ts:72","anchor":"if (await this.isNoOpDocumentSave(evaluationId, dto, transaction)) {",
   "summary":"no-op replay returns 200 after the status reset already committed","state":"open","sha":"2ca68448","ghCommentId":3951307385}]}
```

`state` is `open`, `fixed` (the code changed), `dismissed` (not a valid finding) or `waived` (valid, approved anyway).
Timestamps in UTC with `Z`.

## Lead writes (on `salida.released` for a github salida)

`MESA salida show <id>`, then exactly one write through pr-gh.mjs (PowerShell tool, bare, as pr-monitor's command
sheet requires; the G5 hook checks the salida is released for that repo and PR):

```
node C:/Users/z4yross/.claude-work/pr-gh.mjs approve <repo> <pr> <commitId>
node C:/Users/z4yross/.claude-work/pr-gh.mjs review <repo> <pr> <REQUEST_CHANGES|COMMENT> <scratchpad>/lead/review-<salida>.json
node C:/Users/z4yross/.claude-work/pr-gh.mjs reply <repo> <pr> <ghCommentId> <scratchpad>/lead/reply-<salida>.txt
```

The review payload is `{"body":"","commit_id":"<commitId>","comments":[{"path":"<path>","line":<line>,"body":"<approved text>"}]}`
written with the Write tool. An APPROVE always goes with an empty body. Then `MESA salida sent <id> --permalink <url>`
(or `failed --error`), and `SENT <ref> <salida> <commentIds>` to the reviewer.
