# estados — global states for Hoy
What: source disconnected (Slack MCP unreachable), GitHub rate-limited, nothing waiting, first run, phone offline (tunnel down).
Variants (for the two outage states): A Aviso en la línea (recommended: the affected line turns dotted in the band, its legend entry says "Slack · sin conexión", one alert above the list, affected rows show "Sin datos"). B Aviso en el riel: a persistent "Fuentes" health block in the rail and row tags only, no alert; quieter, but easy to miss.
Shared: "Nada te espera" (band at rest, done ticks gathered at Hecho, Hecho hoy list in the detail pane); "Conecta tus fuentes" checklist (GitHub, GitHub Project, Basecamp, Slack); phone "Sin conexión con tu PC": cached view, band greyscaled, sign/answer disabled.
Signature: "service interrupted" = a line cut by a 45-degree slash (broken icon) + dotted line. Never red: red is GitHub.
Must not change: approvals during a Slack outage queue as "Aprobar al volver" and re-check the thread before sending.
Devs: hoy.html's --dim (#6f717a) is 3.7:1 on --deep and 4.0:1 on --gnd; these mocks add --mute (#5d5f68) for text and keep --dim untouched. Recommend replacing text uses of --dim in hoy with --mute. Station counts use --mute, not opacity.
Datos de muestra.
Chosen 2026-11-03: B · Aviso en el riel ("B"). Body data-view="b".
