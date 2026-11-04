// Server read model for Tickets A (list + thread).
import type { Repos } from "@/lib/repo";
import { isSimulated } from "@/lib/domain/sandbox";
import type { Approval, Brief, Handoff, Item, PlannedAction, Review, Salida, TeamAgent, Ticket, TicketDetail } from "@/lib/domain/types";

export type TicketTab = "open" | "you" | "closed";

export interface TicketRow extends Ticket {
  excerpt: string;
  /** A message Andrés has not seen (src/lib/repo/tickets.ts unreadIds): the list shows a "new" flag. */
  unread: boolean;
}

export interface PickTicket {
  ref: string;
  title: string;
  direction: Ticket["direction"];
  status: Ticket["status"];
}

export interface ThreadData {
  ticket: TicketDetail;
  brief: Brief | null;
  team: TeamAgent[];
  handoffs: Handoff[];
  approvals: Approval[];
  reviews: Review[];
  item: Pick<Item, "id" | "source" | "title" | "excerpt" | "url" | "project"> | null;
  salidas: (Pick<Salida, "id" | "status" | "source" | "title"> & { simulated?: boolean })[];
  refTitles: Record<string, string>;
}

export interface TicketsData {
  tab: TicketTab;
  rows: TicketRow[];
  closedToday: TicketRow[];
  counts: { open: number; you: number; closedToday: number };
  selected: ThreadData | null;
  /** The selected ticket has a message Andrés has not seen: opening it marks it seen. */
  selectedUnread: boolean;
  listening: { owner: string; listening: boolean; label: string };
  pick: PickTicket[];
  verbs: string[];
  projects: string[];
  now: string;
  creating: boolean;
}

const DEFAULT_VERBS = ["Cancelar salida", "Mover en el tablero", "Crear tarea", "Revisar PR", "Investigar"];
const VERB_BY_KIND: Record<string, string> = {
  cancel_salida: "Cancelar salida",
  move_card: "Mover en el tablero",
  create_task: "Crear tarea",
  review_pr: "Revisar PR",
  investigate: "Investigar",
  write_client: "Escribir al cliente",
};

function excerpt(t: TicketDetail, now: Date): string {
  const first = t.messages[0];
  const last = t.messages[t.messages.length - 1];
  const opts = first?.options?.length;
  if (t.status === "closed") return last && last.author === "claude" ? `Hecho por Claude · ${clip(last.body, 60)}` : "Cerrado";
  if (t.status === "working") return `Claude trabaja desde las ${hm(t.wokeAt ?? t.updatedAt)}`;
  if (t.status === "waiting_claude" && last?.chosen) return `Respondiste ${last.chosen} · ${hm(last.createdAt)}`;
  if (t.actions.some((a) => a.state === "planned")) return "Claude va a hacer · te pide OK";
  const parts = [t.project];
  if (opts) parts.push(`elige ${first!.options!.map((o) => o.key).join(" o ")}`);
  if (first?.recommended) parts.push(`Claude recomienda ${first.recommended}`);
  if (!opts && first?.body) parts.push(clip(first.body, 70));
  void now;
  return parts.filter(Boolean).join(" · ");
}

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};
const hm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function threadData(r: Repos, idOrRef: string): ThreadData {
  const ticket = r.tickets.detail(idOrRef);
  const approvals = r.approvals.list({ ticket: ticket.id });
  const item = ticket.itemId
    ? (() => {
        try {
          const it = r.items.list().find((x) => x.id === ticket.itemId);
          return it ? { id: it.id, source: it.source, title: it.title, excerpt: it.excerpt, url: it.url, project: it.project } : null;
        } catch {
          return null;
        }
      })()
    : null;
  const refTitles: Record<string, string> = {};
  for (const ref of ticket.refs.filter((x) => x.refType === "ticket")) {
    try {
      refTitles[ref.target] = r.tickets.get(ref.target).title;
    } catch {
      /* the referenced ticket is gone */
    }
  }
  return {
    ticket,
    brief: r.agents.brief(ticket.id),
    team: r.agents.team({ ticket: ticket.id }),
    handoffs: r.agents.handoffs({ ticket: ticket.id, limit: 20 }),
    approvals,
    reviews: r.reviews.list({ ticket: ticket.id }),
    item,
    salidas: r.salidas
      .list()
      .filter((s) => s.ticketId === ticket.id)
      .map((s) => ({ id: s.id, status: s.status, source: s.source, title: s.title, simulated: isSimulated(s) })),
    refTitles,
  };
}

export interface TicketsQuery {
  tab?: string;
  /** ?t=: the ticket Andrés chose. Used as is; a ref that does not exist shows no thread. */
  selected?: string;
  /** ?p=: the ticket the landing view settled on (the client pins it, see TicketsScreen). */
  pinned?: string;
  creating?: boolean;
}

/**
 * Which tickets the thread may show, in order (the first that exists wins). Only the landing
 * view (no ?t=, no ?p=) falls back to the first row: once a ticket is open the view keeps it,
 * so a new ticket or message arriving by live refresh never moves Andrés to another one.
 */
export function selectionOrder(opts: Pick<TicketsQuery, "selected" | "pinned" | "creating">, rows: Pick<Ticket, "ref">[]): string[] {
  if (opts.selected) return [opts.selected];
  if (opts.creating) return [];
  return [opts.pinned, rows[0]?.ref].filter((x): x is string => Boolean(x));
}

export function loadTickets(r: Repos, opts: TicketsQuery, now = new Date()): TicketsData {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const week = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const all = r.tickets.list();
  const details = new Map(all.map((t) => [t.id, r.tickets.detail(t.id)]));
  const unread = r.tickets.unreadIds();
  const row = (t: Ticket): TicketRow => ({ ...t, excerpt: excerpt(details.get(t.id)!, now), unread: unread.has(t.id) });
  const open = all.filter((t) => t.status !== "closed");
  const closedToday = all.filter((t) => t.status === "closed" && (t.closedAt ?? t.updatedAt) >= day.toISOString());
  const tab: TicketTab = opts.tab === "you" || opts.tab === "closed" ? opts.tab : "open";
  const rows = (tab === "you" ? open.filter((t) => t.status === "waiting_andres") : tab === "closed" ? closedToday : open).sort(
    (a, b) => Number(b.status === "waiting_andres") - Number(a.status === "waiting_andres") || b.createdAt.localeCompare(a.createdAt),
  );
  let selected: ThreadData | null = null;
  for (const id of selectionOrder(opts, rows)) {
    try {
      selected = threadData(r, id);
      break;
    } catch {
      selected = null;
    }
  }
  const owner = selected?.ticket.ownerSession ?? process.env.MESA_LEAD_SESSION ?? "lead";
  const session = r.sessions.find(owner);
  const listening = { owner, listening: Boolean(session && r.sessions.isListening(session, now)), label: session?.label || owner };

  const kinds = new Map<string, number>();
  for (const t of all) for (const a of details.get(t.id)!.actions as PlannedAction[]) {
    const v = VERB_BY_KIND[a.kind] ?? a.label.split(" · ")[0]!;
    kinds.set(v, (kinds.get(v) ?? 0) + 1);
  }
  const learned = [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  const verbs = [...new Set([...learned, ...DEFAULT_VERBS])].slice(0, 5);

  const projects = [...new Set([...all.map((t) => t.project), ...r.items.list().map((i) => i.project)].filter(Boolean))].sort();
  const pick = all
    .filter((t) => t.status !== "closed" || t.createdAt >= week || (t.closedAt ?? "") >= week)
    .map((t) => ({ ref: t.ref, title: t.title, direction: t.direction, status: t.status }));

  return {
    tab,
    rows: rows.map(row),
    closedToday: tab === "open" ? closedToday.map(row) : [],
    selectedUnread: Boolean(selected && unread.has(selected.ticket.id)),
    counts: { open: open.length, you: open.filter((t) => t.status === "waiting_andres").length, closedToday: closedToday.length },
    selected,
    listening,
    pick,
    verbs,
    projects,
    now: now.toISOString(),
    creating: Boolean(opts.creating),
  };
}
