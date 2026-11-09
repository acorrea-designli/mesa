// Server side of ticket-needs: load what the derivation reads once, group it by ticket, derive.
import { ticketNeeds, type TicketNeed } from "@/lib/domain/ticket-needs";
import type { Repos } from "@/lib/repo";
import type { TicketDetail } from "@/lib/domain/types";

/** The needs of each given ticket, by ticket id. Approvals, salidas and reviews are read once, not per ticket. */
export function loadTicketNeeds(r: Repos, details: TicketDetail[], now: Date): Map<string, TicketNeed[]> {
  const open = details.filter((t) => t.status !== "closed");
  const out = new Map<string, TicketNeed[]>(details.map((t) => [t.id, []]));
  if (!open.length) return out;
  const group = <T extends { ticketId: string | null }>(rows: T[]) => {
    const by = new Map<string, T[]>();
    for (const x of rows) if (x.ticketId) by.set(x.ticketId, [...(by.get(x.ticketId) ?? []), x]);
    return by;
  };
  const approvals = group(r.approvals.list({ status: "pending" }, now));
  const salidas = group(r.salidas.list({ status: ["pending"] }));
  const reviews = group(r.reviews.list());
  for (const t of open) {
    out.set(
      t.id,
      ticketNeeds(
        {
          status: t.status,
          messages: t.messages,
          actions: t.actions,
          approvals: approvals.get(t.id) ?? [],
          reviews: reviews.get(t.id) ?? [],
          salidas: salidas.get(t.id) ?? [],
        },
        now,
      ),
    );
  }
  return out;
}
