// Tablero B view model (pure, unit tested): lanes by source, five station columns,
// card chips and wait tags, caps with "+N más", and the GitHub Project sync summary.
import type { StatusTone } from "@/components/ui/primitives";
import { ignoreTarget, type IgnoreTarget } from "../ignore/model";
import { SOURCES, STATIONS, type Item, type Source, type Station, type SyncState, type Task, type TaskOwner, type TicketStatus, type WaitOn } from "@/lib/domain/types";

/** Lane order from the approved mock. */
export const LANES: readonly Source[] = ["github", "basecamp", "slack", "claude"];
export const LANE_NOTE: Record<Source, string> = {
  github: "PRs para ti",
  basecamp: "Clientes y to-dos",
  slack: "Esperan respuesta",
  claude: "Tickets",
};
/** Cards shown per cell before "+N más". */
export const CELL_CAP = 3;

export interface Chip {
  source: Source;
  label: string;
  url: string | null;
}

export interface Card {
  id: string;
  lane: Source;
  station: Station;
  position: number;
  title: string;
  excerpt: string;
  project: string;
  time: string;
  /** Distinct sources of the linked items: two or more draws an interchange. */
  sources: Source[];
  chips: Chip[];
  wait: { tone: StatusTone; label: string } | null;
  syncState: SyncState;
  isSample: boolean;
  /** The project "Ignorar proyecto «X»" would ignore. */
  ignore?: IgnoreTarget | null;
  /** Who works the card's ticket ("tl-t21 · En curso", "Claude · por asignar"); null when only noted. */
  owner?: OwnerChip | null;
}

export interface OwnerChip {
  ticketRef: string;
  label: string;
  href: string;
  /** True while the ticket waits for the lead to claim it and spawn the owner. */
  unassigned: boolean;
  /** The ticket is closed: the card can be handed to Claude again. */
  closed: boolean;
}

const TICKET_STATE: Record<TicketStatus, string> = {
  waiting_claude: "Espera a Claude",
  working: "En curso",
  waiting_andres: "Te espera",
  closed: "Cerrado",
};

/** The owner chip: the live owner agent and the ticket's state, or "Claude · por asignar". */
export function ownerChip(o: TaskOwner | null | undefined): OwnerChip | null {
  if (!o) return null;
  const unassigned = !o.agent && o.ticketStatus !== "closed";
  const label = unassigned ? "Claude · por asignar" : `${o.agent ?? "Claude"} · ${TICKET_STATE[o.ticketStatus]}`;
  return { ticketRef: o.ticketRef, label, href: `/tickets?t=${encodeURIComponent(o.ticketRef)}`, unassigned, closed: o.ticketStatus === "closed" };
}

/** "Dárselo a Claude" applies to any card without an open ticket, except sample data. */
export const canDispatch = (c: Pick<Card, "owner" | "isSample">) => !c.isSample && (!c.owner || c.owner.closed);

type LinkedItem = Pick<Item, "id" | "source" | "title" | "url" | "project"> & { externalId?: string; meta?: Record<string, unknown> };

/** Chip label for a linked item: "PR #212", "Slack #scout-dev", "Basecamp · Freightmate", "Ticket b14". */
export function chipLabel(i: LinkedItem): string {
  if (i.source === "github") {
    const n = i.externalId?.match(/#(\d+)$/)?.[1] ?? i.title.match(/#(\d+)/)?.[1];
    return n ? `PR #${n}` : "GitHub";
  }
  if (i.source === "slack") {
    const ch = typeof i.meta?.channel === "string" ? i.meta.channel : i.project;
    return ch ? `Slack ${ch.startsWith("#") ? ch : `#${ch}`}` : "Slack";
  }
  if (i.source === "basecamp") return i.project ? `Basecamp · ${i.project}` : "Basecamp";
  const ref = typeof i.meta?.ticketRef === "string" ? i.meta.ticketRef : null;
  return ref ? `Ticket ${ref}` : "Claude";
}

/** Wait tag for a card. Only "Te espera" is solid; done cards carry none. */
export function cardWait(waitOn: WaitOn | string, station: Station): Card["wait"] {
  if (station === "done" || waitOn === "none") return null;
  if (waitOn === "you") return { tone: "you", label: "Te espera" };
  if (waitOn === "claude") return { tone: "cl", label: "Espera a Claude" };
  if (waitOn === "client") return { tone: "plain", label: "Espera al cliente" };
  if (waitOn.startsWith("person:")) return { tone: "plain", label: `Espera a ${waitOn.slice(7)}` };
  return null;
}

export function toCard(t: Task, time: string, linked: LinkedItem[] = t.items ?? []): Card {
  const sources = [...new Set([t.source, ...linked.map((i) => i.source)])];
  const seen = new Set<string>();
  const chips: Chip[] = [];
  for (const i of linked) {
    const label = chipLabel(i);
    if (seen.has(label)) continue;
    seen.add(label);
    chips.push({ source: i.source, label, url: i.url });
  }
  // The lane's own chip first, like the mock (PR #212 · Basecamp · Prospec).
  chips.sort((a, b) => Number(b.source === t.source) - Number(a.source === t.source));
  const own = linked.find((i) => i.source === t.source);
  return {
    id: t.id,
    lane: t.source,
    station: t.station,
    position: t.position,
    title: t.title,
    excerpt: t.excerpt,
    project: t.project,
    time,
    sources,
    chips,
    wait: cardWait(t.waitOn, t.station),
    syncState: t.syncState,
    isSample: t.isSample,
    ignore: ignoreTarget({ source: t.source, project: t.project || own?.project || "", projectKey: t.projectKey, meta: own?.meta }),
    owner: ownerChip(t.owner),
  };
}

export type Grid = Record<Source, Record<Station, Card[]>>;

const emptyGrid = (): Grid =>
  Object.fromEntries(SOURCES.map((s) => [s, Object.fromEntries(STATIONS.map((st) => [st, [] as Card[]]))])) as Grid;

/** Cards by lane and station, filtered by source and a search query, ordered by position. */
export function groupBoard(cards: Card[], filter: Source | "all" = "all", query = ""): Grid {
  const q = query.trim().toLowerCase();
  const g = emptyGrid();
  for (const c of cards) {
    if (filter !== "all" && c.lane !== filter) continue;
    if (q && ![c.title, c.project, c.excerpt, ...c.chips.map((x) => x.label)].some((s) => s.toLowerCase().includes(q))) continue;
    g[c.lane][c.station].push(c);
  }
  for (const s of SOURCES) for (const st of STATIONS) g[s][st].sort((a, b) => a.position - b.position);
  return g;
}

/** First `cap` cards and how many more. */
export function capCell<T>(cards: T[], cap = CELL_CAP): { shown: T[]; more: number } {
  return cards.length > cap ? { shown: cards.slice(0, cap), more: cards.length - cap } : { shown: cards, more: 0 };
}

/** A lane with nothing open collapses to one line. */
export const isQuiet = (g: Grid, lane: Source) => STATIONS.every((st) => st === "done" || g[lane][st].length === 0);

export function stationCounts(cards: Card[]): Record<Station, number> {
  const out = Object.fromEntries(STATIONS.map((s) => [s, 0])) as Record<Station, number>;
  for (const c of cards) out[c.station] += 1;
  return out;
}

export function laneCounts(cards: Card[]): Record<Source | "all", number> {
  const out = { all: cards.length, github: 0, slack: 0, basecamp: 0, claude: 0 } as Record<Source | "all", number>;
  for (const c of cards) out[c.lane] += 1;
  return out;
}

export interface SyncSummary {
  state: "synced" | "syncing" | "error" | "empty";
  synced: number;
  total: number;
  pending: number;
  error: string | null;
  /** ISO of the latest successful sync. */
  lastOkAt: string | null;
}

export function syncSummary(tasks: Pick<Task, "syncState" | "syncError" | "syncedAt">[]): SyncSummary {
  const total = tasks.length;
  const synced = tasks.filter((t) => t.syncState === "synced").length;
  const pending = tasks.filter((t) => t.syncState === "pending").length;
  const err = tasks.find((t) => t.syncState === "error");
  const lastOkAt = tasks.map((t) => t.syncedAt).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  return {
    state: !total ? "empty" : err ? "error" : pending ? "syncing" : "synced",
    synced,
    total,
    pending: pending + tasks.filter((t) => t.syncState === "error").length,
    error: err?.syncError ?? null,
    lastOkAt,
  };
}

/** Apply a local move before the server answers (optimistic). */
export function applyMove(cards: Card[], id: string, station: Station): Card[] {
  return cards.map((c) => (c.id === id ? { ...c, station, syncState: "pending" as const, wait: station === "done" ? null : c.wait } : c));
}

// ---------- batch selection ----------

/** Cards in reading order (lane by lane, station by station), the order Shift+click ranges over. */
export function readingOrder(g: Grid, lanes: readonly Source[] = LANES): Card[] {
  return lanes.flatMap((lane) => STATIONS.flatMap((st) => g[lane][st]));
}

/** Shift+click: every card between the anchor and the target in reading order, both included. */
export function rangeIds(order: Pick<Card, "id">[], anchor: string | null, target: string): string[] {
  const to = order.findIndex((c) => c.id === target);
  if (to < 0) return [];
  const from = anchor ? order.findIndex((c) => c.id === anchor) : -1;
  if (from < 0) return [target];
  const [a, b] = from <= to ? [from, to] : [to, from];
  return order.slice(a, b + 1).map((c) => c.id);
}

/** Toggle one id (Ctrl/Cmd+click, the checkbox, a tap in selection mode). */
export function toggleId(sel: ReadonlySet<string>, id: string): Set<string> {
  const n = new Set(sel);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}

/** "Seleccionar carril" / "Seleccionar estación": add them all, or clear them when all are already in. */
export function selectGroup(sel: ReadonlySet<string>, ids: string[]): Set<string> {
  const n = new Set(sel);
  if (ids.length && ids.every((id) => n.has(id))) ids.forEach((id) => n.delete(id));
  else ids.forEach((id) => n.add(id));
  return n;
}

export const laneIds = (g: Grid, lane: Source) => STATIONS.flatMap((st) => g[lane][st].map((c) => c.id));
export const stationIds = (g: Grid, station: Station, lanes: readonly Source[] = LANES) => lanes.flatMap((l) => g[l][station].map((c) => c.id));

/** The distinct projects "Ignorar proyecto" would ignore for a selection. */
export function ignoreTargets(cards: Card[]): IgnoreTarget[] {
  const seen = new Map<string, IgnoreTarget>();
  for (const c of cards) if (c.ignore) seen.set(`${c.ignore.source}:${c.ignore.project}`, c.ignore);
  return [...seen.values()];
}
