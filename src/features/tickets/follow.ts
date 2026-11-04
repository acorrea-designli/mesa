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

export type OnNewMessage = "scroll" | "pill";

/**
 * What to do when a message appears on the open ticket. His own message always scrolls (he just
 * sent it); one from Claude or a teammate scrolls only if he was already at the bottom, otherwise
 * the pill shows and his place in the history is left alone.
 */
export function onNewMessage(m: { own: boolean; wasNearBottom: boolean }): OnNewMessage {
  return m.own || m.wasNearBottom ? "scroll" : "pill";
}
