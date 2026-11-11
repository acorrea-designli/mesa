// The question card's stepper logic (t108), pure so it is tested without a browser: the state of each step, where a
// pick moves to, the "Enviar respuestas (n de k)" count and the answers a send carries.
import type { QuestionAnswer, TicketQuestion } from "@/lib/domain/types";
import type { DraftPick } from "./drafts";

export type Picks = Record<string, DraftPick>;
export type StepState = "open" | "picked" | "answered" | "withdrawn";

type Q = Pick<TicketQuestion, "id" | "state" | "options">;

/** A pick counts when it names one of the question's keys or has words in "Otra respuesta". */
export function hasPick(q: Q, p: DraftPick | undefined): boolean {
  if (!p) return false;
  return Boolean((p.chosen && q.options.some((o) => o.key === p.chosen)) || p.text?.trim());
}

export function stepState(q: Q, picks: Picks): StepState {
  if (q.state === "answered") return "answered";
  if (q.state === "withdrawn") return "withdrawn";
  return hasPick(q, picks[q.id]) ? "picked" : "open";
}

/** The step a card opens on: the first open step without a pick, else the first open one, else the first. */
export function firstStep(qs: Q[], picks: Picks): number {
  const i = qs.findIndex((q) => stepState(q, picks) === "open");
  if (i >= 0) return i;
  const j = qs.findIndex((q) => q.state === "open");
  return j >= 0 ? j : 0;
}

/**
 * Where a pick on step `from` moves: the next open step after it with no pick yet, then the first such step before
 * it; `from` itself when every open step has its pick.
 */
export function nextOpenStep(qs: Q[], picks: Picks, from: number): number {
  const waiting = (i: number) => stepState(qs[i]!, picks) === "open";
  for (let i = from + 1; i < qs.length; i++) if (waiting(i)) return i;
  for (let i = 0; i < from; i++) if (waiting(i)) return i;
  return from;
}

/** "n de k": the open questions with a pick, and every open question. */
export function pickCount(qs: Q[], picks: Picks): { n: number; k: number } {
  const open = qs.filter((q) => q.state === "open");
  return { n: open.filter((q) => hasPick(q, picks[q.id])).length, k: open.length };
}

/** The answers a send carries: one per open question with a pick (a key, his words, or both). */
export function answersOf(qs: Q[], picks: Picks): QuestionAnswer[] {
  return qs
    .filter((q) => q.state === "open" && hasPick(q, picks[q.id]))
    .map((q) => {
      const p = picks[q.id]!;
      const chosen = p.chosen && q.options.some((o) => o.key === p.chosen) ? p.chosen : undefined;
      const text = p.text?.trim() || undefined;
      return { questionId: q.id, ...(chosen ? { chosen } : {}), ...(text ? { text } : {}) };
    });
}

/** Picks without the ones for questions that are no longer open (answered on another device, withdrawn). */
export function livePicks(qs: Q[], picks: Picks): Picks {
  const open = new Set(qs.filter((q) => q.state === "open").map((q) => q.id));
  return Object.fromEntries(Object.entries(picks).filter(([id]) => open.has(id)));
}

/** Set or clear the key of one question; a second click on the same key takes it back. */
export function togglePick(picks: Picks, id: string, key: string): Picks {
  const cur = picks[id] ?? {};
  const next: DraftPick = { ...cur, chosen: cur.chosen === key ? undefined : key };
  return withPick(picks, id, next);
}

/** Set the "Otra respuesta" words of one question. */
export function setPickText(picks: Picks, id: string, text: string): Picks {
  return withPick(picks, id, { ...(picks[id] ?? {}), text });
}

function withPick(picks: Picks, id: string, p: DraftPick): Picks {
  const out = { ...picks };
  const clean: DraftPick = {};
  if (p.chosen) clean.chosen = p.chosen;
  if (p.text) clean.text = p.text;
  if (clean.chosen || clean.text) out[id] = clean;
  else delete out[id];
  return out;
}
