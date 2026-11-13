// Autoscroll rule of the thread: it follows the conversation to its last message, unless Andrés is
// reading history, in which case a "nuevo mensaje" pill offers the jump instead. Pure, so it is tested.

/** Within this many px of the end of the thread counts as "at the bottom". */
export const NEAR_BOTTOM_PX = 120;

export interface ScrollBox {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export const distanceFromBottom = (b: ScrollBox): number => Math.max(0, b.scrollHeight - b.scrollTop - b.clientHeight);

export const isNearBottom = (b: ScrollBox, threshold = NEAR_BOTTOM_PX): boolean => distanceFromBottom(b) <= threshold;

// ---------- the plan pill ----------
// A plan with a step waiting sits at the bottom of the thread, right above the composer (t150), so one that arrives
// while he reads history is off screen: "Ver plan nuevo ↓" / "Plan pendiente ↓" jump to it. Opening a ticket lands
// at the end, where the plan already is, so "pendiente" only shows when its card is taller than what fits.

export type PlanPillKind = "nuevo" | "pendiente";

/** Fewest px of the plan block that must show for it to count as in view (less when the block itself is shorter). */
export const PLAN_VISIBLE_PX = 48;

export interface Span {
  top: number;
  bottom: number;
}

/** The plan block is in view when enough of it overlaps what the thread shows. */
export function planInView(plan: Span, view: Span, min = PLAN_VISIBLE_PX): boolean {
  const overlap = Math.min(plan.bottom, view.bottom) - Math.max(plan.top, view.top);
  return overlap >= Math.min(min, Math.max(1, plan.bottom - plan.top));
}

/** A planned step the open thread has not seen yet: the plan arrived or grew. */
export const hasUnseenStep = (planned: readonly string[], seen: readonly string[]): boolean => planned.some((id) => !seen.includes(id));

/**
 * The plan pill after the thread opens, the plan changes or the thread scrolls. No planned step, or the plan in
 * view, hides it. On opening it is "Plan pendiente"; later a planned step the thread had not seen is "Ver plan
 * nuevo"; otherwise it stays as it was (so it persists until he taps it, sees the plan or nothing is planned).
 */
export function nextPlanPill(s: { current: PlanPillKind | null; planned: readonly string[]; seen: readonly string[]; inView: boolean; opening: boolean }): PlanPillKind | null {
  if (!s.planned.length || s.inView) return null;
  if (s.opening) return "pendiente";
  return hasUnseenStep(s.planned, s.seen) ? "nuevo" : s.current;
}

export type VisiblePill = "plan-nuevo" | "plan-pendiente" | "message" | null;

/** One pill at a time: the plan wins over "nuevo mensaje", which comes back once the plan pill is gone if still due. */
export function visiblePill(s: { plan: PlanPillKind | null; message: boolean }): VisiblePill {
  if (s.plan) return s.plan === "nuevo" ? "plan-nuevo" : "plan-pendiente";
  return s.message ? "message" : null;
}

/** The pill's words. Every pill points down: what it brings him to (a message, the waiting plan) is at the end. */
export function pillLabel(p: Exclude<VisiblePill, null>): { text: string; arrow: "↓" } {
  return { text: p === "plan-nuevo" ? "Ver plan nuevo" : p === "plan-pendiente" ? "Plan pendiente" : "nuevo mensaje", arrow: "↓" };
}

export type OnNewMessage = "scroll" | "pill";

/**
 * What to do when a message appears on the open ticket. His own message always scrolls (he just
 * sent it); one from Claude or a teammate scrolls only if he was already at the bottom, otherwise
 * the pill shows and his place in the history is left alone.
 */
export function onNewMessage(m: { own: boolean; wasNearBottom: boolean }): OnNewMessage {
  return m.own || m.wasNearBottom ? "scroll" : "pill";
}
