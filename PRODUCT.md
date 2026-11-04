# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (user's choice, 2026-11-03). Runs locally on Andrés's PC; reachable from his phone.

## Users

One user: Andrés, a software engineer at Designli. Most of his job is approving pull requests, answering client requests that arrive through Basecamp, and keeping up with Slack. He works alongside Claude (Claude Code sessions started in `G:/WorkSpace/designli`), which acts as his assistant: it triages, drafts and asks him things.

Usage splits about evenly between the desktop (a tab open next to Slack and GitHub during the workday) and the phone (approving outgoing messages and answering tickets away from the PC).

## Product Purpose

A single place for everything that is waiting on Andrés at work, so he stops checking GitHub, Basecamp and Slack separately. Success: he opens one page, sees what needs him today, decides quickly, and Claude does the legwork.

## Positioning

It is not a team tool and not a generic kanban. It is a two-person desk: Andrés and his assistant. Every item points back to its real source (a PR, a Basecamp recording, a Slack thread), and nothing leaves on his behalf without his explicit approval of the exact text and destination.

## Operating Context

- **Sources:** GitHub PRs where he is a requested reviewer (account `acorrea-designli`); Basecamp to-dos, mentions and client messages without his reply; Slack messages waiting for his reply (the existing `slack-triage` flow).
- **Kanban:** tasks are mirrored to a private GitHub Project owned by `acorrea-designli`. Statuses: Inbox → Todo → In Progress → Waiting → Done. Each task links to its source.
- **Tickets:** two directions in one stream: Claude asks Andrés (questions, decisions), and Andrés asks Claude (requests). Threaded replies. An answer must wake the Claude session that asked.
- **Approvals:** every outgoing Slack or Basecamp message Claude drafts becomes an approval showing the exact destination (Slack channel + thread, or Basecamp project + recording/Campfire) and the exact text. Actions: approve, edit, deny. Nothing is sent without approval.
- **Existing PR flow:** `pr-monitor` / `pr-review` already review PRs and post findings to Slack with buttons. The board shows and links into that flow; it does not replace it.

## Capabilities and Constraints

- Local server on this machine; phone access through a tunnel with a token. Port must avoid 8770 (medix board) and 8771 (nexo board).
- Slack and Basecamp are reached through Claude's MCP connectors, so sending happens in a Claude session; the board holds the approval and the session executes it.
- UI copy in Spanish. Code, identifiers and anything posted to GitHub in English.
- Open: exact ingestion cadence; whether Basecamp items are pulled per project or account-wide.

## Brand Commitments

No existing brand. Must have its own identity: explicitly not the generic look of the nexo/medix boards.

## Evidence on Hand

None yet: no real data captured. Do not fabricate PRs, clients or messages beyond clearly labeled samples.

## Product Principles

1. **Scan, then decide.** Each item reads in a glance: what it is, where it came from, what it needs. Detail is one tap away, never in the way.
2. **One stream, not columns by direction.** Who asked whom is a property of an item, not a separate board.
3. **Nothing goes out unseen.** Outgoing messages show exact text and exact destination before approval.
4. **Source is always one click away.** Every item links to the PR, recording or thread it came from.
5. **No team machinery.** No agents, slots, verdicts or rosters: this is one person and his assistant.

## Anti-goals

- A team or agent-status panel.
- Long threads per ticket as the default view.
- Separate column sets for "Claude asks" and "Andrés asks".
- A generic, templated look.
