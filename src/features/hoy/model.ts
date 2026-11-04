// Hoy view model: pure mapping from domain rows to what the screen renders.
// Client safe (no server imports); unit tested in model.test.ts.
import type { StatusTone } from "@/components/ui/primitives";
import type { Approval, Destination, Item, Salida, Source, Station, WaitOn } from "@/lib/domain/types";
import { STATION_LABEL } from "@/lib/domain/types";
import type { SourceHealth } from "@/components/shell/health";
import type { IgnoredRow, IgnoreTarget } from "../ignore/model";

export interface Tag {
  tone: StatusTone;
  label: string;
}

export interface HoyRow {
  key: string;
  kind: "item" | "salida";
  id: string;
  station: Station;
  source: Source;
  time: string;
  subject: string;
  excerpt: string;
  need: string;
  tag: Tag;
  /** Phone tag (shorter copy for salidas: "Firmar"). */
  phoneTag: Tag;
  /** The source is down or paused: the row shows what it last knew. */
  stale: boolean;
  waitsOnYou: boolean;
  taskId: string | null;
  /** The project "Ignorar proyecto «X»" would ignore (items only; never salidas). */
  ignore?: IgnoreTarget | null;
}

export interface ItemDetail {
  id: string;
  source: Source;
  kindLabel: string;
  title: string;
  excerpt: string;
  project: string;
  url: string | null;
  linkLabel: string;
  station: Station;
  taskId: string | null;
  ticketRef: string | null;
  received: string;
  isSample: boolean;
  ignore?: IgnoreTarget | null;
}

export interface HoyApproval extends Approval {
  createdLabel: string;
}

export interface DoneRow {
  id: string;
  source: Source;
  title: string;
  time: string;
}

export interface SetupRow {
  key: "github" | "github_project" | "basecamp" | "slack";
  line: Source;
  name: string;
  detail: string;
  connected: boolean;
}

export interface HoyData {
  dayLong: string; // "martes 3 nov · 10:42"
  dayShort: string; // "mar 3 nov"
  stations: Record<Station, number>;
  rows: HoyRow[];
  details: Record<string, ItemDetail>;
  band: { id: string; source: Source; station: Station; taskId: string | null }[];
  approvals: HoyApproval[];
  /** The ticket the lead's permission prompts are filed to (mesa lead focus), with when it lapses ("14:30"). */
  leadFocus: { ticketRef: string; title: string; until: string } | null;
  health: Partial<Record<Source, SourceHealth>>;
  done: DoneRow[];
  doneToday: number;
  checkedAt: string;
  nextCheckAt: string | null;
  firstRun: boolean;
  setup: SetupRow[];
  hasSample: boolean;
  /** Ignored projects ("N ignorados" on the source tabs). Their items are not in rows or band. */
  ignored: IgnoredRow[];
}

// ---------- labels ----------

const NEED: Record<string, string> = {
  reply: "Respuesta",
  approve_pr: "Aprobar PR",
  decision: "Decisión",
  approve: "Aprobar",
  review: "Revisar",
  read: "Leer",
};
export const needLabel = (need: string) => NEED[need] ?? (need ? need[0]!.toUpperCase() + need.slice(1) : "—");

const KIND: Record<string, string> = {
  pr_review: "Review solicitado",
  request: "Pedido del cliente",
  mention: "Mención",
  message: "Mensaje",
  question: "Claude pregunta",
  todo: "To-do asignado",
};
export const kindLabel = (source: Source, kind: string) =>
  `${{ github: "GitHub", slack: "Slack", basecamp: "Basecamp", claude: "Claude" }[source]} · ${KIND[kind] ?? kind}`;

/** Status tag for something waiting. Only "Te espera" is solid. */
export function waitTag(waitOn: WaitOn | string, station: Station, tag?: string | null): Tag {
  if (station === "done") return { tone: "plain", label: "Hecho" };
  if (tag === "clean") return { tone: "ok", label: "Limpio" };
  if (waitOn === "you") return { tone: "you", label: "Te espera" };
  if (waitOn === "claude") return { tone: "cl", label: "Espera a Claude" };
  if (waitOn === "client") return { tone: "plain", label: "Espera al cliente" };
  if (waitOn.startsWith("person:")) return { tone: "plain", label: `Espera a ${waitOn.slice(7)}` };
  return { tone: "plain", label: STATION_LABEL[station] };
}

/** "prospec-admin #212 · feat: bulk export"; Claude questions read as the question alone. */
export function itemSubject(i: Pick<Item, "source" | "project" | "title">): string {
  if (i.source === "claude" || !i.project) return i.title;
  if (i.title.toLowerCase().startsWith(i.project.toLowerCase())) return i.title;
  return `${i.project} · ${i.title}`;
}

/** Where a salida goes, in one line: "#scout-dev · hilo de Matt". */
export function destinationLabel(d: Destination): string {
  switch (d.kind) {
    case "slack_thread":
      return d.threadLabel ? `${d.channel} · hilo de ${d.threadLabel}` : `${d.channel} · hilo`;
    case "slack_channel":
      return d.channel;
    case "basecamp_comment":
    case "basecamp_message":
      return d.recordingTitle ? `${d.project} · ${d.recordingTitle}` : d.project;
    case "basecamp_campfire":
      return `${d.project} · Campfire`;
    case "github_review":
    case "github_comment":
      return `${d.repo}#${d.pr}`;
  }
}

const firstLine = (s: string) => s.split("\n").find((l) => l.trim())?.trim() ?? "";

/** Link label for an item's own source: "Abrir en GitHub". */
export const openLabel = (s: Source) =>
  s === "claude" ? "Abrir el ticket" : `Abrir en ${{ github: "GitHub", slack: "Slack", basecamp: "Basecamp" }[s]}`;

export const isHealthSource = (s: Source): s is "github" | "slack" | "basecamp" => s !== "claude";

// ---------- rows ----------

export function itemRow(i: Item, time: string, health?: SourceHealth): HoyRow {
  const down = health?.state === "down";
  const stale = Boolean(health && health.state !== "ok") && i.station !== "done";
  const tag = stale && down ? { tone: "off" as const, label: "Sin datos" } : waitTag(i.waitOn, i.station, i.tag);
  return {
    key: `it:${i.id}`,
    kind: "item",
    id: i.id,
    station: i.station,
    source: i.source,
    time,
    subject: itemSubject(i),
    excerpt: stale && health?.rowNote ? health.rowNote : i.excerpt,
    need: needLabel(i.need),
    tag,
    phoneTag: tag,
    stale,
    waitsOnYou: i.waitOn === "you" && i.station !== "done",
    taskId: i.taskId,
  };
}

export function salidaRow(s: Salida, body: string, time: string): HoyRow {
  const quote = firstLine(body);
  return {
    key: `sa:${s.id}`,
    kind: "salida",
    id: s.id,
    station: "inbox",
    source: s.source,
    time,
    subject: `Para ${destinationLabel(s.destination)}`,
    excerpt: quote ? `“${quote}”` : s.title,
    need: "Aprobar",
    tag: { tone: "you", label: "Por enviar" },
    phoneTag: { tone: "you", label: "Firmar" },
    stale: false,
    waitsOnYou: true,
    taskId: null,
  };
}

/** Rows shown for a station and source filter: items first, then the salidas group (Inbox only). */
export function visibleRows(rows: HoyRow[], station: Station, source: Source | "all") {
  const match = (r: HoyRow) => r.station === station && (source === "all" || r.source === source);
  return {
    items: rows.filter((r) => r.kind === "item" && match(r)),
    salidas: station === "inbox" ? rows.filter((r) => r.kind === "salida" && match(r)) : [],
  };
}

/** Source tab counts for a station (items and salidas). */
export function sourceCounts(rows: HoyRow[], station: Station): Record<Source | "all", number> {
  const out = { all: 0, github: 0, slack: 0, basecamp: 0, claude: 0 } as Record<Source | "all", number>;
  for (const r of rows) {
    if (r.station !== station || (r.kind === "salida" && station !== "inbox")) continue;
    out.all += 1;
    out[r.source] += 1;
  }
  return out;
}

/** Nothing waits on Andrés: empty Inbox, no salidas to sign, no permissions. */
export const isCalm = (d: Pick<HoyData, "stations" | "rows" | "approvals">) =>
  d.stations.inbox === 0 && !d.rows.some((r) => r.kind === "salida") && d.approvals.length === 0;
