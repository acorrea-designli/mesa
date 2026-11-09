---
name: mesa-write
description: The Mesa writer's craft - client and team messages (humanizer, the client's tone from engram, the thread's language) and client documents rendered to PDF from a print-safe HTML template (cover, summary, sections, next steps, appendix) with Playwright's Chromium. Use when a ticket needs a reply drafted, "redáctale", "escríbele a", a proposal, report, estimate, summary or any document for a client, or a PDF deliverable. Hands off to the docx, pdf, pptx or docs skills when Andrés asks for those formats.
---

# Mesa writer

Words only: you never send. A message becomes a salida (`mesa-salida`); a document becomes a file the salida links
or attaches. `MESA` = `node G:/WorkSpace/designli/ops/bin/mesa`. Scratch folder: `<scratchpad>/writer-<ref>/`.

## Messages

0. **Read every attachment before you draft** (preamble rule 18). Read the source message in detailed mode
   (`slack_read_thread` or `slack_read_channel` with `response_format: "detailed"`: search output omits files) plus
   the 3-5 messages before it, and open every file it lists: Slack `slack_read_file <id>`; Basecamp
   `download_file <url>`, the `href` of the `<bc-attachment>` (`get_by_url` shows them in a comment) or the
   `download_url` from `get_upload(upload_id)` or a record's attachments. Text comes back as text and images as an
   image; a PDF or other type comes back as a description with a `web_url`, a file over 10 MB as a description only.
   A short message that says "aquí", "esto", "esta" points at an attachment or a link. A file you cannot read:
   `BLOCKED <ticket> cannot read <name> (<why>) <web_url>` to the owner (the `web_url` lets Andrés open it), never
   a guess. What the files show belongs in the facts list below.
1. **Facts first.** List what the message must say from the ticket context (decisions, numbers, dates, links, what
   is asked of the reader). Nothing outside that list goes in. Missing a fact: ask the owner, do not invent it.
2. **Read the thread** you answer. Reply to what was asked, in the thread's language (clients: English unless they
   wrote in Spanish), at its register.
3. **Tone from engram**: `mem_search client/<slug>` (names, formality, length, things Andrés changed before). No
   record yet: short, direct, warm, first name.
4. **Shape.** Answer or outcome in the first sentence. Then only what the reader needs to act: what changed, what
   they need to do, by when. One ask per message. Links inline. No headers in chat messages; bullets only for
   three or more parallel items.
5. **Humanize**: run the `humanizer` skill in embedded mode on the draft; it rewrites wording only.
6. **Mentions (Basecamp).** When a comment addresses someone, look the person up with `list_project_people` (that
   project) and put `{ id, name }` in the destination's `mentions` (`mesa-salida` § Propose). Never rely on a typed
   "@Name" to notify: it pings nobody. A Campfire line cannot mention (plain text) and a message-board post has no
   mentions param, so for those say in the salida `--context` that nobody gets pinged, and address the person by
   first name in the text. Several people with the same name: ask the owner, never guess an id.
7. **No attribution.** No Claude or AI attribution in any Slack or Basecamp text: no "sent by Claude", no "written
   with Claude", no robot sign-off, unless Andrés asks for that exact line on purpose. Why: Slack text goes out as a
   draft Andrés sends himself (no footer) unless he picks "Aprobar y que Claude lo envíe", where the connector stamps
   "Sent using @Claude" (`mesa-salida` § Send); a second tag from the text itself is what Andrés does not want out.
8. **Propose** it (`mesa-salida` § Propose). Each change request is a new version (`mesa-salida` § Refine).
9. After it is sent or denied, upsert `client/<slug>` with what you learned (preferred length, phrasings he kept,
   phrasings he removed). English, no private content verbatim.

## Documents (PDF)

The fixed structure every client document follows, in this order:

| Part | Content |
|---|---|
| Cover header | kicker (document type), title (what it is about, not "Report"), "Prepared for <Client>", date, version, status |
| Summary | 2-4 sentences a busy reader can stop after; 2-4 fact cards (the one they act on highlighted); the decision needed, if any |
| Sections | numbered, in the order the reader needs them: context, proposal, impact (cost, time, risk), risks |
| Next steps | table: step, owner (the client or Designli), date |
| Appendix | detail the summary does not need: full tables, configuration, references, glossary |
| Footer | the caveat that applies (estimates, assumptions) and "Designli · <date>" |

Good practice for client deliverables: one idea per section; numbers with units, ranges and their assumption;
dates absolute ("Nov 6"), never "next week"; their names for their things; no internal jargon, ticket ids, agent
names or tool names; no AI attribution; every claim traceable to the ticket. Sample or assumed data is labelled.

Procedure:

1. Copy `assets/template.html` (in this skill's folder) to `<scratchpad>/writer-<ref>/<slug>.html`; fill every
   `{{PLACEHOLDER}}`; repeat the marked SECTION and STEP blocks; delete the blocks you do not use. `assets/example.html`
   shows a filled one. Keep the CSS: tables instead of grid/flex, `print-color-adjust: exact`, headings that never
   end a page, tables and callouts that never split, a footer without flex.
2. Render (Bash, bare):
   `node G:/WorkSpace/designli/ops/.claude/skills/mesa-write/assets/render.mjs <scratchpad>/writer-<ref>/<slug>.html <scratchpad>/writer-<ref>/<slug>.pdf --footer "<Client> · <Title>"`
   It refuses a file with an unfilled placeholder and prints `{ok, pdf, bytes, pages}`. Letter by default;
   `--format A4` for non-US clients.
3. **Check every page** with the Read tool on the PDF: no orphan heading at a page bottom, no table split, no page
   holding only the footer (tighten or cut, then re-render), page numbers present.
4. Attach the PDF to the ticket reply by its absolute path and propose the message that carries it as its own
   salida. Uploading the file to Basecamp is part of the lead's send, after approval.

Other formats: when Andrés asks for Word, PowerPoint, an editable doc or PDF manipulation, use the `docx`, `pptx`,
`docs` or `pdf` skill with the same structure and practices.
