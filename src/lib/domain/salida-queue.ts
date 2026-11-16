// t204: which salidas the Salidas queue strip shows and which are history (pure; the SQL in repo/salidas.ts uses the same constants).
import type { Salida, SalidaStatus } from "./types";

/** Awaiting Andrés's signature or in progress: these stay in the strip whatever their date. */
export const QUEUE_STAY: readonly SalidaStatus[] = ["pending", "scheduled", "queued_until_back", "sending"];

/** `draft` is a salida Claude has not proposed yet: it is in neither the strip nor the history. */
export const NOT_LISTED: readonly SalidaStatus[] = ["draft"];

/** Start of the local day of `now` (server local time), as the ISO string the columns hold. */
export function dayStart(now: Date): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * The day rule. In the strip: every salida in {@link QUEUE_STAY} whatever its date, plus any other status (failed and
 * draft_created included) created or updated since `day`. Everything else is history.
 */
export function inQueue(s: Pick<Salida, "status" | "createdAt" | "updatedAt">, day: string): boolean {
  if (NOT_LISTED.includes(s.status)) return false;
  return QUEUE_STAY.includes(s.status) || s.createdAt >= day || s.updatedAt >= day;
}

/** Opaque cursor of the history list: where the last row of the previous page was. */
export interface HistoryCursor {
  updatedAt: string;
  id: string;
}

export const encodeCursor = (c: HistoryCursor) => `${c.updatedAt}|${c.id}`;

export function decodeCursor(raw: string | null | undefined): HistoryCursor | null {
  if (!raw) return null;
  const i = raw.indexOf("|");
  if (i < 1 || i === raw.length - 1) return null;
  return { updatedAt: raw.slice(0, i), id: raw.slice(i + 1) };
}

/** One line of the Historial list: what the row shows, nothing the card needs (no versions, no ticket history). */
export type SalidaHistoryRow = Pick<
  Salida,
  "id" | "source" | "status" | "destination" | "permalink" | "sentAt" | "expiresAt" | "sendAt" | "createdAt" | "updatedAt" | "isSample"
> & {
  /** The current version's text, cut to the first 400 characters. */
  body: string;
  /** Ref of the ticket the salida came from (`t204`), or null. */
  ticketRef: string | null;
};

export const HISTORY_PAGE = 50;
export const HISTORY_MAX = 500;
