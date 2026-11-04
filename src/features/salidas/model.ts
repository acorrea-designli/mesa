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

// ---------- destination link ("Abrir destino") ----------

/** Where Mesa cannot know the host from the destination alone: the Slack domain and the Basecamp account id. */
export interface DestinationConfig {
  /** Slack workspace subdomain: "designli" for designli.slack.com. */
  slackDomain?: string | null;
  /** Basecamp account id, the number in https://3.basecamp.com/<account>/. */
  basecampAccount?: string | null;
}

const SLACK_SUB = /^[a-z0-9][a-z0-9-]*$/i;
const DIGITS = /^\d+$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const SLACK_TS = /^\d+\.\d+$/;

/** "designli", "designli.slack.com" or "https://designli.slack.com/x" -> "designli"; anything else -> null. */
export function slackSubdomain(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().replace(/^https?:\/\//i, "").split("/")[0]!.replace(/\.slack\.com$/i, "");
  return SLACK_SUB.test(v) && !v.includes(".") ? v.toLowerCase() : null;
}

/** Basecamp account id from "1234567" or from a basecamp.com URL ("https://3.basecamp.com/1234567/..."). */
export function basecampAccountId(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (DIGITS.test(v)) return v;
  return /^https:\/\/(?:[a-z0-9]+\.)?basecamp\.com\/(\d+)(?:\/|$)/i.exec(v)?.[1] ?? null;
}

/**
 * Fill the gaps in the config from the origin links of the salida, but only a link to the same place:
 * a Slack /archives/<channelId> link whose channel is the destination's, a Basecamp /buckets/<projectId>/
 * link whose project is the destination's. A link elsewhere says nothing about the workspace or account.
 */
function resolvedConfig(s: Pick<Salida, "links" | "destination">, cfg: DestinationConfig) {
  let slack = slackSubdomain(cfg.slackDomain);
  let basecamp = basecampAccountId(cfg.basecampAccount);
  const d = s.destination;
  for (const l of s.links) {
    if (!l.url) continue;
    if (!slack && l.source === "slack" && (d.kind === "slack_thread" || d.kind === "slack_channel") && d.channelId) {
      const m = /^https:\/\/([a-z0-9-]+)\.slack\.com\/archives\/([A-Z0-9]+)(?:[/?#]|$)/i.exec(l.url);
      if (m && m[2]!.toLowerCase() === d.channelId.toLowerCase()) slack = m[1]!.toLowerCase();
    }
    if (!basecamp && l.source === "basecamp" && (d.kind === "basecamp_comment" || d.kind === "basecamp_message" || d.kind === "basecamp_campfire") && d.projectId) {
      const m = /^https:\/\/(?:[a-z0-9]+\.)?basecamp\.com\/(\d+)\/buckets\/(\d+)(?:[/?#]|$)/i.exec(l.url);
      if (m && m[2] === d.projectId) basecamp = m[1]!;
    }
  }
  return { slack, basecamp };
}

/**
 * The web URL of where a salida is (or was) published, so Andrés can check it. After the send the
 * permalink wins. A missing field gives null: never a guessed URL.
 */
export function destinationUrl(s: Pick<Salida, "destination" | "permalink" | "links">, cfg: DestinationConfig = {}): string | null {
  if (s.permalink && /^https?:\/\//i.test(s.permalink)) return s.permalink;
  const d = s.destination;
  const { slack, basecamp } = resolvedConfig(s, cfg);
  switch (d.kind) {
    case "slack_channel":
    case "slack_thread": {
      if (!slack || !d.channelId || !/^[A-Z0-9]+$/i.test(d.channelId)) return null;
      const base = `https://${slack}.slack.com/archives/${d.channelId}`;
      if (d.kind === "slack_channel") return base;
      return d.threadTs && SLACK_TS.test(d.threadTs) ? `${base}/p${d.threadTs.replace(".", "")}` : null;
    }
    case "basecamp_comment":
    case "basecamp_message":
    case "basecamp_campfire": {
      if (!basecamp || !d.projectId || !d.recordingId || !DIGITS.test(d.projectId) || !DIGITS.test(d.recordingId)) return null;
      const seg = d.kind === "basecamp_campfire" ? "chats" : "recordings";
      return `https://3.basecamp.com/${basecamp}/buckets/${d.projectId}/${seg}/${d.recordingId}`;
    }
    case "github_review":
    case "github_comment": {
      if (!REPO.test(d.repo) || !Number.isInteger(d.pr) || d.pr <= 0) return null;
      const pr = `https://github.com/${d.repo}/pull/${d.pr}`;
      if (d.kind === "github_comment") {
        if (d.inReplyTo && DIGITS.test(d.inReplyTo)) return `${pr}#discussion_r${d.inReplyTo}`;
        if (d.path) return `${pr}/files`;
      }
      return pr;
    }
  }
}

/** Aria label for the "Abrir destino" link: names the place it opens. */
export const destinationLinkLabel = (d: Destination) => `Abrir destino: ${destShort(d)}`;

export const sourceLabel = (s: Salida["source"]) => (s === "slack" ? "Slack" : s === "basecamp" ? "Basecamp" : "GitHub");

/** The exact text of a version, as it will be sent. GitHub batched reviews carry it in comments. */
export function exactBody(s: Pick<SalidaDetail, "destination">, v: SalidaVersion | undefined): string {
  return v?.body ?? "";
}

export const firstLine = (s: string) => (s.split("\n").find((l) => l.trim()) ?? "").trim();
