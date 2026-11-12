// Server read model for Tickets A (list + thread).
import type { Repos } from "@/lib/repo";
import { isSimulated } from "@/lib/domain/sandbox";
import { needLine, needRank, type TicketNeed } from "@/lib/domain/ticket-needs";
import { related, type RelItem, type RelTicket, type Related } from "@/lib/domain/related";
import { loadTicketNeeds } from "./needs";
import type { Approval, Brief, Handoff, Item, PdfDocument, PlannedAction, Review, Salida, TeamAgent, Ticket, TicketDetail } from "@/lib/domain/types";

export type TicketTab = "open" | "you" | "paused" | "closed" | "docs";

export interface TicketRow extends Ticket {
  excerpt: string;
  /** What he must do here, first the one the list names (ticket-needs.ts); empty when nothing waits on him. */
  needs: TicketNeed[];
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
  item: Pick<Item, "id" | "source" | "title" | "excerpt" | "url" | "project" | "meta"> | null;
  salidas: (Pick<Salida, "id" | "status" | "source" | "title"> & { simulated?: boolean })[];
  refTitles: Record<string, string>;
  /** Refs of every ticket that exists: only these become links in the thread text. */
  knownRefs: string[];
  /** "Relacionado": what Mesa detects around this ticket (src/lib/domain/related.ts). Empty: no block. */
  related: Related[];
}

export interface TicketsData {
  tab: TicketTab;
  rows: TicketRow[];
  closedToday: TicketRow[];
  /** Tickets · Documentos (t135): every PDF attachment, newest first. Only loaded on that tab. */
  docs: PdfDocument[];
  counts: { open: number; you: number; closedToday: number; paused: number; docs: number };
  selected: ThreadData | null;
  /** The selected ticket has a message Andrés has not seen: opening it marks it seen. */
  selectedUnread: boolean;
  /**
   * Unread tickets that some tab shows (open plus closed today), whatever the current tab: "Marcar todo
   * como leído" shows while it is above 0, so it never appears when no row is flagged.
   */
  unreadCount: number;
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
  // the plan catalogue of .claude/skills/mesa-ticket/SKILL.md
  branch_pr: "Abrir PR",
  merge_pr: "Mergear PR",
  send_message: "Enviar mensaje",
  cancel_message: "Cancelar mensaje",
  apply_infra: "Aplicar infra",
  post_github: "Publicar en GitHub",
};

function excerpt(t: TicketDetail, needs: TicketNeed[], now: Date): string {
  const line = needLine(needs);
  if (line) return line.lead + line.rest;
  const first = t.messages[0];
  const last = t.messages[t.messages.length - 1];
  const asked = first ? t.questions.filter((q) => q.messageId === first.id) : [];
  const opts = asked.length === 1 ? asked[0]!.options : null;
  if (t.status === "closed") return last && last.author === "claude" ? `Hecho por Claude · ${clip(last.body, 60)}` : "Cerrado";
  if (t.status === "working") return `Claude trabaja desde las ${hm(t.wokeAt ?? t.updatedAt)}`;
  // "En pausa" and "En proceso" read their reason (the dependency link lives in the thread header, a row is one link).
  if (t.status === "paused") return [t.pauseReason, t.pausedUntil ? `hasta ${t.pausedUntil}` : ""].filter(Boolean).join(" · ") || "En pausa";
  if (t.status === "ongoing") return t.pauseReason || "En proceso";
  if (t.status === "waiting_claude" && last?.chosen) return `Respondiste ${last.chosen} · ${hm(last.createdAt)}`;
  if (t.actions.some((a) => a.state === "planned")) return "Claude va a hacer · te pide OK";
  const parts = [t.project];
  if (opts) parts.push(`elige ${opts.map((o) => o.key).join(" o ")}`);
  if (opts && asked[0]!.recommended) parts.push(`Claude recomienda ${asked[0]!.recommended}`);
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

const RELATED_DAYS = 7;

const relTicket = (r: Repos, t: Ticket, reviews: Map<string, { repo: string; pr: number }[]>): RelTicket => {
  const d = r.tickets.detail(t.id);
  return {
    id: d.id,
    ref: d.ref,
    title: d.title,
    itemId: d.itemId,
    texts: [
      ...d.messages.map((m) => m.body),
      ...d.questions.flatMap((q) => [q.text, q.recommendation ?? "", ...q.options.flatMap((o) => [o.label, o.detail ?? ""])]),
    ],
    refUrls: d.refs.filter((x) => x.refType === "url").map((x) => x.target),
    reviews: reviews.get(d.id) ?? [],
  };
};

/**
 * The "Relacionado" block. Candidates are bounded so opening a thread stays cheap: tickets still open or
 * touched in the last week, items not done or touched in the last week, plus the items on the ticket's card.
 */
function relatedFor(r: Repos, ticket: TicketDetail, item: ThreadData["item"], now: Date): Related[] {
  const since = new Date(now.getTime() - RELATED_DAYS * 86400_000).toISOString();
  const reviews = new Map<string, { repo: string; pr: number }[]>();
  for (const rv of r.reviews.list()) if (rv.ticketId) reviews.set(rv.ticketId, [...(reviews.get(rv.ticketId) ?? []), { repo: rv.repo, pr: rv.pr }]);
  const items: RelItem[] = r.items
    .list()
    .filter((i) => i.station !== "done" || i.updatedAt >= since || (ticket.taskId !== null && i.taskId === ticket.taskId))
    .map((i) => ({ id: i.id, source: i.source, title: i.title, excerpt: i.excerpt, url: i.url, taskId: i.taskId, meta: i.meta }));
  const tickets = r.tickets
    .list()
    .filter((t) => t.id !== ticket.id && (t.status !== "closed" || (t.closedAt ?? t.updatedAt) >= since))
    .map((t) => relTicket(r, t, reviews));
  const own = relTicket(r, ticket, reviews);
  // What "Fuente" shows (Thread.tsx Sources): the item's address and the refs of the first message.
  const first = ticket.messages[0];
  const fuente = ticket.refs.filter((x) => !x.messageId || x.messageId === first?.id);
  return related({
    ticket: { ...own, taskId: ticket.taskId },
    item: item ? (items.find((i) => i.id === item.id) ?? { id: item.id, source: item.source, title: item.title, excerpt: item.excerpt, url: item.url, taskId: null, meta: item.meta }) : null,
    items,
    tickets,
    shown: {
      urls: [...(item?.url ? [item.url] : []), ...fuente.filter((x) => x.refType === "url").map((x) => x.target)],
      tickets: fuente.filter((x) => x.refType === "ticket").map((x) => x.target),
    },
  });
}

export function threadData(r: Repos, idOrRef: string, now = new Date()): ThreadData {
  const ticket = r.tickets.detail(idOrRef);
  const approvals = r.approvals.list({ ticket: ticket.id });
  const item = ticket.itemId
    ? (() => {
        try {
          const it = r.items.list().find((x) => x.id === ticket.itemId);
          return it ? { id: it.id, source: it.source, title: it.title, excerpt: it.excerpt, url: it.url, project: it.project, meta: it.meta } : null;
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
    knownRefs: r.tickets.list().map((t) => t.ref),
    related: relatedFor(r, ticket, item, now),
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
  const needs = loadTicketNeeds(r, [...details.values()], now);
  const needsOf = (t: Ticket) => needs.get(t.id) ?? [];
  const row = (t: Ticket): TicketRow => ({ ...t, excerpt: excerpt(details.get(t.id)!, needsOf(t), now), needs: needsOf(t), unread: unread.has(t.id) });
  const open = all.filter((t) => t.status !== "closed");
  const waitsOnYou = open.filter((t) => needsOf(t).length > 0);
  const closedToday = all.filter((t) => t.status === "closed" && (t.closedAt ?? t.updatedAt) >= day.toISOString());
  const idle = open.filter((t) => t.status === "paused" || t.status === "ongoing");
  const tab: TicketTab = opts.tab === "you" || opts.tab === "closed" || opts.tab === "paused" || opts.tab === "docs" ? opts.tab : "open";
  const documents = r.annotations.documents();
  // Tickets with a need first (by the priority of the first need, then the one waiting longest), then the rest, newest first.
  const rows = (tab === "docs" ? ([] as Ticket[]) : tab === "you" ? waitsOnYou : tab === "closed" ? closedToday : tab === "paused" ? idle : open).sort((a, b) => {
    const [ra, rb] = [needRank(needsOf(a)), needRank(needsOf(b))];
    if (ra !== rb) return ra - rb; // Infinity - Infinity is NaN: equal ranks are handled above
    return ra === Infinity ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt);
  });
  let selected: ThreadData | null = null;
  // Documentos has no thread pane: every row opens the review view.
  for (const id of tab === "docs" ? [] : selectionOrder(opts, rows)) {
    try {
      selected = threadData(r, id, now);
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
    const v = Object.hasOwn(VERB_BY_KIND, a.kind) ? VERB_BY_KIND[a.kind] : undefined;
    if (v) kinds.set(v, (kinds.get(v) ?? 0) + 1); // an unknown kind adds no chip: never a plan-step label
  }
  const learned = [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  const verbs = [...new Set([...learned, ...DEFAULT_VERBS])].slice(0, 5);

  // Slack items carry a channel or a person (DM) as project, and a ticket made from one inherits it:
  // neither is a scope for engram, so they never reach the Proyecto suggestions.
  const items = r.items.list();
  const slackItems = new Set(items.filter((i) => i.source === "slack").map((i) => i.id));
  const slack = new Set([
    ...items.filter((i) => i.source === "slack").map((i) => i.project),
    ...all.filter((t) => t.itemId && slackItems.has(t.itemId)).map((t) => t.project),
  ]);
  const projects = [...new Set([...all.map((t) => t.project), ...items.map((i) => i.project)].filter((p) => p && !slack.has(p)))].sort();
  const pick = all
    .filter((t) => t.status !== "closed" || t.createdAt >= week || (t.closedAt ?? "") >= week)
    .map((t) => ({ ref: t.ref, title: t.title, direction: t.direction, status: t.status }));

  return {
    tab,
    rows: rows.map(row),
    docs: tab === "docs" ? documents : [],
    closedToday: tab === "open" ? closedToday.map(row) : [],
    selectedUnread: Boolean(selected && unread.has(selected.ticket.id)),
    unreadCount: [...open, ...closedToday].filter((t) => unread.has(t.id)).length,
    counts: { open: open.length, you: waitsOnYou.length, closedToday: closedToday.length, paused: idle.length, docs: documents.length },
    selected,
    listening,
    pick,
    verbs,
    projects,
    now: now.toISOString(),
    creating: Boolean(opts.creating),
  };
}
