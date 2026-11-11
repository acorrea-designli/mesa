// Reads what waits on Andrés from the existing GETs (the stream frames carry no state).
import { remindersDue } from "@/lib/domain/calendar";
import type { Approval, CalendarPayload, Item, Review, Salida, SalidaDetail, Ticket } from "@/lib/domain/types";
import { addDays, localDay } from "@/lib/domain/week";
import { approvalWaiting, itemWaiting, meetingWaiting, salidaKey, salidaWaiting, ticketKey, ticketWaiting, type Seen, type Waiting } from "./decide";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return (await r.json()) as T;
}

/** The ticket's open review card, for the "Review lista" label. A failed read just means the plain label. */
async function openReview(ticketId: string): Promise<{ repo: string; pr: number } | null> {
  try {
    const { reviews } = await getJson<{ reviews: Review[] }>(`/api/reviews?ticket=${encodeURIComponent(ticketId)}`);
    const r = reviews.find((x) => x.state === "open");
    return r ? { repo: r.repo, pr: r.pr } : null;
  } catch {
    return null;
  }
}

/** True when the salida's current version is one Andrés wrote by hand ("tu versión"): his own doing. */
async function wroteByHand(s: Salida): Promise<boolean> {
  try {
    const d = await getJson<SalidaDetail>(`/api/salidas/${encodeURIComponent(s.id)}`);
    return d.versions.find((v) => v.n === d.currentVersion)?.author === "andres";
  } catch {
    return false;
  }
}

/**
 * Meetings that start within ten minutes (t112). A calendar that cannot be read is no reminders, never a failed scan:
 * the rest of the waiting set must still be read. Today and tomorrow cover a meeting just after midnight.
 */
async function dueMeetings(now: Date): Promise<Waiting[]> {
  try {
    const today = localDay(now);
    const { events } = await getJson<CalendarPayload>(`/api/calendar?from=${today}&to=${addDays(today, 2)}`);
    return remindersDue(events, now).map((e) => meetingWaiting(e, now));
  } catch {
    return [];
  }
}

/**
 * The whole waiting set. Throws when a list cannot be read (the caller skips that scan, so a
 * blip never looks like "everything left"). Labels and the own-version check cost one request
 * each and only run for keys not in `seen`; pass `seen = null` for a baseline read, which needs none.
 */
export async function fetchWaiting(seen: Seen | null): Promise<Waiting[]> {
  const [tickets, salidas, approvals, items] = await Promise.all([
    getJson<Ticket[]>("/api/tickets?status=waiting_andres"),
    getJson<Salida[]>("/api/salidas?status=pending"),
    getJson<{ approvals: Approval[] }>("/api/approvals?status=pending").then((r) => r.approvals),
    // Hoy: open and waiting on Andrés, samples and ignored projects already left out by the server.
    getJson<Item[]>("/api/items?open=you"),
  ]);
  const fresh = (key: string) => seen !== null && !(key in seen);
  const out = await Promise.all([
    ...tickets.map(async (t) => ticketWaiting(t, t.isSample || !fresh(ticketKey(t)) ? null : await openReview(t.id))),
    ...salidas.map(async (s) => salidaWaiting(s, !s.isSample && fresh(salidaKey(s)) ? await wroteByHand(s) : false)),
    ...approvals.map(async (a) => approvalWaiting(a)),
    ...items.map(async (i) => itemWaiting(i)),
  ]);
  return [...out, ...(await dueMeetings(new Date()))];
}
