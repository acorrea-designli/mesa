---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: []
---

# Surface: Mesa board (main app shell: Hoy, Tablero, Tickets, Salidas)

Mode: Operate. Build path: code-led.

Audience and job: Andrés alone, desktop tab all day plus phone for approvals. He opens it to see what waits on him (PRs to review, Basecamp client requests, Slack replies, Claude's questions) and to approve, edit or deny outgoing messages Claude drafted.

Chosen direction: "Mapa de metro" (catalog world wayfinding-cartography-signage-midnight-transit-diagram, picked from the bolder re-roll), re-paletted by the user: light "Tokio" is the default, dark "Grafito" is the alternate theme.

Reference sketches: `.impeccable/mocks/decision/metro-tokio.html` (light) and `metro-grafito.html` (dark). Known sketch defects to fix in the build: the band title collides with the "Inbox" station label, and the legend collides with "Esperando".

Unresolved: whether the line band stays readable past ~30 items (cap ticks per station with a "+N" count); phone layout of the band (collapse to the selected station's corridor).

## Direction contract

THESIS: The day is a transit network. Each source is a coloured line and each status is a station. It refuses the category default, a grey sidebar-and-list kanban with one violet accent.

OWN-WORLD: Tokio light: warm grey ground #eceae5, porcelain panels #fbfaf7, ink #1c1d21. Line inks carry the source and nothing else: GitHub red #e60012, Slack teal #00a3a8, Claude orange #f39700, Basecamp green #00b07c. Grafito dark: #17191d ground, the same four hues brightened, and Slack stays teal. Station capsules have white fill and ink outline, interchange circles are open rings, and lines bend only at 45 and 90 degrees. The type is a humanist transit sans with fixed-size labels and tabular numerals.

STORY: In one glance he sees how much waits at each station, and which source it comes from. He picks a station, scans the rows, and decides. Outgoing messages show their exact destination and exact text before he signs.

FIRST VIEWPORT: Left rail: Hoy, Tablero, Tickets, Salidas, with counts. Top band across the work area: "Línea del día", five stations (Inbox, Todo, En curso, Esperando, Hecho) with counts, and items as source-coloured ticks. The selected station is solid and the rest of the line is dimmed. Below: source filter tabs, then the rows of the selected station (hora, origen, asunto with a source excerpt, necesita, estado), then a "Salidas · esperan tu firma" group. Right pane: the selected item. For an approval it shows destination chips, context, the exact text, and Aprobar y enviar / Editar / Denegar.

FORM: wayfinding-cartography-signage-midnight-transit-diagram (dealt challenger, bolder re-roll round 1, verdict wins). seed: none (unavailable)

SIGNATURE: the line band. Picking a station or a source filter re-routes it: the chosen line burns at full ink and the others drop to about 35%. When an item changes status, its tick travels along its line to the next station, and with reduced motion it jumps there instead. An item linked to two sources (a Basecamp request with its PR) is drawn as an interchange ring.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
