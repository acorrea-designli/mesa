/*
 * Mesa motion layer for the mockups (motion.dev 14.3.1, vendored in ./vendor).
 *
 * Thesis: the metro map is laid, then trains arrive.
 *   Focal:      on load the source lines draw themselves into the stations, then the
 *               ticks roll in along their line and settle at their stop.
 *   Continuity: lists, cards and plan rows arrive as lists (short stagger, capped);
 *               switching a variant or a station re-runs only that block.
 *   Feedback:   every press compresses a little; choices, chips and version pills
 *               confirm with a quick spring; sheets and toasts rise from the dock.
 *   Budget:     transform/opacity/stroke only; loops pause offscreen; nothing loops
 *               except the existing "travel" dots.
 * Content is visible by default: if this file fails, the mock is unchanged.
 * Reduced motion: no travel, no draw, no rise; opacity fades and press feedback stay.
 */
(function () {
  const M = window.Motion;
  if (!M) return;
  const { animate, stagger, inView, press, spring } = M;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE = [0.16, 1, 0.3, 1];
  const SPRING = { type: spring, stiffness: 520, damping: 34, mass: 0.7 };
  const SOFT = { type: spring, stiffness: 300, damping: 30 };
  const inLive = (el) => !!el.closest('[id^="impeccable"],[class*="impeccable-"],[data-impeccable-live]');
  const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
  const done = new WeakSet();

  // ---------- focal: lines are laid, then ticks roll in ----------
  // A metro line is any unfilled stroke at least 4px wide (tokens or raw colours).
  function linePaths(svg) {
    return [...svg.querySelectorAll('path')].filter((p) => {
      if (p.closest('.sv-dash') || !p.getTotalLength) return false;
      const cs = getComputedStyle(p);
      return cs.fill === 'none' && parseFloat(cs.strokeWidth) >= 4 && cs.strokeDasharray === 'none';
    });
  }
  function layLines(svg) {
    if (done.has(svg)) return; done.add(svg);
    const paths = linePaths(svg);
    const circles = [...svg.querySelectorAll('circle')];
    const ticks = circles.filter((c) => +c.getAttribute('r') <= 6);
    const rings = circles.filter((c) => +c.getAttribute('r') > 6 && +c.getAttribute('r') < 12);
    circles.forEach((c) => { c.style.transformBox = 'fill-box'; c.style.transformOrigin = 'center'; });
    if (reduce) {
      animate([...paths, ...ticks, ...rings], { opacity: [0, 1] }, { duration: 0.25 });
      return;
    }
    paths.forEach((p, i) => {
      let len = 0; try { len = p.getTotalLength(); } catch { return; }
      if (!len) return;
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = `${len}`;
      animate(p, { strokeDashoffset: [len, 0] }, { duration: 0.7, delay: Math.min(i * 0.05, 0.3), ease: EASE })
        .then(() => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; });
    });
    ticks.forEach((c, i) => {
      animate(c, { opacity: [0, 1], transform: ['translateX(-56px)', 'translateX(0px)'] },
        { duration: 0.6, delay: 0.35 + Math.min(i * 0.04, 0.4), ease: EASE });
    });
    rings.forEach((r, i) => {
      animate(r, { opacity: [0, 1], transform: ['scale(.4)', 'scale(1)'] }, { ...SPRING, delay: 0.55 + Math.min(i * 0.03, 0.25) });
    });
  }

  // ---------- lists arrive as lists ----------
  const LIST_ITEMS = [
    '.row', '.tk-row', '.ph-row', '.tb-card', '.sa-qc', '.sa-qi', '.qc', '.pp-card', '.pp-qi',
    '.tk-act', '.pp-act', '.pp-obs', '.tk-mi', '.pp-mi', '.sa-turn', '.pp-turn', '.sa-ev', '.pp-sent',
  ].join(',');
  function arrive(scope) {
    const groups = new Map();
    scope.querySelectorAll(LIST_ITEMS).forEach((el) => {
      if (done.has(el) || inLive(el) || !visible(el)) return;
      done.add(el);
      const k = el.parentElement; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(el);
    });
    groups.forEach((els) => {
      const step = Math.min(0.035, 0.28 / els.length);
      animate(els, reduce ? { opacity: [0, 1] } : { opacity: [0, 1], transform: ['translateY(6px)', 'translateY(0px)'] },
        { duration: reduce ? 0.2 : 0.32, delay: stagger(step, { startDelay: 0.12 }), ease: EASE });
    });
    // Plan/action line stubs grow along their direction (they are lines, so they travel).
    if (!reduce) scope.querySelectorAll('.tk-act .ln, .pp-act .ln, .tk-rec .ln, .tk-dir svg path').forEach((ln, i) => {
      if (done.has(ln) || !visible(ln)) return; done.add(ln);
      ln.style.transformOrigin = 'left center';
      animate(ln, { transform: ['scaleX(0)', 'scaleX(1)'] }, { duration: 0.45, delay: 0.2 + Math.min(i * 0.03, 0.3), ease: EASE });
    });
  }

  // ---------- overlays rise from the dock ----------
  function rise(scope) {
    scope.querySelectorAll('.ph-sheet').forEach((s) => {
      if (done.has(s)) return; done.add(s);
      animate(s, reduce ? { opacity: [0, 1] } : { transform: ['translateY(100%)', 'translateY(0%)'] }, reduce ? { duration: 0.2 } : SOFT);
    });
    scope.querySelectorAll('.ph-scrim').forEach((s) => { if (!done.has(s)) { done.add(s); animate(s, { opacity: [0, 1] }, { duration: 0.25 }); } });
    scope.querySelectorAll('.ph-toast, .alert, .pp-undo, .tk-mention, .pp-menu, .pp-tool, .sa-tool').forEach((t) => {
      if (done.has(t) || inLive(t)) return; done.add(t);
      animate(t, reduce ? { opacity: [0, 1] } : { opacity: [0, 1], transform: ['translateY(10px) scale(.98)', 'translateY(0px) scale(1)'] },
        reduce ? { duration: 0.2 } : { ...SPRING, delay: 0.25 });
    });
    // Semáforo marks paint in like a highlighter stroke.
    scope.querySelectorAll('mark.m-keep, mark.m-redo, mark.m-drop').forEach((m, i) => {
      if (done.has(m)) return; done.add(m);
      animate(m, reduce ? { opacity: [0, 1] } : { opacity: [0, 1], clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'] }, { duration: reduce ? 0.2 : 0.45, delay: 0.3 + i * 0.08, ease: EASE });
    });
  }

  // ---------- the undo window: a tick travels to the destination station ----------
  function undoTrack(scope) {
    scope.querySelectorAll('.pp-track .tk').forEach((tk) => {
      if (done.has(tk) || reduce) return; done.add(tk);
      const track = tk.parentElement;
      const run = () => {
        const w = track.clientWidth - 16;
        return animate(tk, { left: ['0px', `${w}px`] }, { duration: 20, ease: 'linear', repeat: Infinity, repeatDelay: 0.6 });
      };
      let a = null;
      inView(track, () => { a = run(); return () => a && a.stop(); });
    });
  }

  // ---------- feedback ----------
  const PRESSABLE = '.btn, .tab, .tk-opt, .pp-chip, .tk-verb, .pp-v, .sa-chip, .chip, .ico-btn, .pp-x, .x, .nav, .mk-seg button, .pp-tool button, .tk-row, .row, .tb-card, .pp-card, .sa-qc, .pp-qi';
  press(PRESSABLE, (el) => {
    if (inLive(el)) return;
    const big = el.matches('.tk-row, .row, .tb-card, .pp-card, .sa-qc, .pp-qi, .tk-opt');
    animate(el, { scale: big ? 0.99 : 0.97 }, { duration: 0.1 });
    return () => animate(el, { scale: 1 }, SPRING);
  });
  // A choice confirms: the picked option springs, siblings settle.
  document.addEventListener('click', (e) => {
    const opt = e.target.closest('.tk-opt, .pp-v, .ph-sts .tab, .pp-move .btn');
    if (!opt || inLive(opt)) return;
    const group = opt.parentElement;
    const cls = opt.classList.contains('tk-opt') ? 'pick' : 'on';
    group.querySelectorAll(':scope > .' + [...opt.classList][0]).forEach((s) => s !== opt && s.classList.remove(cls));
    opt.classList.add(cls);
    if (!reduce) animate(opt, { scale: [0.96, 1.02, 1] }, { duration: 0.32, ease: EASE });
  }, true);

  // ---------- run ----------
  function runAll(scope = document) {
    scope.querySelectorAll('svg').forEach((svg) => {
      if (inLive(svg) || !visible(svg) || linePaths(svg).length < 2) return;
      inView(svg, () => layLines(svg), { amount: 0.3 });
    });
    // Sections below the fold animate as they are reached.
    const blocks = scope.querySelectorAll('.mk-panel, .ph, .ph-col, .sa-pane, .pp-wrap > *, section[data-variant] > *');
    if (!blocks.length) { arrive(scope); rise(scope); undoTrack(scope); return; }
    blocks.forEach((b) => {
      if (!visible(b)) return;
      inView(b, () => { arrive(b); rise(b); undoTrack(b); }, { amount: 0.15 });
    });
    arrive(scope.querySelector('main') || scope); // above-the-fold main lists
  }

  // Variant toggles (A/B) re-run only the newly shown section.
  new MutationObserver(() => requestAnimationFrame(() => {
    const v = document.body.dataset.view;
    const sec = document.querySelector(`[data-variant="${v}"]`);
    if (sec) runAll(sec);
  })).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => runAll());
  else runAll();
})();
