// Hoy view model: pure mapping from domain rows to what the screen renders.
// Client safe (no server imports); unit tested in model.test.ts.
import type { StatusTone } from "@/components/ui/primitives";
import type { Approval, CalendarEvent, Destination, Item, LineSource, Salida, Source, Station, TicketStatus, WaitOn } from "@/lib/domain/types";
import { eventWhen, parseEventBody } from "@/lib/domain/calendar-event";
import { TICKET_STATUS_LABEL } from "@/lib/domain/ticket-machine";
import { STATION_LABEL } from "@/lib/domain/types";
import { chipOfMeta, type FilesChip } from "@/lib/domain/files";
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
  /** An item's source, or the salida's (a calendar salida is the fifth line). */
  source: LineSource;
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
  /** "imagen" / "adjunto" when the message carries files (meta.files); items only. */
  files?: FilesChip | null;
  /** The project "Ignorar proyecto «X»" would ignore (items only; never salidas). */
  ignore?: IgnoreTarget | null;
  /** What "Saltar" skips and what Deshacer restores; null for done items and samples (items only). */
  skip?: SkipTarget | null;
}

/** "Saltar" on an open item: its id and the station and waitOn Deshacer puts back. */
export interface SkipTarget {
  id: string;
  station: Station;
  waitOn: string;
}

/** Null when Saltar does not apply: the item is already done (or was skipped), or it is sample data. */
export const skipTarget = (i: Pick<Item, "id" | "station" | "waitOn" | "isSample">): SkipTarget | null =>
  i.station === "done" || i.isSample ? null : { id: i.id, station: i.station, waitOn: i.waitOn };

/** The selected rows Saltar applies to (open, non-sample items), each with the station and waitOn Deshacer restores. */
export const skipTargets = (rows: Pick<HoyRow, "kind" | "skip">[]): SkipTarget[] =>
  rows.flatMap((r) => (r.kind === "item" && r.skip ? [r.skip] : []));

/** The one toast after skipping a batch: "Saltados: N salen de Hoy", plus "No se pudieron saltar N" for failures. */
export function skipToast(ok: number, failed: number): string {
  const done = ok === 1 ? "Saltado: sale de Hoy" : `Saltados: ${ok} salen de Hoy`;
  const fail = failed === 1 ? "No se pudo saltar 1" : `No se pudieron saltar ${failed}`;
  if (!ok) return fail;
  return failed ? `${done} · ${fail}` : done;
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
  skip?: SkipTarget | null;
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
  /** The "Próxima reunión" strip (t112): shown once the calendar is connected (or seeded); `next` is null with nothing left this week. */
  calendar: { visible: boolean; next: CalendarEvent | null; nowIso: string };
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

/** Status tag for something waiting. Only "Te espera" is solid. A skipped item in Hecho reads "Saltado". */
export function waitTag(waitOn: WaitOn | string, station: Station, tag?: string | null, skipped?: boolean): Tag {
  if (station === "done") return { tone: "plain", label: skipped ? "Saltado" : "Hecho" };
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
    case "calendar_event":
      return d.invitees?.length ? `Calendario · ${d.invitees.length === 1 ? "1 invitado" : `${d.invitees.length} invitados`}` : "Calendario · solo tú";
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
  const tag = stale && down ? { tone: "off" as const, label: "Sin datos" } : waitTag(i.waitOn, i.station, i.tag, Boolean(i.skippedAt));
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
    files: chipOfMeta(i.meta),
  };
}

/**
 * A row whose item hangs on an open ticket that needs Andrés names the first need in the Necesita column
 * and reads "Te espera" (the one solid tag), whatever the item's own wait says. A ticket that needs nothing
 * from him (his press took his turn) shows its own status tag instead of the item's "Te espera". Other rows
 * pass unchanged.
 */
export function withTicketNeed(row: HoyRow, needs: readonly { label: string }[] | undefined, status?: TicketStatus): HoyRow {
  if (row.kind !== "item" || row.station === "done") return row;
  const first = needs?.[0];
  if (first) {
    const tag: Tag = { tone: "you", label: "Te espera" };
    return { ...row, need: first.label, tag, phoneTag: tag, waitsOnYou: true };
  }
  if (needs && row.waitsOnYou && (status === "waiting_claude" || status === "working")) {
    const tag: Tag = { tone: "cl", label: TICKET_STATUS_LABEL[status] };
    return { ...row, tag, phoneTag: tag, waitsOnYou: false };
  }
  // t126: a paused or ongoing ticket with nothing owed to Andrés is nobody's turn. The row reads its own neutral tag,
  // never "Te espera" and never "Espera a Claude" / "Claude trabaja".
  if (needs && (status === "paused" || status === "ongoing") && (row.waitsOnYou || row.tag.tone === "cl")) {
    const tag: Tag = { tone: "plain", label: TICKET_STATUS_LABEL[status] };
    return { ...row, tag, phoneTag: tag, waitsOnYou: false };
  }
  return row;
}

export function salidaRow(s: Salida, body: string, time: string): HoyRow {
  const quote = firstLine(body);
  // A calendar salida's body is the event, one field per line: the row says what and when, not "Título: …".
  const ev = s.source === "calendar" ? parseEventBody(body) : null;
  return {
    key: `sa:${s.id}`,
    kind: "salida",
    id: s.id,
    station: "inbox",
    source: s.source,
    time,
    subject: ev?.ok ? `Crear evento · ${ev.fields.title}` : `Para ${destinationLabel(s.destination)}`,
    excerpt: ev?.ok ? eventWhen(ev.fields) : quote ? `“${quote}”` : s.title,
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
export function sourceCounts(rows: HoyRow[], station: Station): Record<LineSource | "all", number> {
  const out = { all: 0, github: 0, slack: 0, basecamp: 0, claude: 0, calendar: 0 } as Record<LineSource | "all", number>;
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

/** "1 seleccionado" / "3 seleccionados": the batch bar's count (item rows only; salidas are never selected). */
export const selectedLabel = (n: number) => `${n} ${n === 1 ? "seleccionado" : "seleccionados"}`;
