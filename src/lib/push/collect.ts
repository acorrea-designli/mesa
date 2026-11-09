// The waiting set, read straight from the repositories (the server twin of src/features/notify/collect.ts).
// It reuses the desktop entry builders (keys, sample and own flags) and swaps the display text for the minimal
// push labels: kind + ref, never titles.
import {
  approvalWaiting,
  itemWaiting,
  salidaKey,
  salidaWaiting,
  ticketKey,
  ticketWaiting,
  type Seen,
  type Waiting,
} from "@/features/notify/decide";
import type { Repos } from "../repo";
import { approvalTitle, salidaTitle, ticketTitle } from "./payload";

/** Push carries no body: the entry's `body` is unused. */
const NO_BODY = "";

/**
 * The whole waiting set. Costlier lookups (the open review, the own-version check) only run for keys not in `seen`;
 * pass `seen = null` for a baseline read, which needs none.
 */
export function collectWaiting(r: Pick<Repos, "tickets" | "salidas" | "approvals" | "reviews" | "items">, seen: Seen | null, now = new Date()): Waiting[] {
  const fresh = (key: string) => seen !== null && !(key in seen);
  const out: Waiting[] = [];

  for (const t of r.tickets.list({ status: "waiting_andres" })) {
    const review = !t.isSample && fresh(ticketKey(t)) ? r.reviews.list({ ticket: t.id }).find((x) => x.state === "open") : undefined;
    out.push({ ...ticketWaiting(t, null), title: ticketTitle(t.ref, Boolean(review)), body: NO_BODY });
  }

  for (const s of r.salidas.list({ status: ["pending"] })) {
    const own = !s.isSample && fresh(salidaKey(s)) ? r.salidas.detail(s.id).versions.find((v) => v.n === s.currentVersion)?.author === "andres" : false;
    let ref: string | null = null;
    if (s.ticketId) {
      try {
        ref = r.tickets.get(s.ticketId).ref;
      } catch {
        ref = null;
      }
    }
    out.push({ ...salidaWaiting(s, own), title: salidaTitle(ref), body: NO_BODY });
  }

  for (const a of r.approvals.list({ status: "pending" }, now)) {
    out.push({ ...approvalWaiting(a), title: approvalTitle(a.agent), body: NO_BODY });
  }

  // Hoy (t63): "Nuevo en Hoy · <Source>" is already source-only; the item's title never leaves the PC.
  for (const i of r.items.list({ open: "you", includeSamples: false, ignored: "exclude" })) {
    out.push({ ...itemWaiting(i), body: NO_BODY });
  }
  return out;
}
