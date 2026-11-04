---
name: Mesa
description: Andrés's two-person desk with Claude, drawn as a transit network where sources are lines and statuses are stations.
colors:
  ground: "#eceae5"
  deep: "#e2dfd8"
  porcelain: "#fbfaf7"
  rule: "#d3cfc5"
  rule-soft: "#dcd8cf"
  edge: "#c3beb2"
  ink: "#1c1d21"
  ink-soft: "#3e4047"
  need-ink: "#2c2e33"
  mute: "#5d5f68"
  dim: "#6f717a"
  line-github: "#e60012"
  line-slack: "#00a3a8"
  line-claude: "#f39700"
  line-basecamp: "#00b07c"
  text-github: "#b8000e"
  text-slack: "#00777b"
  text-claude: "#8a5300"
  text-basecamp: "#006b4d"
  tint-github: "#fbe6e5"
  tint-slack: "#e6f6f5"
  tint-claude: "#fdf0dc"
  tint-basecamp: "#e2f5ed"
  grafito-ground: "#17191d"
  grafito-deep: "#111316"
  grafito-raise: "#20232a"
  grafito-rule: "#2b2f37"
  grafito-rule-soft: "#23262d"
  grafito-edge: "#3d424b"
  grafito-ink: "#f1efe9"
  grafito-ink-soft: "#c7cbd2"
  grafito-need-ink: "#dadde2"
  grafito-mute: "#9a9fa8"
  grafito-dim: "#8e939c"
  grafito-line-github: "#ff5d52"
  grafito-line-slack: "#2ec5c2"
  grafito-line-claude: "#ffb428"
  grafito-line-basecamp: "#3cc983"
  grafito-text-github: "#ff8f86"
  grafito-text-slack: "#74dcd9"
  grafito-text-claude: "#ffc965"
  grafito-text-basecamp: "#7fdca4"
  grafito-tint-github: "#3a1f1e"
  grafito-tint-slack: "#123130"
  grafito-tint-claude: "#3a2d14"
  grafito-tint-basecamp: "#15301f"
typography:
  headline:
    fontFamily: "Hanken Grotesk, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "Hanken Grotesk, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.3
  station:
    fontFamily: "Hanken Grotesk, sans-serif"
    fontSize: "15px"
    fontWeight: 700
  subject:
    fontFamily: "Hanken Grotesk, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
  exact-text:
    fontFamily: "Hanken Grotesk, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: "Hanken Grotesk, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.3
    fontFeature: "\"tnum\" 1"
  meta:
    fontFamily: "Hanken Grotesk, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    fontFeature: "\"tnum\" 1"
  excerpt:
    fontFamily: "Hanken Grotesk, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
  label:
    fontFamily: "Hanken Grotesk, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.1em"
rounded:
  line: "2px"
  tag: "4px"
  control: "6px"
  panel: "8px"
  pill: "15px"
  round: "50%"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  gutter: "28px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.ink-soft}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.porcelain}"
  button-phone-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.control}"
    height: "58px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "30px"
  tab-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
  status-tag:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "0 9px"
    height: "24px"
  status-tag-waiting-on-you:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
  destination-chip-slack:
    backgroundColor: "{colors.tint-slack}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "4px 9px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "38px"
  nav-item-active:
    backgroundColor: "{colors.porcelain}"
    textColor: "{colors.ink}"
  exact-text-block:
    backgroundColor: "{colors.porcelain}"
    textColor: "{colors.ink}"
    typography: "{typography.exact-text}"
    rounded: "{rounded.control}"
    padding: "16px 16px 14px"
  board-card:
    backgroundColor: "{colors.porcelain}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px 11px"
  ticket-option:
    backgroundColor: "{colors.porcelain}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "14px"
---

# Design System: Mesa

## Overview

**Creative North Star: "Mapa de metro"**

The working day is a transit network. Each source is a coloured line (GitHub, Slack, Claude, Basecamp), each status is a station (Inbox, Todo, En curso, Esperando, Hecho), and each item is a tick riding its line. The signature is the line band across the top of the work area: picking a station or a source filter re-routes it, so the chosen line burns at full ink and the rest drop to about 35%. Everything below the band is a dense, calm operating surface: rows that read in one glance, a detail pane, and an approval that shows exact destination and exact text before anything is signed.

The material is signage, not software chrome. Grounds are warm paper greys in the light "Tokio" theme (the default) and graphite in the dark "Grafito" theme. Station capsules have a ground fill and an ink outline, interchanges are open rings, and lines bend only at 45 and 90 degrees. One humanist sans, Hanken Grotesk, carries everything at fixed sizes with tabular numerals, like a station board.

Colour is reserved for wayfinding. The four line inks identify a source and nothing else; state is carried by ink weight, fill, dashes and dotted lines, never by a semantic red or green.

**Key Characteristics:**
- Two themes from one token set: Tokio light on `:root`, Grafito dark on `[data-theme="dark"]`.
- Four line inks that mean source only; Slack is teal in both themes.
- Station capsules, open interchange rings, 45/90 degree bends, 6px round-capped strokes.
- One family, fixed sizes, tabular numerals for every count and time.
- Flat surfaces separated by hairline rules and tonal grounds; shadow only for floating layers.

## Colors

A warm, near-neutral transit-map paper with four saturated line inks used strictly as source identity.

### Primary
- **Station Ink** (Tokio `ink`, Grafito `grafito-ink`): text, capsule outlines, ring strokes, the primary button, the active tab and the "Te espera" tag. It is the only colour that means "this needs you".

### Secondary (the four lines)
- **Metro Red / GitHub** (`line-github`, Grafito `grafito-line-github`): PR lines, ticks, source dots, chips.
- **Canal Teal / Slack** (`line-slack`, Grafito `grafito-line-slack`): Slack lines and approvals into Slack. Teal in both themes.
- **Signal Orange / Claude** (`line-claude`, Grafito `grafito-line-claude`): Claude's questions, the "Claude escuchando" indicator, the recommended ticket option outline.
- **Platform Green / Basecamp** (`line-basecamp`, Grafito `grafito-line-basecamp`): Basecamp lines, and the "Limpio" / connected outline.
- **Line text variants** (`text-*`): darker (Tokio) or lighter (Grafito) versions of each line ink for when a source colour has to be read as text, such as the "Limpio" tag label.
- **Line tints** (`tint-*`): fills behind destination and link chips, the source colour at very low strength.

### Neutral
- **Tokio Ground** (`ground`): the work area. **Deep** (`deep`): rail, detail pane, phone dock. **Porcelain** (`porcelain`): raised rows, cards, the exact-text block, the active nav item. Grafito maps these to `grafito-ground`, `grafito-deep`, `grafito-raise`.
- **Rule** (`rule`) for structural hairlines, **Rule Soft** (`rule-soft`) between rows, **Edge** (`edge`) for control and tag outlines.
- **Ink Soft** (`ink-soft`) for nav and tab labels and context quotes; **Need Ink** (`need-ink`) for the "Necesita" column.
- **Mute** (`mute`): the text token for all secondary copy (excerpts, times, counts, labels, meta).
- **Dim** (`dim`): non-text only. It is 3.7:1 on `deep` and 4.0:1 on `ground`, below AA for text.

### Named Rules
**The Lines Carry Source Rule.** A line ink identifies GitHub, Slack, Claude or Basecamp and nothing else. It is never an error, warning, success or diff colour; red is GitHub.

**The Mute Is Text Rule.** Secondary copy uses `mute`. `dim` stays in the palette for non-text marks only, and station counts use `mute` rather than opacity.

**The One Solid Tag Rule.** "Te espera" (and "Por enviar") is the only solid-ink status tag. Every other status is an outline.

## Typography

**Display Font:** Hanken Grotesk (with sans-serif)
**Body Font:** Hanken Grotesk (with sans-serif)

**Character:** A humanist transit sans used like signage: few sizes, firm weights, and tabular numerals so times and counts line up like a departures board.

### Hierarchy
- **Headline** (700, 22px, 1.3): the selected item's title in the detail pane, the ticket question.
- **Title** (700, 20px, 1.3): view titles ("Línea del día", "Tickets") with a 13px `mute` date beside them.
- **Station** (700, 15px): station names on the band; the selected station at full ink.
- **Subject** (600, 15px, 1.3): the row subject, one line, ellipsised; 14.5px in ticket rows, 14px on board cards (2 lines max).
- **Exact text** (500, 16px, 1.5): the outgoing message exactly as it will be sent.
- **Body** (500, 14px, 1.3): base UI text, tabular numerals on.
- **Meta** (600, 13px): times, source names, counts, chips, tabs.
- **Excerpt** (400, 12.5px): the source excerpt under a subject, in `mute`.
- **Label** (700, 11px, 0.1em, uppercase): column headers, group headers and field labels in the detail pane ("Destino exacto", "Contexto"), in `mute`.

### Named Rules
**The Fixed Board Rule.** Sizes are fixed px, never fluid. Every time, count and ID uses tabular numerals.

## Layout

Desktop is a three-column grid at a 1440px frame: a 184px rail, the work area, and a 392px detail pane (520px for the ticket thread). The line band spans the work area and detail pane at the top (280px on Hoy). Below it, source filter tabs, then the rows of the selected station on a fixed column grid (hora, origen, asunto, necesita, estado) with 12px column gaps and a 28px gutter. Rows are 58px on Hoy, 54px for tickets, 66px on the phone. The board view is five equal station columns with 12px gaps; each column caps visible cards and ends with "+N más".

The phone (390 x 844) collapses the band to the selected station's corridor: lines run solid into the station, dimmed after, with the next station named at the edge. A bottom tab bar replaces the rail, and actions dock at the bottom with the primary at 56px or taller.

Spacing rhythm is 6 / 8 / 12 / 16 / 24 / 28px; detail pane padding is 20px 24px.

## Elevation & Depth

Flat by default. Depth comes from tonal grounds (`deep` behind `ground` behind `porcelain`) and 1px hairline rules. Shadows are soft, ambient and tinted with `--shade` (ink at 10% in Tokio, black at 40% in Grafito); they appear only on layers that float above the page or on hover.

### Shadow Vocabulary
- **Float low** (`box-shadow: 0 2px 8px var(--shade)`): inline alerts and the hover state of board cards.
- **Float mid** (`box-shadow: 0 4px 18px var(--shade)`): a centred single-approval card.
- **Toast** (`box-shadow: 0 6px 20px var(--shade)`): undo toasts on the phone.

### Named Rules
**The Flat Board Rule.** Rows, panes and cards rest flat on tonal grounds. A shadow means "this floats" or "you are pointing at it".

## Shapes

Gentle, signage-like corners: 4px on tags and chips, 6px on buttons, tabs, nav items, cards and the exact-text block, 8px on larger option buttons and panels, 15px pills for live indicators, full circles for source dots and rings. In the line language, strokes are 6px with round caps and joins, bends happen only at 45 and 90 degrees, station capsules are fully rounded (radius = half width) with a 2.5px ink outline (3.5px when selected), ticks are 5px circles with a 1.6px ink stroke, and interchanges are open rings with a 3px stroke. A line that is out of service turns dotted (`stroke-dasharray: 1 11`) and its icon is cut by a 45 degree slash.

## Components

### Buttons
- **Shape:** gently rounded (6px), 40px tall, 0 16px padding, 600 14px.
- **Primary:** solid `ink` with `ground` text ("Aprobar y enviar", "Responder").
- **Hover / Focus:** primary shifts to `ink-soft`; secondary fills with `porcelain`. Focus is a 2px `ink` outline at 2px offset.
- **Secondary:** transparent with an `edge` outline ("Editar", "Denegar"). Small variant is 32px. Disabled drops to 45% opacity.
- **Phone:** docked full-width; primary 58px at 17px, others 52px.

### Chips
- **Destination / link chips:** 4px corners, 1px border in the source line ink, the source tint behind, 600 13px (link chips 22px tall at 12px). A neutral variant uses `edge` on `porcelain`.
- **Status tags:** 24px outline tags at 4px, 700 12px. "Te espera" is solid ink; "Limpio" outlines in Basecamp green with its text variant; Claude-owned waits outline in orange; offline states use a dashed outline in `mute`.

### Cards / Containers
- **Board card:** `porcelain`, 1px `rule` border, 6px corners, 10px 12px padding; a source line stub (or interchange ring when linked to two sources), project and time in `mute`, a two-line title, a one-line excerpt, link chips and a wait tag. Hover raises the border to `edge` with Float low. Done cards drop to transparent and one line.
- **Ticket option:** `porcelain`, `edge` border, 8px corners, 68px minimum, a 28px ink-ringed letter; the recommended option is outlined in Claude orange.

### Inputs / Fields
- **Style:** inherit the family and `ink` caret; reply boxes sit on `porcelain` with a `rule` border.
- **Focus:** 2px `ink` outline, 2px offset.

### Navigation
- **Rail:** `deep` ground, brand mark (a miniature of the line band), 38px items at 600 with tabular counts in `mute`. The active item is `porcelain` with `ink` text and count. "Hecho hoy" sits at the foot.
- **Source tabs:** 30px outline tabs with an 8px source dot; the active tab is solid ink.
- **Phone tabs:** 82px bottom bar, each tab a short line stub at 30% that goes full ink when active.

### Line Band (signature)
Four source lines run left to right through five station capsules, with items as source-coloured ticks. The selected station is drawn solid on `porcelain` with a 3.5px outline; everything past it drops to about 35%. A source filter burns its line and dims the others. Items linked to two sources are interchange rings joined by a 45 degree connector. When an item changes status its tick travels along its line (`cubic-bezier(.16,1,.3,1)`); under reduced motion it jumps.

### Exact-Text Block
The outgoing message on `porcelain` with a 1px `rule` border and 6px corners at 16px / 1.5. The source line runs into the block from the top: a 30 x 7px stub in the destination's line ink sits across the top edge at 15px from the left. Above it, the destination is drawn as chips or a short route (workspace, channel, thread, posting identity for Slack; project, recording, form for Basecamp).

### Context Quote
13.5px / 1.5 in `ink-soft` with a 2px `rule` left rule and 12px indent; it quotes the source and carries no source colour.

### Alerts
`porcelain`, 1px `ink` border, 6px corners, Float low. Outages name the source and dot the affected line; they never turn red.

## Do's and Don'ts

### Do:
- **Do** use the four line inks only to identify a source, at full strength on the chosen line and about 35% on the rest.
- **Do** set secondary text in `mute`; keep `dim` for non-text marks.
- **Do** show the exact destination and the exact text in the same view as Aprobar, and mark the text block with a top line stub in the destination's ink.
- **Do** draw lines with 6px round-capped strokes that bend only at 45 or 90 degrees, with interchange rings for items linked to two sources.
- **Do** express outages with dotted lines and a 45 degree slash, and show edits as strike (removed) and underline (added) without colour.
- **Do** keep every view working in both Tokio and Grafito through the tokens; Slack stays teal in both.

### Don't:
- **Don't** use red, green or orange as error, success or warning colours; red is GitHub, green is Basecamp, orange is Claude.
- **Don't** make any status tag solid ink except "Te espera" / "Por enviar".
- **Don't** split Claude-asks and Andrés-asks into separate column sets; direction is a line-into-ring marker on the row.
- **Don't** put `dim` on text, and don't fade station counts with opacity.
- **Don't** mark the exact-text block with a side border; the stub enters from the top.
