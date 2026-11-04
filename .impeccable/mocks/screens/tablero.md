# tablero — Kanban mirrored to the private GitHub Project
What: five stations (Inbox, Todo, En curso, Esperando, Hecho) under one continuous four-line header (source lines pass through station capsules). Cards: source line stub (interchange ring when linked to two sources), project, time, title (2 lines max), one-line excerpt, link chips (PR #212 / Basecamp · Freightmate / Slack #scout-dev), wait tag (Te espera / Espera al cliente / Espera a Claude / Espera a Matt).
Variants: A Columnas (recommended: reads as a kanban first, line motif only in the header). B Carriles por fuente: one lane per source, the lane's line runs behind its cards; stronger metro reading, but 4 x 5 cells waste space when a source is quiet.
States: syncing (dot travels the sync track), sync error (alert + header lines turn dotted = service interrupted, local moves queued), empty column, source filter (chosen line burns, others 35%).
Reuse from hoy.html: tokens, rail, tabs, .st, .chip (as .lk), .btn. Hecho shows 4 compact cards + "N más hechas hoy"; every column caps visible cards and ends with "+N más".
Must not change: lines carry source only; bends at 45/90 only; "Te espera" is the only solid-ink tag.
Devs: rail Tablero count = open items (Inbox+Todo+En curso+Esperando = 22); hoy.html shows 23, align it. Card title is an h2 (heading order). Drag between columns moves the GitHub Project Status field; show "Sin sincronizar" until the write is acked.
Datos de muestra.

Decision (Andrés, 2026-11-03, live): "Me gusta el B". Variant B (lanes by source) is the chosen Tablero.
