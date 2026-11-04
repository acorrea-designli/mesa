// Pure helpers for Salidas: version stepper collapse, undo countdown, word diff,
// schedule choices, destination route stops and short labels. Unit tested.
import type { Destination, Salida, SalidaDetail, SalidaVersion } from "@/lib/domain/types";

// ---------- version stepper ----------

export type StepItem = { type: "v"; n: number } | { type: "gap"; from: number; to: number };

/** Collapse when there are more than this many versions. */
export const STEPPER_FULL_MAX = 6;

/**
 * v1 · … · starred · … · last three. The current and the compared version are
 * always visible; a gap that would hide a single version shows it instead.
 */
export function stepperItems(total: number, opts: { current: number; compared?: number | null; starred?: number[] }): StepItem[] {
  if (total <= 0) return [];
  const all = Array.from({ length: total }, (_, i) => i + 1);
  if (total <= STEPPER_FULL_MAX) return all.map((n) => ({ type: "v", n }));
  const show = new Set<number>([1, total, total - 1, total - 2, opts.current, ...(opts.starred ?? [])]);
  if (opts.compared) show.add(opts.compared);
  const vis = all.filter((n) => show.has(n));
  const out: StepItem[] = [];
  let prev = 0;
  for (const n of vis) {
    const hidden = n - prev - 1;
    if (hidden === 1) out.push({ type: "v", n: prev + 1 });
    else if (hidden > 1) out.push({ type: "gap", from: prev + 1, to: n - 1 });
    out.push({ type: "v", n });
    prev = n;
  }
  return out;
}

/** The version the shown one is compared with: the previous, or the latest when you went back. */
export function comparedWith(total: number, current: number): number | null {
  if (total < 2) return null;
  return current === total ? total - 1 : total;
}

// ---------- undo countdown ----------

export const UNDO_SECONDS = 20;

/** Whole seconds left in the undo window (ceil, never negative). */
export function secondsLeft(undoUntil: string | null, now: number): number {
  if (!undoUntil) return 0;
  return Math.max(0, Math.ceil((Date.parse(undoUntil) - now) / 1000));
}

/** Seconds already elapsed of the window, for the travelling tick. */
export function secondsElapsed(undoUntil: string | null, now: number, windowS = UNDO_SECONDS): number {
  if (!undoUntil) return windowS;
  return Math.min(windowS, Math.max(0, windowS - (Date.parse(undoUntil) - now) / 1000));
}

/** Inside the window: Deshacer still works. */
export const undoOpen = (s: Pick<Salida, "status" | "releasedAt" | "undoUntil">, now: number) =>
  s.status === "sending" && !s.releasedAt && secondsLeft(s.undoUntil, now) > 0;

// ---------- word diff ----------

export type DiffOp = { op: "eq" | "del" | "ins"; text: string };

const tokens = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

/** Word-level LCS diff; whitespace tokens are kept so the output rejoins exactly. */
export function wordDiff(a: string, b: string): DiffOp[] {
  const x = tokens(a);
  const y = tokens(b);
  const n = x.length;
  const m = y.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i]![j] = x[i] === y[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: DiffOp[] = [];
  const push = (op: DiffOp["op"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push("eq", x[i++]!);
      j++;
    }
    else if (L[i + 1]![j]! >= L[i]![j + 1]!) push("del", x[i++]!);
    else push("ins", y[j++]!);
  }
  while (i < n) push("del", x[i++]!);
  while (j < m) push("ins", y[j++]!);
  // A whitespace-only change between edits reads as noise: fold it into eq.
  return out.map((o) => (o.op !== "eq" && !o.text.trim() ? { op: "eq", text: o.text } : o));
}

/** Number of changed spans (for "vs v8 · 2 cambios"). */
export const changeCount = (d: DiffOp[]) => d.filter((o, i) => o.op !== "eq" && d[i - 1]?.op === "eq" || (o.op !== "eq" && i === 0)).length;

// ---------- schedule ----------

const WD = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export interface ScheduleChoice {
  label: string;
  at: string; // ISO
}

/** Hoy 16:00 (if still ahead) · tomorrow 9:00 · same weekday next week 9:00. */
export function scheduleChoices(now: Date): ScheduleChoice[] {
  const at = (d: Date, h: number) => {
    const x = new Date(d);
    x.setHours(h, 0, 0, 0);
    return x;
  };
  const out: ScheduleChoice[] = [];
  const today16 = at(now, 16);
  if (today16.getTime() > now.getTime() + 5 * 60_000) out.push({ label: "Hoy 16:00", at: today16.toISOString() });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  out.push({ label: `${WD[tomorrow.getDay()]} 9:00`, at: at(tomorrow, 9).toISOString() });
  const week = new Date(now);
  week.setDate(now.getDate() + 7);
  out.push({ label: `${WD[week.getDay()]} 9:00`, at: at(week, 9).toISOString() });
  return out;
}

// ---------- time labels ----------

export const hhmm = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** "hace 14 min", "hace 2 h", "hace 3 d". */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 14) return `hace ${Math.floor(s / 86400)} d`;
  return `hace ${Math.floor(s / (86400 * 7))} sem`;
}

/** Short age without "hace" (version list, phone). */
export const age = (iso: string, now: number) => ago(iso, now).replace(/^hace /, "");

/** "mar 9:00" when not today, "16:00" today. */
export function whenLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const same = d.toDateString() === now.toDateString();
  const t = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  return same ? `hoy ${t}` : `${WD[d.getDay()]} ${t}`;
}

// ---------- destination ----------

export interface RouteStop {
  label: string;
  value: string;
  note?: string;
}

const isSlack = (d: Destination): d is Extract<Destination, { workspace: string }> => d.kind === "slack_thread" || d.kind === "slack_channel";
const isBasecamp = (d: Destination): d is Extract<Destination, { project: string }> =>
  d.kind === "basecamp_comment" || d.kind === "basecamp_campfire" || d.kind === "basecamp_message";

/** The exact destination drawn as a route of stops in the source colour. */
export function routeStops(d: Destination): RouteStop[] {
  if (isSlack(d)) {
    const stops: RouteStop[] = [
      { label: "Workspace", value: d.workspace },
      { label: "Canal", value: d.channel },
    ];
    if (d.kind === "slack_thread") stops.push({ label: "En el hilo de", value: d.threadLabel ?? d.threadTs ?? "hilo" });
    stops.push({ label: "Publica como", value: `${d.postAs} (tú)` });
    return stops;
  }
  if (isBasecamp(d)) {
    if (d.kind === "basecamp_campfire")
      return [
        { label: "Proyecto", value: d.project },
        { label: "Campfire", value: d.recordingTitle ?? `Campfire · ${d.project}` },
        { label: "Como", value: "Línea de chat, sin hilo", note: d.postAs },
      ];
    return [
      { label: "Proyecto", value: d.project },
      { label: d.kind === "basecamp_message" ? "Message Board" : "Mensaje", value: d.recordingTitle ? `«${d.recordingTitle}»` : (d.recordingId ?? "") },
      { label: "Como", value: d.kind === "basecamp_message" ? "Mensaje nuevo" : "Comentario", note: d.postAs },
    ];
  }
  const stops: RouteStop[] = [
    { label: "Repositorio", value: d.repo },
    { label: "Pull request", value: `#${d.pr}` },
  ];
  if (d.kind === "github_review") {
    const n = d.comments?.length ?? 0;
    const ev = d.event === "APPROVE" ? "Aprobación" : d.event === "REQUEST_CHANGES" ? "Pedir cambios" : "Revisión con comentarios";
    stops.push({ label: "Como", value: n ? `${ev} · ${n} ${n === 1 ? "comentario" : "comentarios"}` : ev });
  } else {
    stops.push({ label: "En", value: d.path ? `${d.path}${d.line ? `:${d.line}` : ""}` : "Conversación del PR" });
  }
  stops.push({ label: "Publica como", value: d.postAs });
  return stops;
}

/** One-line destination for the queue strip and the undo card ("#scout-dev · hilo de Matt"). */
export function destShort(d: Destination): string {
  if (isSlack(d)) return d.kind === "slack_thread" && d.threadLabel ? `${d.channel} · ${d.threadLabel}` : d.channel;
  if (isBasecamp(d)) {
    if (d.kind === "basecamp_campfire") return `${d.project} · Campfire`;
    return d.recordingTitle ? `${d.project} · «${d.recordingTitle}»` : d.project;
  }
  return `${d.repo}#${d.pr}`;
}

export const sourceLabel = (s: Salida["source"]) => (s === "slack" ? "Slack" : s === "basecamp" ? "Basecamp" : "GitHub");

/** The exact text of a version, as it will be sent. GitHub batched reviews carry it in comments. */
export function exactBody(s: Pick<SalidaDetail, "destination">, v: SalidaVersion | undefined): string {
  return v?.body ?? "";
}

export const firstLine = (s: string) => (s.split("\n").find((l) => l.trim()) ?? "").trim();
