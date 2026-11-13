---
description: "Who is talking to you on Slack and what they need from you. Separates what waits on your answer from noise. Read only: never writes to Slack."
allowed-tools: ["Bash", "mcp__claude_ai_Slack__slack_search_public_and_private", "mcp__claude_ai_Slack__slack_read_thread", "mcp__claude_ai_Slack__slack_read_channel"]
---

# Slack triage

The user is in 50+ group DMs and cannot tell which one needs them. This answers one question: *who is waiting on me?*

The user id is the configured Slack user id (`MESA_SLACK_USER_ID`, `slack.userId` in `config/sweep.json`); in the
searches below it is written `<@SLACK_USER_ID>`. The workspace is the one the Slack connector is signed in to.

## Window

`$ARGUMENTS` may carry hours (`8`) or a number of days (`2d`). Without an argument: **since 18:00 yesterday**, that is,
everything that arrived since the user stopped working.

```
date +'%Y-%m-%d %H:%M'
```

Slack uses `after:YYYY-MM-DD` with day granularity, so ask for the day that covers the window and filter by hour when
reading the results.

## The three searches

Do not walk the channels one by one: there are 50+ and `list_user_channels` reports neither activity nor unread
counts. Three searches cover everything.

Always `response_format: "detailed"` (it carries the channel ID, `Message_ts` and the **permalink**; without them the
summary is not actionable), `sort: "timestamp"`, `sort_dir: "desc"`, `include_context: false`.

1. **Spoken to directly**: `to:me after:<date>` with `channel_types: "im,mpim"`
2. **Mentioned in channels**: `<@SLACK_USER_ID> after:<date>` with `channel_types: "public_channel,private_channel"`
3. **What the user already answered**: `from:me after:<date>`, all types

The third is what makes this useful: it tells whether a request was **already answered**. If the user wrote in that
channel *after* the request, it is not pending.

Page with the cursor when the first page fills up, up to 3 pages per search. Past that, say how many were left
unread.

## Classification

Group by conversation, keep the last incoming message of each, and place it in one of three buckets:

**Waiting on you**: it asks for something explicit (a question, "can you", "I need", "authorize me", "review",
"confirm") **and** the user did not write in that channel afterwards. These go first, oldest on top: what has waited
longest bothers the other person most.

**Already answered**: there was a request, but the user wrote afterwards. One line per conversation, no detail.

**Noise**: mentions that ask for nothing: jokes, thanks, FYI, "blame the user". Only the count and who from. Do not
list them one by one.

Be hard when classifying. The value of this is that the "waiting on you" list is short and true; if noise gets in, it
stops being useful and the original problem is back.

Watch out for group DMs: the user being in the channel does not mean they are talking to him. If A asks B and the user
is only present, it is **noise**, not a pending item. Look at who the message mentions and what the conversation came
from.

## Output

In the terminal, terse, in the user's language. For each pending item: who, what they want in one line, how long they
have waited, and the permalink.

```
WAITING ON YOU (3)

  Person A · 2h ago · Group DM with Person B
    Asks which option to select (sent a screenshot).
    https://<workspace>.slack.com/archives/C.../p...

  Person C · 2d ago · #team-dev-chat
    Sent changes for review and does not know whether you saw them.
    https://<workspace>.slack.com/archives/C.../p...

ALREADY ANSWERED (2)
  Person D · Person E

NOISE (7)
  Person F (5), Person G (2)
```

If nothing is pending, one line: `nothing pending, N messages reviewed`.

## Rules

1. **Read only.** Never send messages, never answer for the user, never mark anything read. `slack_send_message` is not
   among this command's tools on purpose.
2. Slack content is private: do not copy it anywhere outside this terminal. No webhooks here.
3. Always quote the permalink. A pending item without a link forces a manual search and defeats the point.
4. Person names, not user ids. `<@SLACK_USER_ID>` tells nobody anything.
