// Unsent text on Tickets, kept in the browser so a remount (a tab or screen change, a reload, the
// board restarting under an open tab) never loses it. One localStorage key holds every draft:
// the reply of each ticket (by ticket id: text, @refs and the picks on its question cards) and the new-request form (text, @refs,
// Relacionar con, Proyecto). Nothing else is stored: no files, no ticket content.
// Pure over a `DraftStore`, so it is tested without a browser; every storage access is guarded.

export interface DraftRef {
  target: string;
  label: string;
}
/** What he picked or wrote on one open card question, not sent yet. */
export interface DraftPick {
  chosen?: string;
  text?: string;
}
export interface ReplyDraft {
  text: string;
  refs: DraftRef[];
  /** Question card picks by question id (t108); absent or empty when none. */
  picks?: Record<string, DraftPick>;
}
export interface RequestDraft {
  text: string;
  refs: DraftRef[];
  link: string;
  project: string;
}

/** The slice of the Storage API used here (window.localStorage fits). */
export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DRAFTS_KEY = "mesa.tickets.drafts.v1";
/** A draft untouched for this long is dropped the next time the drafts are read. */
export const MAX_AGE_MS = 14 * 86_400_000;
const MAX_REPLIES = 50;
const MAX_TEXT = 50_000;
const MAX_REFS = 20;
const MAX_PICKS = 36;

interface Stamped<T> {
  d: T;
  at: number;
}
interface Drafts {
  replies: Record<string, Stamped<ReplyDraft>>;
  request?: Stamped<RequestDraft>;
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readRefs(v: unknown): DraftRef[] | null {
  if (!Array.isArray(v)) return null;
  const out: DraftRef[] = [];
  for (const r of v.slice(0, MAX_REFS)) {
    if (!isRecord(r)) return null;
    const target = str(r.target, 80);
    const label = str(r.label, 300);
    if (!target || label === null) return null;
    if (!out.some((x) => x.target === target)) out.push({ target, label });
  }
  return out;
}

/** Picks by question id; a malformed entry is dropped, never the whole draft. */
function readPicks(v: unknown): Record<string, DraftPick> {
  const out: Record<string, DraftPick> = {};
  if (!isRecord(v)) return out;
  for (const [id, p] of Object.entries(v).slice(0, MAX_PICKS)) {
    if (id === "__proto__" || id.length > 40 || !isRecord(p)) continue;
    const chosen = str(p.chosen, 3);
    const text = str(p.text, 2000);
    if (!chosen && !text) continue;
    out[id] = { ...(chosen ? { chosen } : {}), ...(text ? { text } : {}) };
  }
  return out;
}

const hasPicks = (p: Record<string, DraftPick> | undefined) => Boolean(p && Object.keys(p).length);

function readReply(v: unknown): ReplyDraft | null {
  if (!isRecord(v)) return null;
  const text = str(v.text, MAX_TEXT);
  const refs = readRefs(v.refs);
  if (text === null || !refs) return null;
  const picks = readPicks(v.picks);
  return hasPicks(picks) ? { text, refs, picks } : { text, refs };
}

function readRequest(v: unknown): RequestDraft | null {
  const base = readReply(v);
  if (!base || !isRecord(v)) return null;
  delete base.picks;
  const link = str(v.link, 2000);
  const project = str(v.project, 200);
  return link === null || project === null ? null : { ...base, link, project };
}

const stamp = (v: unknown, now: number): number | null => {
  if (!isRecord(v) || typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
  return now - v.at > MAX_AGE_MS || v.at > now + 86_400_000 ? null : v.at;
};

/** Reads the stored drafts: garbage and drafts older than 14 days are left out. */
export function parseDrafts(raw: string | null, now: number): Drafts {
  const out: Drafts = { replies: {} };
  if (!raw) return out;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!isRecord(v)) return out;
  if (isRecord(v.replies)) {
    for (const [id, e] of Object.entries(v.replies)) {
      if (id === "__proto__" || id.length > 80) continue;
      const at = stamp(e, now);
      const d = at !== null && isRecord(e) ? readReply(e.d) : null;
      if (d && at !== null) out.replies[id] = { d, at };
    }
  }
  const at = stamp(v.request, now);
  const d = at !== null && isRecord(v.request) ? readRequest(v.request.d) : null;
  if (d && at !== null) out.request = { d, at };
  return out;
}

const read = (store: DraftStore | null, now: number): Drafts => {
  if (!store) return { replies: {} };
  try {
    return parseDrafts(store.getItem(DRAFTS_KEY), now);
  } catch {
    return { replies: {} };
  }
};

function write(store: DraftStore | null, drafts: Drafts) {
  if (!store) return;
  try {
    const entries = Object.entries(drafts.replies).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_REPLIES);
    if (!entries.length && !drafts.request) store.removeItem(DRAFTS_KEY);
    else store.setItem(DRAFTS_KEY, JSON.stringify({ v: 1, replies: Object.fromEntries(entries), request: drafts.request }));
  } catch {
    /* storage full or blocked: the draft just stays in the page */
  }
}

/** window.localStorage, or null when the browser denies it (private mode, blocked cookies, SSR). */
export function browserStore(): DraftStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const emptyReply = (d: ReplyDraft) => d.text === "" && d.refs.length === 0 && !hasPicks(d.picks);

export function loadReply(ticketId: string, store: DraftStore | null = browserStore(), now = Date.now()): ReplyDraft | null {
  const replies = read(store, now).replies;
  return Object.hasOwn(replies, ticketId) ? replies[ticketId]!.d : null;
}

/** Saves the reply of a ticket; an empty one removes the entry. */
export function saveReply(ticketId: string, draft: ReplyDraft, store: DraftStore | null = browserStore(), now = Date.now()): void {
  const drafts = read(store, now);
  if (emptyReply(draft)) {
    if (!drafts.replies[ticketId]) return;
    delete drafts.replies[ticketId];
  } else {
    const picks = readPicks(draft.picks);
    const d: ReplyDraft = { text: draft.text.slice(0, MAX_TEXT), refs: draft.refs.slice(0, MAX_REFS) };
    if (hasPicks(picks)) d.picks = picks;
    drafts.replies[ticketId] = { d, at: now };
  }
  write(store, drafts);
}

export function clearReply(ticketId: string, store: DraftStore | null = browserStore(), now = Date.now()): void {
  saveReply(ticketId, { text: "", refs: [] }, store, now);
}

export function loadRequest(store: DraftStore | null = browserStore(), now = Date.now()): RequestDraft | null {
  return read(store, now).request?.d ?? null;
}

/** Saves the new-request form; an empty one (no text, refs, link or project) removes it. */
export function saveRequest(draft: RequestDraft, store: DraftStore | null = browserStore(), now = Date.now()): void {
  const drafts = read(store, now);
  if (emptyReply(draft) && !draft.link && !draft.project) {
    if (!drafts.request) return;
    delete drafts.request;
  } else {
    drafts.request = { d: { text: draft.text.slice(0, MAX_TEXT), refs: draft.refs.slice(0, MAX_REFS), link: draft.link.slice(0, 2000), project: draft.project.slice(0, 200) }, at: now };
  }
  write(store, drafts);
}

export function clearRequest(store: DraftStore | null = browserStore(), now = Date.now()): void {
  saveRequest({ text: "", refs: [], link: "", project: "" }, store, now);
}
