// Checklists in a ticket thread (t124). A Claude message carries 1-30 manual steps for Andrés; each has its text, an
// optional Markdown detail and a checkbox that anyone can set either way. Pure: used by the repo, the API schemas, the
// needs line and the thread UI.
import type { Checklist, TicketStep } from "./types";

export const MAX_STEPS = 30;
export const MAX_STEP_TEXT = 300;
export const MAX_STEP_DETAIL = 4000;
export const MAX_STEP_NOTE = 300;

/** What Claude sends for one step. */
export interface StepInput {
  text: string;
  detail?: string | null;
}

/** Why a checklist is not valid, or null: 1-30 steps, each with text (one line of at most 300 characters) and a detail of at most 4000. */
export function checklistProblem(steps: StepInput[]): string | null {
  if (steps.length < 1 || steps.length > MAX_STEPS) return `a checklist has 1-${MAX_STEPS} steps`;
  for (const [i, s] of steps.entries()) {
    const at = `step ${i + 1}`;
    if (!s.text.trim()) return `${at} has no text`;
    if (s.text.trim().length > MAX_STEP_TEXT) return `${at}: text is over ${MAX_STEP_TEXT} characters (put the rest in detail)`;
    if ((s.detail ?? "").length > MAX_STEP_DETAIL) return `${at}: detail is over ${MAX_STEP_DETAIL} characters`;
  }
  return null;
}

export const isDone = (s: Pick<TicketStep, "state">) => s.state === "done";

/** "2 de 5": done and total of a set of steps. */
export const stepCount = (steps: Pick<TicketStep, "state">[]): { done: number; total: number } => ({
  done: steps.filter(isDone).length,
  total: steps.length,
});

/** The steps grouped by their message, each group in step order, groups in the order their first step appears. */
export function groupChecklists(steps: TicketStep[]): Checklist[] {
  const by = new Map<string, TicketStep[]>();
  for (const s of steps) by.set(s.messageId, [...(by.get(s.messageId) ?? []), s]);
  return [...by.entries()].map(([messageId, list]) => {
    const sorted = [...list].sort((a, b) => a.n - b.n);
    const { done, total } = stepCount(sorted);
    return { messageId, done, total, allDone: total > 0 && done === total, steps: sorted };
  });
}

/** The checklist of one message, or null. */
export const checklistOf = (lists: Checklist[], messageId: string): Checklist | null => lists.find((c) => c.messageId === messageId) ?? null;

/** Open steps across the ticket: what Andrés still owes ("2 de 5 hechos", over the checklists that still have an open step). */
export function stepsOwed(steps: Pick<TicketStep, "state" | "messageId">[]): { done: number; total: number; open: number } {
  const openIn = new Set(steps.filter((s) => !isDone(s)).map((s) => s.messageId));
  const live = steps.filter((s) => openIn.has(s.messageId));
  const { done, total } = stepCount(live);
  return { done, total, open: total - done };
}

/**
 * Which step a reference names: a step id (`ck_…`), `<messageId>.<n>` (also `<messageId>/<n>`), or a bare `n`, which
 * is valid only while exactly one checklist of the ticket has a step n. Returns the step, or an error that says how to
 * name it ("not found" / "ambiguous").
 */
export function findStep(steps: TicketStep[], ref: string): { step: TicketStep } | { error: "not_found" | "ambiguous"; message: string } {
  const r = ref.trim();
  const byId = steps.find((s) => s.id === r);
  if (byId) return { step: byId };
  const m = /^(.+)[./](\d+)$/.exec(r);
  if (m) {
    const s = steps.find((x) => x.messageId === m[1] && x.n === Number(m[2]));
    return s ? { step: s } : { error: "not_found", message: `step ${r} is not in this ticket` };
  }
  if (/^\d+$/.test(r)) {
    const hits = steps.filter((s) => s.n === Number(r));
    if (hits.length === 1) return { step: hits[0]! };
    if (hits.length > 1) return { error: "ambiguous", message: `step ${r} is in ${hits.length} checklists of this ticket: name it as <message id>.${r} or by its step id` };
  }
  return { error: "not_found", message: `step ${r} is not in this ticket` };
}
