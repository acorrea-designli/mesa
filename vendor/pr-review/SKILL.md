---
name: pr-review
description: Review a GitHub pull request with a simple binary outcome. If there are no issues, approve directly with no comments. If there ARE issues, do NOT post anything yet — present a pre-filtered issue list to the user in chat, let them review/discard/edit, and only post to GitHub what they approve. All PR comments in English, terse and pragmatic, never with Claude attribution. Use when the user asks to review a PR, "haz un review", "revisa la PR #N", or requests a light/quick PR review.
---

# PR review

`<mesa-repo>` below is the Mesa checkout this file lives in (`<mesa-repo>/vendor/pr-review/SKILL.md`).

Review a pull request. Two outcomes, but the issues path goes through the user first.

## Rules (non-negotiable)

1. **Outcome:**
   - **No issues** → `APPROVE` with an **empty body**. No comment, no "LGTM", nothing. Do this directly.
   - **Issues found** → **do NOT post anything to GitHub yet.** Present the pre-filtered issue list in chat and wait for the user to approve. Never auto-approve and never auto-comment when issues exist.
2. **Human gate on issues.** When there are issues, I am a pre-filter, not the reviewer of record. The user reviews my findings (as if reviewing me), discards/edits/adds, and only then do I post. The final GitHub review contains exactly what the user approved — nothing I added on my own.
3. **Every finding is written in English — everywhere it is delivered, not just GitHub.** GitHub comments, Slack messages from the PR monitor, desktop notifications, and the long-form **Explain more** write-ups are all English. The ONE exception is the running commentary in the terminal to the user, which stays in their language.

   The test: *if this text describes a defect, it is English.* It does not matter that it is going to Slack and not to a repo — Slack findings get copied verbatim into GitHub when the user hits **Post**, and the authors on these repos do not all read Spanish. This covers the UI chrome too — button labels, the actions prompt, the digest. The only thing that follows the user's language is the running commentary in the terminal.
4. **Never add Claude/AI attribution** to any comment, review body, or anything posted to the repo. No "🤖 Generated with Claude", no "as an AI". Write as the reviewer.
5. **Terse and direct.** Devs skim. One or two sentences per issue: what's wrong + where + the fix if it's not obvious. No preamble, no praise, no restating the code back.
6. **Only real issues.** Bugs, correctness, security, data loss, broken contracts, missing error handling that matters. Skip style nitpicks, personal preferences, and anything a linter/formatter already owns. Optional stuff gets a `nit:` prefix or gets dropped. Pre-filter hard — the point of the human gate is that the user sees a short, high-signal list, not everything I could possibly say.
7. **Read the PR conversation first — always, no exceptions.** The diff is half the input; the threads are the other half. Before forming a single finding, pull the existing reviews, the review comments (including the ones GitHub marks outdated or resolved) and the issue comments. Then:
   - **Something already raised in a thread is not a new finding.** If it still stands after the author's reply, continue it as a reply *in that thread* (`in_reply_to`), never as a fresh top-level comment. A finding that reappears as if it were new reads like a reviewer with no memory.
   - **Findings I asked for in an earlier pass are context, not discoveries.** When the author implemented what I requested and the implementation brought a new problem, say exactly that — the continuation of my own thread, not a fresh objection.
   - **When the code argues against the objection, engage the argument.** Authors defend anticipated objections in code comments, the PR body, and thread replies. Read the defence, then either drop the finding or refute it on its own terms, quoting it. Never restate an objection the PR already answers without addressing the answer.
   - **What was fixed or dropped stays dropped.** An issue the author resolved, or that the reviewer let go, does not come back on the next pass.

## Flow

0. **Read the conversation before the code.** `gh api repos/<owner>/<repo>/pulls/<n>/reviews`, `.../pulls/<n>/comments`, `.../issues/<n>/comments`. Build the ledger of what has already been raised, answered, fixed or dropped, and note the thread id (`in_reply_to` target) of anything still live. Rule 7 governs what may be done with each entry.
1. Read the PR: `pull_request_read` `get` (metadata) + `get_diff`. For non-trivial diffs also pull the surrounding files to confirm context (imports, callers, types).
2. Decide: are there real issues per rule 6 that survive the step-0 ledger per rule 7?
3. **If no issues:** `pull_request_review_write` `create` with `event: APPROVE` and an **empty `body`**. Tell the user in one line that it's approved.
4. **If issues — present, don't post.** List each candidate issue in chat, numbered, with `file:line`, the one-line problem, and the proposed fix. For each, mark whether it's a blocker (`REQUEST_CHANGES`) or a comment (`COMMENT`). Then ask the user which to keep. Wait.
5. **After the user decides:** post only the approved issues as inline comments via a pending review — `pull_request_review_write` `create` (no `event` → pending) → `add_comment_to_pending_review` per approved issue → `pull_request_review_write` `submit_pending` with `event: COMMENT` (or `REQUEST_CHANGES` if any approved issue is a blocker). Review body empty or one line; value is in the inline comments. Do NOT approve on this path.
   - **Continuations go in their thread**, not in the review: `node <mesa-repo>/vendor/pr-gh.mjs reply <owner/repo> <n> <comment_id> <body.txt>`. Only genuinely new findings belong in the pending review.
6. Report back in one line: N issues posted (and N replies into existing threads).

**Writing to GitHub from the shell.** If the MCP review tools are not available, every write goes through one script, invoked **bare** — no `cd`, no `&&`, no trailing `; echo $?`, because permission rules match by prefix and any prefix or suffix breaks the match:

```
node <mesa-repo>/vendor/pr-gh.mjs approve <owner/repo> <pr> [sha]
node <mesa-repo>/vendor/pr-gh.mjs review  <owner/repo> <pr> <APPROVE|REQUEST_CHANGES|COMMENT> <payload.json>
node <mesa-repo>/vendor/pr-gh.mjs reply   <owner/repo> <pr> <in_reply_to_id> <body.txt>
```

It runs under the token of the configured GitHub login (`MESA_GH_USER`; the active `gh` account is often a different one that 404s on the organisation's repos) and uses REST, because `gh pr review` goes through GraphQL and fails for the same reason. `review` takes `{ "body", "commit_id", "comments": [ { "path", "line", "body" } ] }` from a file, so finding text never passes through shell quoting. One JSON line out; `ok: true` means the write landed.

## Scoped re-review (only what changed)

When the PR was already reviewed at a known SHA — the `pr-monitor` state holds a `head` for it, the user says "re-review", "look at the new changes", or the conversation ledger from step 0 shows my own earlier pass — the review is **incremental**. Re-reading the whole diff burns tokens and drags back issues that were already settled.

1. **Find the range.** `gh api repos/<owner>/<repo>/compare/<reviewed sha>...<current head> -q '.status, (.files|length)'`.
   - `ahead` → review ONLY that range. Its `files[].patch` is the diff; read the surrounding code as needed to judge it.
   - `diverged` / `behind` → rebase or force-push, the range is meaningless. Fall back to the full diff and say so.
2. **Re-verify every finding that was left open**, whether it was posted to GitHub or only reported in chat. Anchor by the source line's TEXT, not its line number — line numbers move with every commit. Each one lands on a verdict:
   - **fixed** — the problem is gone. State in one line what the code does now, so the verdict is checkable.
   - **still open** — unchanged. Do not re-explain it; it was explained when it was raised. One line plus its thread link.
   - **changed** — the code was rewritten and the problem mutated into a different one. Close the old finding and open a new one describing the new shape.
3. **A thread reply is not verification.** "Fixed in `<sha>`" says where to look, not that it works. The verdict comes from reading the code at the current head. A dev who believes they fixed something and did not is exactly the case a re-review exists to catch.
4. **New findings come from the range** — or from something in the range that breaks code outside it. The scope limits what you read, not what a change is allowed to break.
5. Report as `N fixed · M still open · K new`. Continuations of an open finding go as a reply in its existing thread (`in_reply_to`), never as a fresh comment; only genuinely new findings go into a new pending review.

## PRs Copilot already reviewed — the Copilot report

On repos where the configured user is the tech lead and owes a review on every PR, and the authors use Copilot as their first-pass reviewer, a review is two jobs, done together. Neither replaces the other.

**1. The review is a normal review** — same rules, same flow, same outcome. Copilot's comments are part of the step-0 ledger, like any other reviewer's thread:

- A Copilot finding that is **valid and still open** at head is not a new finding of mine. If it is worth backing, it goes as a reply **in Copilot's thread** (`in_reply_to`), confirming it and adding what Copilot got wrong or left out, such as severity or a better fix.
- A Copilot finding that is **valid and fixed** stays closed. Verify the fix in the code, as always. The author's reply is not evidence.
- A Copilot finding that is **wrong** is not repeated. If the author already pushed back correctly, nothing to add. If the author "fixed" a false positive in a way that made the code worse, that is a finding of mine.
- Everything Copilot **missed** is found the normal way: read the diff yourself. Copilot's coverage never shrinks what I read.

**2. The Copilot report** — a running, append-only file, separate from the review. It is never posted to GitHub or Slack:

```
~/.claude-work/copilot-report.md
```

One entry per review pass, newest at the bottom, in **English**:

```markdown
## <owner/repo>#<n> · <sha7>..<sha7> · <YYYY-MM-DD>
Copilot: <N> findings over <K> reviews (effort: Lite/…)

| # | Copilot finding | Valid? | At head | Note |
|---|---|---|---|---|
| r<comment id> | <one line> | yes / no / partly | fixed / open / rejected by author | <why: the evidence, e.g. backend guard X> |

**Missed:** <real issues Copilot did not raise, one line each, or "nothing">
**Noise source:** <why it produced false positives, if there is a pattern — stale docs, missing backend context, …>
**Verdict:** sufficient / not sufficient — <one line>
```

The report exists to answer, over time, whether Copilot's pass can be trusted on these repos. So the patterns matter more than any single entry: which kinds of issue it catches, which it misses, and what keeps misleading it. Write the **Noise source** and **Missed** lines with that in mind. Judge validity by reading the code, the backend included when the claim depends on it, exactly like a finding of my own.

## Candidate list format (chat, step 4)

Keep it scannable — this is what the user "reviews":

```
1. [blocker] src/example/client.ts:26
   fetch(url) can reject and there's no catch — the request silently no-ops.
   fix: wrap in try/catch or let the error propagate to the caller's handler.

2. [nit] src/example/client.ts:5
   duplicates parseName from src/example/util.ts — extract a shared helper if it grows.
```

Then ask which to keep (all / by number / none). The candidate list itself is English; the question to the user follows their language.

## Comment style — examples (what gets posted)

Good:
- `Race condition: two callers can both pass this check before either writes. Use a transaction or upsert.`
- `Unhandled: fetch can reject and this promise has no catch — the request silently no-ops.`
- `nit: duplicates parseName from util.ts — consider a shared helper if it grows.`

Bad (never do this):
- `Great work on this PR! I noticed a small thing...` (praise, preamble)
- `As an AI reviewing this code, I would suggest...` (attribution)
- Three paragraphs explaining what the function does before getting to the point.
