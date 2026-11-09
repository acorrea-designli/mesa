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
import type { Approval, Salida, Ticket } from "@/lib/domain/types";
import { destShort } from "@/features/salidas/model";

export type WaitingKind = "ticket" | "salida" | "approval";

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
}

export interface Shown {
  key: string;
  title: string;
  body: string;
  url: string;
}

/** key -> last time it was seen waiting (epoch ms). */
export type Seen = Record<string, number>;

/** Keys of tickets are forgotten when the ticket stops waiting; the others age out. */
export const SEEN_TTL_MS = 14 * 24 * 3600_000;
export const SEEN_MAX = 300;

const isEpisodic = (key: string) => key.startsWith("ticket:");

// ---------- entries ----------

export const ticketKey = (t: Pick<Ticket, "id">) => `ticket:${t.id}`;
export const salidaKey = (s: Pick<Salida, "id" | "currentVersion">) => `salida:${s.id}:v${s.currentVersion}`;
export const approvalKey = (a: Pick<Approval, "id">) => `approval:${a.id}`;

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
}

export interface Decision {
  show: Shown[];
  seen: Seen;
}

export function decide({ seen, waiting, now, baseline = false, quiet = false, sandbox = false }: DecideInput): Decision {
  const live = waiting.filter((w) => !w.sample);
  const liveKeys = new Set(live.map((w) => w.key));
  const prefix = sandbox ? "[sandbox] " : "";
  const next: Seen = {};

  // Carry the old keys over: tickets only while they still wait; everything else until it ages out.
  for (const [k, ts] of Object.entries(seen)) {
    if (liveKeys.has(k)) continue;
    if (isEpisodic(k)) continue;
    if (now - ts > SEEN_TTL_MS) continue;
    next[k] = ts;
  }

  const show: Shown[] = [];
  for (const w of live) {
    const isNew = !(w.key in seen);
    next[w.key] = now; // still waiting: the key stays fresh
    if (isNew && !baseline && !quiet && !w.own) show.push({ key: w.key, title: prefix + w.title, body: w.body, url: w.url });
  }

  // Bounded: keep the newest SEEN_MAX, never dropping a key that is waiting right now.
  const keys = Object.keys(next);
  if (keys.length > SEEN_MAX) {
    const droppable = keys.filter((k) => !liveKeys.has(k)).sort((a, b) => next[a]! - next[b]!);
    for (const k of droppable.slice(0, keys.length - SEEN_MAX)) delete next[k];
  }
  return { show, seen: next };
}
