// Reads what waits on Andrés from the existing GETs (the stream frames carry no state).
import type { Approval, Review, Salida, SalidaDetail, Ticket } from "@/lib/domain/types";
import { approvalWaiting, salidaKey, salidaWaiting, ticketKey, ticketWaiting, type Seen, type Waiting } from "./decide";

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
 * The whole waiting set. Throws when a list cannot be read (the caller skips that scan, so a
 * blip never looks like "everything left"). Labels and the own-version check cost one request
 * each and only run for keys not in `seen`; pass `seen = null` for a baseline read, which needs none.
 */
export async function fetchWaiting(seen: Seen | null): Promise<Waiting[]> {
  const [tickets, salidas, approvals] = await Promise.all([
    getJson<Ticket[]>("/api/tickets?status=waiting_andres"),
    getJson<Salida[]>("/api/salidas?status=pending"),
    getJson<{ approvals: Approval[] }>("/api/approvals?status=pending").then((r) => r.approvals),
  ]);
  const fresh = (key: string) => seen !== null && !(key in seen);
  const out = await Promise.all([
    ...tickets.map(async (t) => ticketWaiting(t, t.isSample || !fresh(ticketKey(t)) ? null : await openReview(t.id))),
    ...salidas.map(async (s) => salidaWaiting(s, !s.isSample && fresh(salidaKey(s)) ? await wroteByHand(s) : false)),
    ...approvals.map(async (a) => approvalWaiting(a)),
  ]);
  return out;
}
