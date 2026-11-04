"use client";
// Mesa motion layer (motion.dev), ported from .impeccable/mocks/screens/mesa-motion.js.
// Thesis: the metro map is laid, then trains arrive. See motion.md for the rules.
// Budget: transform, opacity, stroke-dashoffset and clip-path only. Content is
// visible without JS. Under prefers-reduced-motion: no draw/travel/rise, fades and
// press feedback remain.
import { animate, inView, press, stagger } from "motion";
import { useEffect, useRef, type RefObject } from "react";

export const EASE = [0.16, 1, 0.3, 1] as const;
export const SPRING = { type: "spring", stiffness: 520, damping: 34, mass: 0.7 } as const;
export const SOFT = { type: "spring", stiffness: 300, damping: 30 } as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Metro lines in an SVG: unfilled strokes at least 4px wide, not dotted. */
function linePaths(svg: SVGSVGElement): SVGPathElement[] {
  return [...svg.querySelectorAll("path")].filter((p) => {
    const cs = getComputedStyle(p);
    return cs.fill === "none" && parseFloat(cs.strokeWidth) >= 4 && cs.strokeDasharray === "none";
  });
}

/** Focal: lines draw into their stations (0.7 s), ticks roll in, rings pop. */
export function layLines(svg: SVGSVGElement): void {
  const reduce = prefersReducedMotion();
  const paths = linePaths(svg);
  const circles = [...svg.querySelectorAll("circle")];
  const ticks = circles.filter((c) => Number(c.getAttribute("r")) <= 6);
  const rings = circles.filter((c) => Number(c.getAttribute("r")) > 6 && Number(c.getAttribute("r")) < 12);
  circles.forEach((c) => {
    c.style.transformBox = "fill-box";
    c.style.transformOrigin = "center";
  });
  if (reduce) {
    animate([...paths, ...ticks, ...rings], { opacity: [0, 1] }, { duration: 0.25 });
    return;
  }
  paths.forEach((p, i) => {
    const len = p.getTotalLength();
    if (!len) return;
    p.style.strokeDasharray = `${len}`;
    p.style.strokeDashoffset = `${len}`;
    animate(p, { strokeDashoffset: [len, 0] }, { duration: 0.7, delay: Math.min(i * 0.05, 0.3), ease: EASE }).then(() => {
      p.style.strokeDasharray = "";
      p.style.strokeDashoffset = "";
    });
  });
  ticks.forEach((c, i) =>
    animate(c, { opacity: [0, 1], transform: ["translateX(-56px)", "translateX(0px)"] }, { duration: 0.6, delay: 0.35 + Math.min(i * 0.04, 0.4), ease: EASE }),
  );
  rings.forEach((r, i) => animate(r, { opacity: [0, 1], transform: ["scale(.4)", "scale(1)"] }, { ...SPRING, delay: 0.55 + Math.min(i * 0.03, 0.25) }));
}

/** Continuity: a list arrives as a list (6px rise + fade, stagger <= 35 ms, total <= 0.28 s). */
export function arrive(items: Element[] | NodeListOf<Element>): void {
  const els = [...items];
  if (!els.length) return;
  const reduce = prefersReducedMotion();
  const step = Math.min(0.035, 0.28 / els.length);
  animate(
    els,
    reduce ? { opacity: [0, 1] } : { opacity: [0, 1], transform: ["translateY(6px)", "translateY(0px)"] },
    { duration: reduce ? 0.2 : 0.32, delay: stagger(step, { startDelay: 0.12 }), ease: EASE },
  );
}

/** Overlays (toasts, alerts, menus, toolbars) rise 10 px with a spring. */
export function rise(el: Element): void {
  const reduce = prefersReducedMotion();
  animate(
    el,
    reduce ? { opacity: [0, 1] } : { opacity: [0, 1], transform: ["translateY(10px) scale(.98)", "translateY(0px) scale(1)"] },
    reduce ? { duration: 0.2 } : SPRING,
  );
}

/** Phone sheets rise from the dock with a soft spring. */
export function riseSheet(sheet: Element, scrim?: Element | null): void {
  const reduce = prefersReducedMotion();
  if (scrim) animate(scrim, { opacity: [0, 1] }, { duration: 0.25 });
  animate(sheet, reduce ? { opacity: [0, 1] } : { transform: ["translateY(100%)", "translateY(0%)"] }, reduce ? { duration: 0.2 } : SOFT);
}

/** A chosen option, version pill, station tab or Mover target confirms with a short spring. */
export function confirmPick(el: Element): void {
  if (prefersReducedMotion()) return;
  animate(el, { scale: [0.96, 1.02, 1] }, { duration: 0.32, ease: EASE });
}

/** Semáforo marks paint in left to right like a highlighter. */
export function paintMarks(marks: Element[]): void {
  const reduce = prefersReducedMotion();
  marks.forEach((m, i) =>
    animate(m, reduce ? { opacity: [0, 1] } : { opacity: [0, 1], clipPath: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"] }, { duration: reduce ? 0.2 : 0.45, delay: i * 0.08, ease: EASE }),
  );
}

/**
 * Undo window: a tick travels the source line to the destination station over
 * `seconds`. Returns a stop function. Under reduced motion it jumps in 5 steps.
 */
export function travel(tick: HTMLElement, track: HTMLElement, seconds: number, elapsed = 0): () => void {
  const w = track.clientWidth - tick.clientWidth;
  if (prefersReducedMotion()) {
    const start = Date.now() - elapsed * 1000;
    const id = window.setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / (seconds * 1000));
      tick.style.transform = `translateX(${Math.floor(p * 5) * (w / 5)}px)`;
      if (p >= 1) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }
  const from = (elapsed / seconds) * w;
  const a = animate(tick, { transform: [`translateX(${from}px)`, `translateX(${w}px)`] }, { duration: Math.max(0, seconds - elapsed), ease: "linear" });
  return () => a.stop();
}

/** Press feedback: compress (0.97, or 0.99 for rows and cards) and spring back. */
export function pressable(el: Element, big = false): () => void {
  return press(el, (target) => {
    animate(target, { scale: big ? 0.99 : 0.97 }, { duration: 0.1 });
    return () => animate(target, { scale: 1 }, SPRING);
  });
}

// ---------- hooks ----------

/** Lay the lines of an SVG the first time it scrolls into view. */
export function useLayLines<T extends SVGSVGElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return inView(el, () => layLines(el), { amount: 0.3 });
  }, []);
  return ref;
}

/**
 * Make the children matching `selector` arrive as a list. Re-runs when `key`
 * changes (e.g. a new station or filter was picked).
 */
export function useArrive<T extends HTMLElement>(selector: string, key?: unknown): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    arrive(el.querySelectorAll(selector));
  }, [selector, key]);
  return ref;
}

/** Press feedback on every element matching `selector` inside the ref. */
export function usePress<T extends HTMLElement>(selector = ".btn, .tab, .chip", big = false): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stops = [...el.querySelectorAll(selector)].map((n) => pressable(n, big));
    return () => stops.forEach((s) => s());
  }, [selector, big]);
  return ref;
}

/** Rise an overlay when it mounts. */
export function useRise<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (ref.current) rise(ref.current);
  }, []);
  return ref;
}
