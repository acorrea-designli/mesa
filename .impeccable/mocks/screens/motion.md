# motion — shared animation layer for every screen
Decision 2026-11-03 (Andrés: "falto el tema de animaciones usa motion.dev, quiero que se vea super pulido con animaciones"): all screens load `vendor/motion-14.3.1.js` (motion.dev, vendored) + `mesa-motion.js` before the live script. The app build uses the `motion` npm package with the same rules.
Thesis: the metro map is laid, then trains arrive.
- Focal: on load each source line draws into its stations (0.7 s), then the ticks roll in along their line (-56 px → stop, staggered) and interchange rings pop in with a spring. Lines are any unfilled stroke >= 4 px.
- Continuity: lists arrive as lists (rows, cards, queue items, plan rows, memory items, chat turns): 6 px rise + fade, stagger <= 35 ms, total <= 0.28 s. Blocks below the fold run when reached (inView). Switching A/B re-runs only the shown section.
- Feedback: every press compresses (0.97, 0.99 for rows and cards) and springs back. A chosen option, version pill, station tab or "Mover" target confirms with a short spring. Plan, action and recommendation line stubs grow along their direction.
- Overlays: phone sheets rise from the dock (soft spring) over a fading scrim; toasts, alerts, the undo card, @ and / menus and the semáforo toolbar rise 10 px with a spring. Semáforo marks paint in left to right like a highlighter.
- Undo window: the tick travels the source line to the destination station over the 20 s, and pauses offscreen.
- Reduced motion: no draw, travel or rise. Opacity fades and press feedback remain.
Budget: transform, opacity, stroke-dashoffset and clip-path only. Content is visible if the script fails.
