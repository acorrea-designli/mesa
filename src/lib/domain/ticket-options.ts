// Options (A/B choices) in a ticket thread. Any message can carry options (an ask or a reply that
// keeps them); Andrés answers with a message of his own whose `chosen` is the key. Pure: used by the
// thread UI and by the repo, which maps a typed "A" to chosen.
import type { TicketMessage, TicketOption } from "./types";

type Msg = Pick<TicketMessage, "id" | "author" | "options" | "chosen">;

export interface OptionState {
  /** The latest options message with no answer from Andrés yet: the only one with live buttons. */
  actionable: boolean;
  /** The key he picked (on his first message after this one), or null if none or he answered in words. */
  chosen: string | null;
  /** He has said something since: the buttons are read-only. */
  answered: boolean;
}

/**
 * State of every message that has options, by message id. A message is answered once Andrés wrote
 * after it; only the latest options message that is not answered is actionable.
 */
export function optionStates(messages: Msg[]): Map<string, OptionState> {
  const out = new Map<string, OptionState>();
  let latestOpen: string | null = null;
  messages.forEach((m, i) => {
    if (!m.options?.length) return;
    const reply = messages.slice(i + 1).find((x) => x.author === "andres");
    out.set(m.id, { actionable: false, chosen: reply?.chosen ?? null, answered: Boolean(reply) });
    if (!reply) latestOpen = m.id;
  });
  if (latestOpen) out.get(latestOpen)!.actionable = true;
  return out;
}

/** The text a click on option `key` of `m` sends when the composer is empty: "A. Sí, primera mejora". */
export function optionText(m: Pick<TicketMessage, "options"> | undefined, key: string): string {
  const o = m?.options?.find((x) => x.key === key);
  return o ? `${key}. ${o.label}` : key;
}

/**
 * A reply that is just an option key ("A", "b.", " B ", "A)") picks that option: the key of
 * `options` it names, case-insensitive, or null for anything longer or unrelated.
 */
export function matchOptionKey(text: string, options: TicketOption[] | null | undefined): string | null {
  if (!options?.length) return null;
  const word = text.trim().replace(/[\s.,;:!)\]]+$/, "").toLowerCase();
  if (!word) return null;
  return options.find((o) => o.key.toLowerCase() === word)?.key ?? null;
}

/** The options a typed reply would answer: the latest options message that Andrés has not answered. */
export function openOptions(messages: Msg[]): TicketOption[] | null {
  const states = optionStates(messages);
  const open = messages.find((m) => states.get(m.id)?.actionable);
  return open?.options ?? null;
}
