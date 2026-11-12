// The checklist card's optimistic toggle (t124), pure so it is tested without a browser. A tap shows its result at
// once (`pending`: step id -> the state he asked for); the server's answer replaces it, and a failed call takes it back.
import type { TicketStep } from "@/lib/domain/types";

/** Step id -> the checked state Andrés asked for and the server has not confirmed yet. */
export type Pending = Record<string, boolean>;

type S = Pick<TicketStep, "id" | "state">;

/** What the row shows: his pending tap, else the server's state. */
export const isChecked = (s: S, pending: Pending): boolean => pending[s.id] ?? s.state === "done";

/** "n de k hechos" as shown, pending taps included. */
export function shownCount(steps: S[], pending: Pending): { done: number; total: number } {
  return { done: steps.filter((s) => isChecked(s, pending)).length, total: steps.length };
}

/** The pending taps once the server's steps are in: an entry the server already agrees with is confirmed and goes. */
export function confirmed(steps: S[], pending: Pending): Pending {
  const by = new Map(steps.map((s) => [s.id, s.state === "done"]));
  return Object.fromEntries(Object.entries(pending).filter(([id, want]) => by.has(id) && by.get(id) !== want));
}

/** A tap that failed: the step goes back to what the server says. */
export function rolledBack(pending: Pending, id: string): Pending {
  const { [id]: _gone, ...rest } = pending;
  void _gone;
  return rest;
}

/** The progress bar's fill, 0-100. */
export const percent = (done: number, total: number): number => (total > 0 ? Math.round((done / total) * 100) : 0);
