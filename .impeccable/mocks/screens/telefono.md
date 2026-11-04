# telefono — phone 390x844, three frames
What: Hoy (band collapsed to the selected station's corridor: lines solid into Inbox, dimmed after, next station named at the edge; station tabs scroll), approval full screen (route destination, context, exact text, docked actions), ticket answer (question, A/B, recommendation, docked reply).
Variants: A Corredor (recommended: keeps the hoy band's horizontal reading; answers the open "phone band" question in the surface doc). B Mapa vertical: the day as a vertical strip map with the selected station expanded; Denegar | Aprobar split at thumb height; options side by side.
States: enviado (with "Siguiente" to keep signing), denegada (toast with Deshacer for a few seconds), ticket respondido (Claude despertó).
Reuse: same tokens, .st, .msg, .ctx, route stops from salidas, option buttons from tickets. Bottom tab bar replaces the rail.
Must not change: primary action >= 56px tall; Aprobar never sits where a thumb rests by accident without the exact text visible above it.
Devs: status bar text "vía túnel" reflects tunnel health; see estados for the offline phone.
Datos de muestra.
Steer 2026-11-03 (Andrés: "todas las features de las que hablamos en los otros deberian estar aca"): block id="paridad" "Lo del escritorio, en el teléfono", same in A and B, six frames:
1. Salida · afinar: origin strip (ticket + sources + Historial), compact route, version stepper (v1 · … · starred · compared dashed · current), semáforo marks with the fixed Mantener/Reformular/Quitar/Limpiar toolbar above the text, folded refine turns. Dock: marks chip, refine input + Enviar, learned chips, split Aprobar y enviar vN | ▾.
2. Salida · memoria: free-order queue strip (any card opens; swipe left skips; decided items dashed), counter "3 pendientes · 1 programada", engram memory as a bottom sheet (status, search, typed observations, "aplica a este mensaje", footer).
3. Salida · deshacer y eliminar: 20 s countdown with the tick travelling the source line, Deshacer. Sent list with delete per destination (Basecamp comment to trash 25 d, Campfire permanent, Slack disabled + Abrir en Slack). Toast Restaurar.
4. Ticket · responder: A/B, @ ticket picker, composer with files and @ refs, "@ tickets · / acciones", "En engram · <project>".
5. Nuevo pedido: composer + files + refs, "Claude va a hacer" plan (directo / te pide OK), frequent action chips, Enviar a Claude, "Se guarda en engram".
6. Tablero B on phone: station tabs, one lane per source with its line, a quiet lane stays one line, "Mover" bottom sheet with the five stations, synced to the GitHub Project ("Sin sincronizar" until acked).
Chosen 2026-11-03: A · Corredor ("vamos con A"). Body stays data-view="a".
