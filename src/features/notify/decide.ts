// Browser notifications from the Mesa tab (t25). Pure: no DOM, no IO.
//
// The notifier reads what waits on Andrés (tickets in "Te espera", salidas to sign, pending
// permission approvals), turns each row into a `Waiting` entry with a dedupe key, and asks
// `decide()` which of them are new. `seen` is the set of keys already handled; it lives in
// localStorage so every tab and every reload shares it.
//
// Keys, one per waiting episode:
//   ticket:<id>            the episode is the stay in waiting_andres: the key is dropped from `seen`
//                          when the ticket leaves the waiting set, so a new question notifies again
//   salida:<id>:v<n>       a new version is a new thing to sign; going back to pending at the same
//                          version (undo, unqueue, unschedule) is not
//   approval:<id>          an approval is pending once
//   item:<id>              a Hoy item (t63) is episodic like a ticket: the episode is the stay open and waiting
//                          on Andrés (station not done, waitOn you); when it leaves that set the key is dropped,
//                          so an item that comes back (a PR review re-requested) notifies again, while a sweeper
//                          refresh of an item that never left does not
//   meeting:<id>:<start>   a meeting reminder (t112): once per event start (a moved meeting is a new key). Meetings are the
//                          one kind that ignores the quiet rule and the baseline: a meeting in ten minutes is news even
//                          while a Mesa tab is focused, and it carries the meeting's title (the t33 "no titles" rule is
//                          kept for every other entry)
import { clockOf, meetingKey } from "@/lib/domain/calendar";
import { SOURCE_LABEL, SOURCES, type Approval, type CalendarEvent, type Item, type Salida, type Source, type Ticket } from "@/lib/domain/types";
import { localDay } from "@/lib/domain/week";
import { destShort } from "@/features/salidas/model";

export type WaitingKind = "ticket" | "salida" | "approval" | "item" | "meeting";

export interface Waiting {
  key: string;
  kind: WaitingKind;
  title: string;
  body: string;
  /** Where a click goes (same-origin path). */
  url: string;
  /** Sample data ("Datos de muestra."): never notifies and is never remembered. */
  sample?: boolean;
  /** His own doing (a version he wrote): remembered, never shown. */
  own?: boolean;
  /** Only on Hoy items: where it came from. */
  source?: Source;
  /** A meeting reminder: shown even while Mesa is being looked at, and even on a baseline scan. */
  meeting?: true;
}

export interface Shown {
  key: string;
  title: string;
  body: string;
  url: string;
  /** Set on what arrived in Hoy (an item, or the batch of several): it gets the Hoy sound. */
  hoy?: true;
  /** Only on a single Hoy item. */
  source?: Source;
  /** A meeting reminder: its body is the meeting's title (the one place a title travels), its url the Meet link or the event in Mesa. */
  meeting?: true;
}

/** key -> last time it was seen waiting (epoch ms). */
export type Seen = Record<string, number>;

/** Keys of tickets are forgotten when the ticket stops waiting; the others age out. */
export const SEEN_TTL_MS = 14 * 24 * 3600_000;
export const SEEN_MAX = 300;

const isEpisodic = (key: string) => key.startsWith("ticket:") || key.startsWith("item:");

/** Marker in `seen`: Hoy items have been read once. Without it the first read of items is a silent baseline. */
export const HOY_READY = "hoy:ready";
/** Tag and key of the one banner (and push) that stands for Hoy arrivals. */
export const HOY_TAG = "mesa-hoy";

/** A scan by any tab this recent means the browser was watching: the first scan of a new load is a normal one. */
export const LAST_SCAN_FRESH_MS = 10 * 60_000;

/**
 * Should the first scan of a tab be a silent baseline? `lastScan` is the time (epoch ms) of the
 * last successful scan by any tab, or null when there is no record. A recent one means a reload
 * or a restart (what entered waiting meanwhile is news); an older or missing one means a first
 * enable or a long-closed browser (what waits is not news).
 */
export function shouldBaseline(lastScan: number | null, now: number): boolean {
  if (lastScan === null || !Number.isFinite(lastScan)) return true;
  return now - lastScan > LAST_SCAN_FRESH_MS;
}

// ---------- entries ----------

export const ticketKey = (t: Pick<Ticket, "id">) => `ticket:${t.id}`;
export const salidaKey = (s: Pick<Salida, "id" | "currentVersion">) => `salida:${s.id}:v${s.currentVersion}`;
export const approvalKey = (a: Pick<Approval, "id">) => `approval:${a.id}`;
export const itemKey = (i: Pick<Item, "id">) => `item:${i.id}`;

/** An item that is open and waits on Andrés ("Nuevo en Hoy · GitHub"). The collector only lists open ones. */
export function itemWaiting(i: Pick<Item, "id" | "source" | "title" | "isSample">): Waiting {
  return {
    key: itemKey(i),
    kind: "item",
    title: `Nuevo en Hoy · ${SOURCE_LABEL[i.source]}`,
    body: i.title,
    url: "/",
    sample: i.isSample,
    source: i.source,
  };
}

/** A ticket in waiting_andres. `review` is its open review card, when it has one ("Review lista"). */
export function ticketWaiting(
  t: Pick<Ticket, "id" | "ref" | "title" | "isSample">,
  review?: { repo: string; pr: number } | null,
): Waiting {
  return {
    key: ticketKey(t),
    kind: "ticket",
    title: review ? `Review lista · ${review.repo}#${review.pr}` : `Te espera · ${t.ref}`,
    body: t.title,
    url: `/tickets?t=${encodeURIComponent(t.ref)}`,
    sample: t.isSample,
  };
}

/** A pending salida. `own` = the current version is one Andrés wrote himself. */
export function salidaWaiting(s: Pick<Salida, "id" | "title" | "destination" | "currentVersion" | "isSample">, own = false): Waiting {
  return {
    key: salidaKey(s),
    kind: "salida",
    title: `Por firmar · ${s.title}`,
    body: destShort(s.destination),
    url: `/salidas?s=${encodeURIComponent(s.id)}`,
    sample: s.isSample,
    own,
  };
}

/** A pending permission approval: opens its ticket, or Hoy when it has none. */
export function approvalWaiting(a: Pick<Approval, "id" | "agent" | "summary" | "ticketRef" | "isSample">): Waiting {
  return {
    key: approvalKey(a),
    kind: "approval",
    title: `Permiso pendiente · ${a.agent}`,
    body: a.summary,
    url: a.ticketRef ? `/tickets?t=${encodeURIComponent(a.ticketRef)}` : "/",
    sample: a.isSample,
  };
}

/** Google Meet is the only conference link that leaves Mesa from a notification; any other opens the event in Mesa. */
export function meetLink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "meet.google.com" && u.pathname.length > 1 ? url : null;
  } catch {
    return null;
  }
}

/** A meeting that starts within ten minutes. Title "Reunión en 10 min · 15:00", body the meeting's title (6C), a tap opens the Meet or the event. */
export function meetingWaiting(e: Pick<CalendarEvent, "id" | "title" | "startsAt" | "meetUrl" | "isSample">, now: Date): Waiting {
  const min = Math.max(1, Math.ceil((Date.parse(e.startsAt) - now.getTime()) / 60_000));
  return {
    key: meetingKey(e),
    kind: "meeting",
    title: `Reunión en ${min} min · ${clockOf(e.startsAt)}`,
    body: e.title,
    url: meetLink(e.meetUrl) ?? `/calendario?dia=${localDay(new Date(e.startsAt))}`,
    sample: e.isSample,
    meeting: true,
  };
}

// ---------- decision ----------

/** Keys in `waiting` that `seen` does not know yet (what the collector enriches before deciding). */
export function newKeys(seen: Seen, waiting: Waiting[]): string[] {
  return waiting.filter((w) => !w.sample && !(w.key in seen)).map((w) => w.key);
}

export interface DecideInput {
  seen: Seen;
  /** The whole waiting set right now. */
  waiting: Waiting[];
  now: number;
  /** First read of a tab (or after enabling): remember everything, show nothing. */
  baseline?: boolean;
  /** Someone is looking at Mesa (a visible, focused tab): remember, show nothing. */
  quiet?: boolean;
  /** The sandbox board: titles start with "[sandbox] ". */
  sandbox?: boolean;
  /** The collector read Hoy items. The first time (no HOY_READY in `seen`) they are a silent baseline. */
  hoy?: boolean;
}

export interface Decision {
  show: Shown[];
  seen: Seen;
}

/** Several Hoy arrivals become one entry ("3 nuevos en Hoy", "Slack 2 · GitHub 1"); one stays as it is. */
function batchHoy(show: Shown[], prefix: string): Shown[] {
  const hoy = show.filter((s) => s.hoy);
  if (hoy.length < 2) return show;
  const count = new Map<Source, number>();
  for (const s of hoy) if (s.source) count.set(s.source, (count.get(s.source) ?? 0) + 1);
  const body = SOURCES.filter((src) => count.has(src))
    .map((src) => `${SOURCE_LABEL[src]} ${count.get(src)}`)
    .join(" · ");
  return [...show.filter((s) => !s.hoy), { key: HOY_TAG, title: `${prefix}${hoy.length} nuevos en Hoy`, body, url: "/", hoy: true }];
}

export function decide({ seen, waiting, now, baseline = false, quiet = false, sandbox = false, hoy = false }: DecideInput): Decision {
  const live = waiting.filter((w) => !w.sample);
  const liveKeys = new Set(live.map((w) => w.key));
  const prefix = sandbox ? "[sandbox] " : "";
  const next: Seen = {};
  // Hoy items already open when this feature first looks are not news (the inbox today never notifies).
  const hoyBaseline = hoy && !(HOY_READY in seen);

  // Carry the old keys over: tickets only while they still wait; everything else until it ages out.
  for (const [k, ts] of Object.entries(seen)) {
    if (liveKeys.has(k)) continue;
    if (isEpisodic(k)) continue;
    if (now - ts > SEEN_TTL_MS) continue;
    next[k] = ts;
  }

  if (hoy) next[HOY_READY] = now; // after the carry-over, so it never ages out while Hoy is read

  const show: Shown[] = [];
  for (const w of live) {
    const isNew = !(w.key in seen);
    next[w.key] = now; // still waiting: the key stays fresh
    // A meeting reminder ignores the quiet rule and the baseline (it is about the clock, not about what is new).
    const urgent = w.meeting === true;
    if (isNew && (urgent || (!baseline && !quiet && !w.own && !(hoyBaseline && w.kind === "item")))) {
      show.push({ key: w.key, title: prefix + w.title, body: w.body, url: w.url, ...(w.kind === "item" ? { hoy: true as const, source: w.source } : {}), ...(urgent ? { meeting: true as const } : {}) });
    }
  }

  // Bounded: keep the newest SEEN_MAX, never dropping a key that is waiting right now.
  const keys = Object.keys(next);
  if (keys.length > SEEN_MAX) {
    const droppable = keys.filter((k) => !liveKeys.has(k)).sort((a, b) => next[a]! - next[b]!);
    for (const k of droppable.slice(0, keys.length - SEEN_MAX)) delete next[k];
  }
  return { show: batchHoy(show, prefix), seen: next };
}
