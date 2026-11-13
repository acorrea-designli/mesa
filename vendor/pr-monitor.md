# PR monitor rules (Mesa excerpt)

This is the rule set Mesa's `mesa-review` and `mesa-sweep` skills cite: which PRs enter a review pass, what state a
reviewed PR keeps, how an incremental review works, and what each click on a review card does. The standalone
monitor this comes from also pushed findings to Slack through a local button listener; that delivery layer is not
part of Mesa and is left out. In Mesa the findings live on the ticket's review card (`mesa finding upsert|list`) and
the writes to GitHub go through `<mesa-repo>/vendor/pr-gh.mjs` after a click.

"The user" is the person whose board this is, and "the configured login" is their GitHub login (`MESA_GH_USER`).
`<mesa-repo>` is the Mesa checkout this file lives in.

Three ideas govern everything below:

1. **A PR with open findings is never let go.** It stays in the state pass after pass until the user approves it,
   dismisses the findings, or the author fixes them. Devs almost never ask for a re-review: the reviewer has to notice
   on its own.
2. **What has already been reviewed is not reviewed again.** If you already read 40 files of that PR and the author
   pushed a commit, what gets reviewed is *that commit*, plus verification of the findings that were left open. A
   full re-review burns tokens and drags back findings that were already discussed.
3. **Nothing is re-sent just because it is still open.** A PR earns a message only when there is something NEW to say:
   new commits, a finding that changed state, a new finding, or activity from someone other than the user. "Still
   pending" is not news.

   Ideas 1 and 3 are not in tension. Idea 1 is about *tracking*: the finding stays alive in the state and re-enters
   the pass by itself the moment the author touches anything. Idea 3 is about *telling*: a tracked PR sits silently
   until it has something new.

## Language

Everything a review emits is in English: findings, explanations, the "fixed" one-liners, the long-form **Explain
more** write-up, button labels, and anything that later lands in GitHub. The test: *if it leaves this session, it is
English.* Findings are copied verbatim into GitHub when the user hits **Post**, and the authors on the repos do not
all read Spanish. The one exception is the running commentary to the user, which follows their language.

## State

State shape (`version: 2`). In Mesa the same fields live in each finding and in the reviewer handoff's
`review-state` block; the standalone monitor kept them in a JSON file:

```json
{
  "version": 2,
  "prs": {
    "owner/repo#285": {
      "head": "15e6fb79...",
      "reviewedAt": "2026-09-07T11:20:00",
      "checkedAt": "2026-09-07T11:36:00",
      "outcome": "reported",
      "posted": true,
      "findings": [
        {
          "id": 1,
          "label": "blocker",
          "at": "src/x/y.service.ts:72",
          "anchor": "if (await this.isNoOpDocumentSave(evaluationId, dto, transaction)) {",
          "summary": "no-op replay returns 200 after the status reset already committed",
          "state": "open",
          "sha": "2ca68448",
          "ghCommentId": 3951307385
        }
      ]
    }
  },
  "lastTickAt": "2026-09-07T11:36:00"
}
```

The fields that do the work:

- **`head`**: the SHA already reviewed. It is the base of the incremental diff, not just a "seen" marker.
- **`checkedAt`**: when the PR was last looked at. Compared against the PR's `updated_at` to tell whether there was
  activity (commits, comments, threads) without spending a single extra call.
- **`outcome`**: `clean` (reviewed, no findings) or `reported` (findings were reported).
- **`findings[]`**: the heart of the tracking. Each finding has a `state`: `open`, `fixed` (the code changed),
  `dismissed` (it was not a valid finding), `waived` (it was valid and was approved anyway). A PR with at least one
  `open` **is tracked** and is not let go; the other three states are never reported again.
- **`anchor`**: the line of code, as text, where the finding lives. Line numbers move with every commit; the text of
  the line does not. It is re-anchored by searching for that text in the file at the new head.
- **`approvedHead` / `approvedAt`**: the SHA the user approved and when. While the head is still that SHA, the PR is
  not even looked at.
- **`ghCommentId`**: if the finding was published (the **Post** button), the id of its comment. With that, a
  re-review continues *in that thread* instead of opening a new one.

A bare string value is `{"head": <string>}`; a `dismissed` list is findings with `state: "dismissed"`. An entry with
no `findings` is a PR reviewed before this schema: treat it as `outcome: "clean"`. If the state does not exist or is
corrupt, treat everything as new.

## Step 2: what enters a pass

The repos are the ones the user reviews for (`config/sweep.json`, or whatever the lead names). For each, a single
call:

```
gh pr list -R <repo> --state open --json number,title,author,isDraft,headRefOid,updatedAt,reviewDecision,baseRefName,headRefName
```

Discard up front: drafts, and everything authored by the configured login (you do not review yourself).

**Also discard the release-train PRs**, unless the request names them. Those are the ones a promotion workflow opens
by itself (`Create staging PR`, `Create prod PR`) and they carry no code of their own: their diff is whatever already
got reviewed on the way into `develop`. Reviewing the merge of a branch into the next branch re-reads work that
already passed through review, and reports it a second time as if it were new.

A PR is release-train when **both** hold:

- the title matches `^\s*create\s+(staging|prod|production)\s+pr\s*$`, case-insensitive; **and**
- `headRefName` and `baseRefName` are both long-lived branches: `develop`, `staging`, `main`, `master`, `production`,
  `prod`.

Both conditions, not either: the title alone would swallow a PR a human wrote by hand from a feature branch and
actually wants looked at, and the branch pair alone would swallow a real `develop` to `main` hotfix promotion. The
author is deliberately NOT part of the test: the day that workflow starts running under a personal token the author
becomes a person and an author-based filter would go quiet without saying so.

**How to pass one explicitly:** name it in the request as `repo#N` or `owner/repo#N`. A PR named there is reviewed
like any other, in whatever box it lands in, and the discard above does not apply to it. A discarded release-train PR
is left in the state **untouched** (no new `head`, no new `checkedAt`), so an explicit pass later resumes
incrementally from whatever was last reviewed.

### The gate: a PR only enters if it is actually on the user's plate

Reviewing uninvited is not free: it costs a review's worth of tokens and spends the channel's credibility on work
that was not owed.

One search over the repos, once per pass:

```
gh search prs --review-requested=@me --state=open --limit 50 --json repository,number \
  --repo <owner/repo> --repo <owner/repo> ...
```

A PR passes the gate when **any** of these holds:

- **GitHub lists the configured login as a requested reviewer**: the search above, which also expands requests made
  to a team (the plain `reviewRequests` field returns the team without saying who is in it);
- **it is tracked with at least one `open` finding**: the author pushing on top of findings you left, or replying in
  their threads, is the answer to a review you already gave, and nobody re-asks for a re-review. That is idea 1, and
  the gate must not break it. A state entry with nothing open is *not* enough: it was reviewed, nothing is owed, and
  if it needed another look someone would ask;
- **a push dismissed a previous approval**: `approvedHead` is set and `headRefOid` is not `approvedHead`.
  `dismiss_stale` wipes the verdict without re-requesting the review, so demanding a request here would silence
  exactly the case where the user's own approval was undone and nobody is looking.

Everything else is left alone: not read, not tracked, not mentioned. It is not lost either: anyone who wants the
user's eyes on a PR asks for them on GitHub, and the user can always force one by naming it.

Of the rest, each PR falls into **one** of these boxes:

| Box | Condition | What happens |
| --- | --- | --- |
| **A · new** | not in the state | **full** review (step 3A) |
| **B · advanced** | in the state and `headRefOid` is not `head` | **incremental** review (step 3B) |
| **B′ · post-approve push** | `headRefOid` is not `approvedHead` and there was an approval | incremental, without resurrecting closed findings |
| **C · moved** | tracked (at least one `open` finding), same head, and **someone other than the user** acted since `checkedAt` | **verification only** of the open findings (step 3C) |
| **D · quiet** | everything else | nothing: no code read, nothing sent |

Three clarifications that are the reason this exists:

- **A tracked PR never stays in D forever.** It stays in the state with its open findings, and re-enters on its own as
  soon as the author touches anything. Nobody has to ask for a re-review.
- **Box C is the case of the dev who replies without pushing.** Thread activity with the same head: they answered,
  marked resolved, argued the finding. Worth looking at.

  **`updated_at` alone does NOT put a PR in box C.** Your own review landing moves `updated_at`, and so do the bots
  (project automation, a label, a status). So `updated_at > checkedAt` is only the cheap pre-filter; before a PR
  actually enters box C, confirm a human other than you did something:

```
gh api repos/<repo>/issues/<n>/timeline --paginate \
  -q '[.[] | select((.actor.login // .user.login // "") as $u | $u != "<configured login>" and ($u | endswith("[bot]") | not)) | (.created_at // .submitted_at)] | max'
```

  Greater than `checkedAt` → box C. Otherwise → box D, and record `checkedAt` so the same non-event does not
  re-trigger next pass. One call, and only for the candidates whose `updated_at` already moved.

  **Convert before comparing.** If `checkedAt` is stored in local time with no offset and the timeline and
  `updated_at` are UTC with a `Z`, comparing them as strings is wrong by the UTC offset, which biases the error toward
  *false* box C. Store `checkedAt` in UTC with a `Z` (Mesa does), or parse both.

  A reply that is *yours* is never news either: you wrote it. Only the author, a second reviewer, or a real commit
  counts.
- **Fast exit on approval:** if a PR already has an `APPROVED` review **of the configured login on the current head**,
  take it out of the pass: `outcome: "clean"`, `approvedHead` and `approvedAt` from what the review says, and any
  `open` findings to **`waived`** (the user approved with those open; nobody claimed they were fixed). It is already
  dispatched, and approving is final, so it does not come back. This covers the PRs the user approves by hand from
  GitHub without going through the button. Check it only for the PRs that were about to enter:

```
gh api repos/<repo>/pulls/<n>/reviews --paginate -q '[.[] | select(.user.login=="<configured login>")] | last | [.state, .commit_id] | @tsv'
```

If nothing enters: one line (`no changes: N open, M tracked`) and nothing is reported. A silent pass generates no
noise.

**Cap of 5 per pass**, and the order matters because the cap cuts:

1. box B tracked (the author fixed something and is waiting for a verdict),
2. box C,
3. box A,
4. box B with no prior findings.

Within each group, oldest `updated_at` first. Whatever did not make it stays **untouched in the state** (without
touching `head` or `checkedAt`) and the next pass picks it up. Say so (`+N queued`).

## Step 3: the review

Content rules, in all three modes: follow the `pr-review` skill (`<mesa-repo>/vendor/pr-review/SKILL.md`): real
issues only, terse, **in English**, no AI attribution, and read the PR conversation **before** forming a finding.

**Explicit override of the skill's flow:** here you **do NOT** publish anything to GitHub: no approve, no comments, no
pending review. The human gate is satisfied by showing the findings to the user, who decides with the buttons. This
holds even when there is nothing: do not auto-approve, report "no issues".

Verify every finding before writing it. A false blocker costs more than a missed finding.

### 3A: full review (box A)

The whole PR, as usual. It is the only mode that reads the entire diff.

### 3B: incremental review (box B)

First ask whether the incremental diff exists:

```
gh api repos/<repo>/compare/<state.head>...<new head> -q '.status, (.files|length), (.commits|length)'
```

- `ahead` → there is a clean range: **review only that**. The compare's `files[].patch` is the diff, and read around
  it as needed to understand it (imports, callers, types). Do not go back to the rest of the PR.
- `diverged` or `behind` → there was a rebase or force-push: the range means nothing. Fall back to **3A**, full
  review, and say so (`rebase: full review`).
- `identical` → should not happen in box B; if it does, treat it as box C.

Then, **always**, the part that keeps the incremental from missing anything: verify the open findings (3C). A new
commit can fix a finding, leave it alone, or move it.

A new finding can only come out of the incremental range, or out of something in the range that breaks code that did
not change. That last one is valid: the scope limits *what you read*, not *what a change can break*.

### 3C: verification of open findings

For each finding with `state: "open"`:

1. Re-anchor: search for the `anchor` text in the file (it may have moved lines, or the file may have been renamed).
   Update `at` with the new line.
2. Read the surrounding code and decide:
   - **`fixed`**: the problem is gone. Note in one line *how* you verified it (what the code does now), not just
     that it is.
   - **`open`**: it stands. Do not re-explain it: it was explained when it was raised.
   - **`changed`**: the code was rewritten and the problem mutated into another one. Close the old one as `fixed` and
     open a **new** one describing the new shape. It is the honest thing: the original finding no longer describes
     what happens.
   - the `anchor` disappeared (code deleted) → `fixed`, if the deletion really eliminates the problem and does not
     move it to another file.
3. `dismissed` ones **never** come back, not even if the review finds them again in the same place. One line
   mentioning them and move on.

**The author's thread verifies nothing.** "Fixed in `abc1234`" is a hint about where to look, not evidence. The
verdict comes from reading the code at the current head. This is the rule that saves the most money: a dev who
believes they fixed something and did not is exactly the case the review exists to catch.

### Buttons by state

- open blockers remain → **Post**, **Explain more**, **Dismiss**, **Approve anyway**
- open nits only → **Post**, **Dismiss**, **Approve**
- nothing open (no findings, or everything fixed in this pass) → **Approve** as the primary button, and **Re-review**
- always → **View PR**

## When a click arrives

A click is the user's decision, not a message to interpret.

### Every write goes through `pr-gh.mjs`

The actions that write (`send`, `approve`, `bypass`) do **not** call `gh` directly. They call one script, with a
fixed argv0:

```
node <mesa-repo>/vendor/pr-gh.mjs whoami
node <mesa-repo>/vendor/pr-gh.mjs approve <owner/repo> <pr> [sha]
node <mesa-repo>/vendor/pr-gh.mjs review  <owner/repo> <pr> <APPROVE|REQUEST_CHANGES|COMMENT> <payload.json>
node <mesa-repo>/vendor/pr-gh.mjs reply   <owner/repo> <pr> <in_reply_to_id> <body.txt>
```

Why: the inline form kept changing shape (`cd ~ &&` in front one time, a `GH_TOKEN=$(gh auth token -u <login>)` env
prefix another, `-f commit_id` a third) and permission rules match by **prefix**, so every variation broke the match
and the click died with a denial instead of a review. The script freezes the shape. It also keeps the two fragile
things inside it: the write runs under the token of the configured login (`MESA_GH_USER`; the active `gh` account is
often a different one that 404s on the organisation's repos), and it uses REST, because `gh pr review` goes through
GraphQL and fails for the same reason.

**Write the command bare**: no `cd`, no `&&`, no `; echo $?`. A prefix or a suffix breaks the match just as surely as
the old inline form did.

**The tool is part of the shape too.** Permission rules are per tool: a `Bash(node …pr-gh.mjs:*)` rule does not cover
the same command run through the **PowerShell** tool, and the reverse is also true. Allow both. If a write is denied,
first check which tool it went through and whether that tool has the rule. Do not reword the command.

`review` takes its payload from a JSON file (`{ "body": ..., "commit_id": ..., "comments": [ { "path", "line",
"body" } ] }`) so the finding text never goes through shell quoting. Each command prints one JSON line; `ok: true`
means the write landed, and `commentIds` carries the ids that go into `ghCommentId`.

What to do with each action:

**`send`**: publish the review on GitHub with the **open** findings as inline comments, exactly as the `pr-review`
skill would after the gate: a pending review, one comment per finding anchored at its `file:line`, and
`REQUEST_CHANGES` if there is any blocker or `COMMENT` if they are all nits. Review body empty or one line. A finding
whose file is not in the diff cannot be anchored: that one goes in the body.

Two things for the tracking, and without them the re-review degrades:

- save the `id` of each finding's comment in its `ghCommentId`, and mark the PR `posted: true`;
- a finding that already has a `ghCommentId` **is not published again**: if it is still open after new commits, it
  goes as a reply **in its thread** (`node <mesa-repo>/vendor/pr-gh.mjs reply <owner/repo> <n> <ghCommentId>
  <body.txt>`), not as a new comment. A repeated finding posted as if it were new reads like a reviewer with no
  memory.

**`approve`**: `node <mesa-repo>/vendor/pr-gh.mjs approve <owner/repo> <pr> <headRefOid>`. The click **is** the user's
approval: the `pr-review` skill's rule about not publishing without their OK is already satisfied, do not ask again.
Empty body, as the skill requires. In the state: `outcome: "clean"`, `head` at the approved SHA, and the PR leaves
the tracking.

**Approving is final for that PR.** It leaves the tracking and does not come back: it does not appear in pending, and
no later pass mentions a finding of it again (open nits, forgiven blockers, whatever). If the user approved, the
conversation about those findings is over; a pass reopening it is exactly the noise the button came to cut. Record
`approvedHead` with the approved SHA and `approvedAt`.

**The only case where an approved PR shows up again** is a push *after* the approval, and it is not a tracking
relapse: it is new code. GitHub itself knocks down the approval when that happens (when the repo's ruleset has
`dismiss_stale`), so the PR is left without a verdict and one is needed. It then enters through box B, **incremental
from `approvedHead`**, with two conditions:

- `waived`, `fixed` and `dismissed` findings **do not resurrect**: not in pending, not in the fixed list, and not as a
  new finding if the review finds them again;
- the header says it in one line: `post-approve push: your approval was dismissed`.

So untracking is about the findings, not about the PR. The findings are closed forever; new code is still new code.

**What happens to findings that were open at approval time.** They do not go to `fixed`: nobody fixed them. They go to
**`waived`** ("they were seen and it was approved anyway") with the SHA at which they were waived. The distinction is
not bureaucracy: `fixed` is the only label that claims something about the code, and if an approve hands it out for
free the state lies and the next re-review believes a live problem was already solved. And in the confirmation **list
what was waived**, even if they are nits: it is the only record that they existed, because if they were not
published, nothing is left in GitHub.

**Approving publishes nothing, not even the nits.** GitHub allows `event: APPROVE` with inline comments, and it was
rejected on purpose: a published nit invites the dev to push a fix, that push dismisses the approval via
`dismiss_stale`, and the PR asks for another click over a nit. If a nit is worth the dev seeing, the button is
**Post**; if not, **Approve** and it stays `waived`.

`waived`, `fixed` and `dismissed` all three stop being reported. They differ in what they claim: `fixed` = the code
changed, `dismissed` = the finding was not valid, `waived` = it was valid, still alive, and approved anyway.

**`bypass`** (Approve anyway): same as `approve`, but with blockers present. Approve with an empty body and **say it
clearly**: which blockers were overridden and on which PR. The findings become `waived`, same as in `approve`: they
were not fixed, a decision was made to move on. It is the only action that leaves a deliberate trail of "we knew and
went ahead anyway", and that trail has to exist somewhere.

**`explain`**: `extra` carries the finding's number. Go back to the code, read around it with more context than you
used in the pass, and write a longer explanation of THAT finding, **in English**, like every other finding text: why
it is a problem, what breaks concretely, and the fix (in a fenced code block). It is meant to be read straight
through: let it be long. If a one-line summary had been enough, the button would not have been pressed. If the finding
was already dismissed or fixed, explain it anyway (asking for detail on something closed is legitimate) but say so at
the end.

**`dismiss`**: the user looked at the findings and decided they do not stand. Three things, and the second is what
makes the button worth anything:

1. **Do not publish anything to GitHub.** No review, no comments, no approve.
2. **Mark those findings `state: "dismissed"`** in the state, keeping their `at` and `anchor`. If a later re-review
   finds *the same* finding in the same place again, **do not report it**: one line saying it is dismissed and move
   on. Without this the button does nothing: the next pass with new commits brings you the same findings you already
   rejected.
3. Confirm what was dismissed, and if there were blockers among them say so, so the trail exists that they were seen
   and let through.

A dismissed finding stops counting as a blocker when deciding the buttons. If they were all of them, the PR has no
`open` left: it leaves the tracking and the next message for that PR carries a normal **Approve**, not bypass.

Careful: dismissing is per finding-in-place, not per PR. If the author fixes the code and a **different** problem
appears, that one does get reported.

**`rereview`**: run the PR now without waiting. Incremental (3B) by default from the state's `head`, which is almost
always what is wanted: "I already pushed the fix, take a look". If `extra` carries `full`, or if the state has no
`head`, run the full one (3A). Ignore `checkedAt`, never the `dismissed` ones.

**If the state's `head` IS the current head, run the full review (3A), not the incremental.** The incremental range
would be empty and the answer would be "nothing changed", which is not what the button was pressed for. With no new
commits behind it, the only thing **Re-review** can mean is "I do not trust that verdict, look at it again". Answering
an explicit request for a fresh look with a no-op is the failure this button exists to prevent.

After any action, update the state.

## Rules

1. **Never** post to GitHub from a review pass. It is read-only over the repos; the only thing that writes is a click
   from the user (`send`, `approve`, `bypass`).
2. Every finding is in English.
3. If `gh` fails (rate limit, expired token), report it, do not touch the state, and end the pass. The next one
   retries.
4. A finding is closed by **reading the code**, not by reading what the author said.
