---
name: mesa-ticket
description: The Mesa ticket protocol for the lead and every teammate - how to ask Andrés (A/B options plus a recommendation), how to reply, the "Claude va a hacer" plan with the / action catalogue and its directo vs "te pide OK" gates, @ ticket refs, files, brief and handoff discipline, and what goes to engram. Use whenever you open, answer, plan, reference or close a Mesa ticket, or when Andrés writes a new request ("pídele a Claude", "nuevo ticket", "ticket").
---

# Mesa tickets

A ticket is one unit of work between Andrés and Claude, in one stream: `claude_asks` (we ask him) or `andres_asks`
(he asks us). Every ticket has an owner agent; the lead routes, the owner works. State lives in Mesa; durable memory
in engram. `MESA` = `node G:/WorkSpace/designli/ops/bin/mesa` (Bash tool, bare; bodies through `--body -` and a
heredoc so text never passes through shell quoting).

## Asking (the only way to ask Andrés anything)

- One question per reply. First line = the question, naming the options (`¿A o B?`); then one line per option; then
  the recommendation with its reason in one line. Spanish, at most 3 lines of body besides the options.
- Always options when the answer is a choice: `--option "A:<label>[:<detail>]" --option "B:<label>"`, and
  `--recommend <key> --why "<one line>"`. The recommended option is the one you would pick if he said "tú decide".
- Quote the client's own words when the question is about what the client wants.
- Never ask what the code, the thread or engram already answers. Never ask in chat or by message: the lead's chat
  is not where his decisions live.
- A message that asks nothing starts with `FYI:` so he can skip it.

```
node G:/WorkSpace/designli/ops/bin/mesa ticket reply t14 --body - --option "A:Bucket nuevo" --option "B:Reusar dre-staging-docs" --recommend A --why "aísla datos de prueba y el costo es mínimo" <<'EOF'
¿Bucket nuevo (A) o reusar el de staging (B) para los uploads de Matt?
Matt: "we just need somewhere private to drop test files".
EOF
```

His answer arrives as `ticket.answered`; the lead relays `ANSWER <ref> <message id>` to the owner, who reads it with
`MESA ticket context <ref>`. Picking an option fills his reply with that option.

## Replying to his request

Answer first, then evidence (one line each, linked), then what you could not check. At most 6 lines. Long output
(logs, diffs, tables) goes in a file attached to the ticket or in the PR, never pasted in the reply.

## The plan: "Claude va a hacer"

Before work that does anything beyond reading, the owner posts the plan, one action per step:
`MESA ticket plan <ref> --action "<kind>:<source>:<direct|needs_ok>:<label in Spanish>"`.

| kind (the `/` catalogue) | source | gate | examples |
|---|---|---|---|
| `investigate` | any | direct | read threads, logs, code |
| `review_pr` | github | direct (verdict needs OK) | review owner/repo#n |
| `branch_pr` | github | direct | worktree, commits, a draft PR |
| `create_task` | claude | direct | a task on the Mesa board |
| `move_card` | github / basecamp | needs_ok | move a GitHub Project or Basecamp card |
| `send_message` | slack / basecamp | needs_ok | always a salida (`mesa-salida`) |
| `cancel_message` | slack / basecamp | needs_ok | undo or delete a sent salida |
| `apply_infra` | github | needs_ok | terraform apply, any change to a live environment |
| `merge_pr` | github | needs_ok | merge or mark ready |
| `post_github` | github | needs_ok | approve, review comments, replies (`mesa-review`) |

Rule of thumb: reading and preparing are `direct`; anything another person can see, or that changes a live system,
is `needs_ok`. Anything that writes to a client goes through Salidas. Mark progress with
`MESA ticket action <actionId> --state running|done|failed`. A `needs_ok` action waits for
`ticket.plan_approved`.

## @ refs and files

- Reference another ticket with `--ref <ref>` on ask, or `@t12` in the body; reference a PR, recording or thread
  by URL. The lead resolves `@` refs to the live owner of that ticket when work spans both.
- Files Andrés attaches arrive in `ticket context` as attachments with a local path; read them by path. Files you
  produce (PDFs, plans) live in your scratch folder and are named in the reply by absolute path.

## Brief and handoff discipline

- **Brief** (owner writes it, `MESA ticket brief <ref> --body -`, replaced in full each time): the ask in one line,
  the requester's words quoted, acceptance criteria numbered, repo/base/destination, risks, links. Every teammate
  boots from it, so it must stand alone.
- **Handoff** (every agent, before every stop, preamble rule 6): status, what is done, what is left, where (file:line,
  PR, salida ids, URLs), open questions, the next step. Write it as if the reader has never seen the ticket.

## Engram

Every ticket's durable record is one observation with topic_key `mesa/<ref>` (the owner upserts it: request,
decisions with Andrés's words, outcome, links). Client preferences go to `client/<slug>`; reusable lessons to
`lesson/<slug>`. Mesa may also record the thread itself (`mesa engram link`); never `mem_save` a duplicate of what
the ticket already holds. English, no secrets.

## Closing

Only Andrés closes a ticket he asked (`Marcar hecho`). The owner closes its own `claude_asks` tickets with
`MESA ticket close <ref>` once acted on, after the final handoff and the `mesa/<ref>` upsert.
