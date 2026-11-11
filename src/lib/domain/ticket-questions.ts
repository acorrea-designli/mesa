// Question cards in a ticket thread (t108). A Claude message carries 1-6 questions, each with 2-6 options (keys A-F),
// a recommended key and a one-line why. Each question keeps its own state (open | answered | withdrawn): only an
// answer of Andrés that names it, or Claude withdrawing it, closes it. Pure: used by the repo, the API schemas, the
// needs line and the thread UI.
import type { QuestionAnswer, TicketMessage, TicketOption, TicketQuestion } from "./types";

export const MAX_QUESTIONS = 6;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;
/** Option keys of a card question, in order. */
export const OPTION_KEYS = ["A", "B", "C", "D", "E", "F"] as const;

/** What Claude sends for one question of a card. */
export interface QuestionInput {
  text?: string;
  options: TicketOption[];
  recommended?: string | null;
  recommendation?: string | null;
}

/**
 * Why a card is not valid, or null: 1-6 questions, each with 2-6 options, keys A-F and unique, a recommended key
 * among them. `requireText`: every question needs its own text (a card of several; a 1-step card may leave it to the
 * message body).
 */
export function cardProblem(questions: QuestionInput[], o: { requireText?: boolean } = {}): string | null {
  if (questions.length < 1 || questions.length > MAX_QUESTIONS) return `a card has 1-${MAX_QUESTIONS} questions`;
  for (const [i, q] of questions.entries()) {
    const at = `question ${i + 1}`;
    if (o.requireText && !q.text?.trim()) return `${at} has no text`;
    if (q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) return `${at} needs ${MIN_OPTIONS}-${MAX_OPTIONS} options`;
    const keys = q.options.map((x) => x.key);
    if (keys.some((k) => !(OPTION_KEYS as readonly string[]).includes(k))) return `${at}: option keys are A-F`;
    if (new Set(keys).size !== keys.length) return `${at}: option keys must be unique`;
    if (q.options.some((x) => !x.label.trim())) return `${at}: every option needs a label`;
    if (q.recommended && !keys.includes(q.recommended)) return `${at}: recommended "${q.recommended}" is not one of its options`;
  }
  return null;
}

export const isOpen = (q: Pick<TicketQuestion, "state">) => q.state === "open";

/** The questions of one card (one message), in step order. */
export const cardOf = <Q extends Pick<TicketQuestion, "messageId" | "n">>(qs: Q[], messageId: string): Q[] =>
  qs.filter((q) => q.messageId === messageId).sort((a, b) => a.n - b.n);

/** The words of a question: its own text, or the first line of the message that asked it (a 1-step card). */
export function questionText(q: Pick<TicketQuestion, "text">, body?: string | null): string {
  if (q.text.trim()) return q.text.trim();
  const line = (body ?? "").split("\n").map((l) => l.trim()).find(Boolean);
  return line ?? "Claude espera una elección";
}

/** Label of option `key` of `q`, or "" when it has none. */
export const optionLabel = (q: Pick<TicketQuestion, "options">, key: string | null | undefined): string =>
  (key && q.options.find((o) => o.key === key)?.label) || "";

type Openish = Pick<TicketQuestion, "id" | "messageId" | "n" | "options" | "state" | "createdAt">;

/**
 * Typed shorthand as answers to the open questions, or [] when the text is not shorthand (it stays a comment):
 *  - numbered picks, the whole text: "1A 2C", "1: B, 2-A", "1a y 3c" (n = the step in its card; when two open cards
 *    share a step number, the newest card wins);
 *  - a bare key ("A", " b. ", "A)") only when exactly one question is open.
 * Every pick must name an open question and one of its keys, once; otherwise nothing is answered.
 */
export function parseShorthand(text: string, open: Openish[]): QuestionAnswer[] {
  const live = open.filter(isOpen);
  if (!live.length) return [];
  const s = text.trim().replace(/[\s.,;:!)\]]+$/, "").toLowerCase();
  if (!s) return [];
  if (!/\d/.test(s)) {
    if (live.length !== 1) return [];
    const key = live[0]!.options.find((o) => o.key.toLowerCase() === s)?.key;
    return key ? [{ questionId: live[0]!.id, chosen: key }] : [];
  }
  const token = /^\s*(?:(?:,|;|\/|&|y\b|e\b)\s*)?(\d{1,2})\s*[:.\-)]?\s*([a-z])(?![a-z])/;
  const out: QuestionAnswer[] = [];
  let rest = s;
  // Newest card first, so a step number shared by two open cards names the newest one.
  const byNewest = [...live].sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1));
  while (rest.trim()) {
    const m = token.exec(rest);
    if (!m) return [];
    rest = rest.slice(m[0].length);
    const q = byNewest.find((x) => x.n === Number(m[1]));
    const key = q?.options.find((o) => o.key.toLowerCase() === m[2])?.key;
    if (!q || !key || out.some((a) => a.questionId === q.id)) return [];
    out.push({ questionId: q.id, chosen: key });
  }
  return out;
}

/** The body an answer message gets when he typed nothing: "A. Bucket nuevo" for one pick, "1A. …" per line for more. */
/** True when q's card has more than one step, so its answers carry the step number ("1B", not "B"). */
export const multiStep = (q: Pick<TicketQuestion, "messageId">, all: Pick<TicketQuestion, "messageId" | "n">[]): boolean =>
  all.some((x) => x.messageId === q.messageId && x.n > 1);

/** The body of his answering message when he typed nothing: one line per answer, numbered unless it is one answer to a
 * 1-step card. `qs`: every question of the ticket. */
export function answersBody(answers: QuestionAnswer[], qs: Pick<TicketQuestion, "id" | "n" | "options" | "messageId">[]): string {
  return answers
    .map((a) => {
      const q = qs.find((x) => x.id === a.questionId);
      if (!q) return "";
      const one = answers.length === 1 && !multiStep(q, qs);
      const head = a.chosen ? `${one ? "" : q.n}${a.chosen}. ${optionLabel(q, a.chosen)}` : `${one ? "" : `${q.n}. `}${a.text ?? ""}`;
      return a.chosen && a.text ? `${head} · ${a.text}` : head;
    })
    .filter(Boolean)
    .join("\n");
}

/** "1A 2C 3B": the recommended pick of each question that has one, numbered when there are several. */
export function recommendedLine(qs: Pick<TicketQuestion, "n" | "recommended">[]): string {
  const rec = qs.filter((q) => q.recommended);
  if (qs.length === 1) return rec[0]?.recommended ?? "";
  return rec.map((q) => `${q.n}${q.recommended}`).join(" ");
}

/** "A, B o C". */
export const keysLine = (options: TicketOption[]): string => {
  const keys = options.map((o) => o.key);
  return keys.length > 1 ? `${keys.slice(0, -1).join(", ")} o ${keys.at(-1)}` : (keys[0] ?? "");
};

/** The open questions in thread order: card by card (oldest first), then by step. */
export function openInOrder<Q extends Pick<TicketQuestion, "state" | "createdAt" | "n" | "messageId">>(qs: Q[], messages?: Pick<TicketMessage, "id">[]): Q[] {
  const pos = new Map((messages ?? []).map((m, i) => [m.id, i]));
  return qs
    .filter(isOpen)
    .sort((a, b) => (pos.get(a.messageId) ?? 0) - (pos.get(b.messageId) ?? 0) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) || a.n - b.n);
}
