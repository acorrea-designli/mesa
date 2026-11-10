// The Stream Deck GitHub key ("PRs pendientes de review", t93), pure. The key's number is written every 3 min by the
// gh-watch task to ~/.claude-work/gh-watch-state.json (schema version 1, owned by that script, not by Mesa). This file
// turns that file into what the rail shows (the same total, "stale" after 15 min, "sin dato" when there is no file) and
// into the per-PR explanation the panel shows: why the deck counts it, and whether it matters by Mesa's own rules.
// Nothing here assumes a field is present, and nothing here reads a file or calls GitHub.
import { ageLabel, STALE_AFTER_MS } from "./usage";

/** The deck marks a poll older than this as stale (STALE_MINUTES in the plugin); same limit as the Uso block. */
export const DECK_STALE_MS = STALE_AFTER_MS;

export type DeckReason = "review_requested" | "post_approve_push" | "open_findings" | "notification" | "unknown";

export interface DeckItem {
  /** "owner/repo#n" for a PR; the deck's own id for anything else. */
  key: string;
  repo: string;
  /** Null for a notification that is not about a PR. */
  num: number | null;
  title: string;
  author: string;
  url: string;
  /** The head the deck saw (7 chars); "" when the item carries none. */
  head: string;
  reason: DeckReason;
  /** GitHub's notification reason ("mention", "assign"...), only for reason "notification". */
  notificationReason: string;
  /** The subject type of a notification ("PullRequest", "Issue"...), "" for a PR bucket item. */
  type: string;
}

export interface DeckView {
  /** "none": no usable file ("sin dato"). "stale": the poll is older than 15 min or failed (muted). */
  state: "none" | "fresh" | "stale";
  /** The deck's own number (counts.total), as is. Null when there is no usable file. */
  total: number | null;
  polledAt: string | null;
  /** "hace 4 min"; "" when there is no poll time. */
  age: string;
  items: DeckItem[];
}

const EMPTY: DeckView = { state: "none", total: null, polledAt: null, age: "", items: [] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const NOTIFICATION_LABEL: Record<string, string> = {
  mention: "te mencionaron",
  team_mention: "mencionaron a tu equipo",
  assign: "te asignaron",
  comment: "comentaron en un hilo tuyo",
  state_change: "cambió de estado",
};

/** The deck's reason in Spanish, as the panel prints it. */
export function reasonLabel(i: Pick<DeckItem, "reason" | "notificationReason">): string {
  switch (i.reason) {
    case "review_requested":
      return "te pidieron review y el monitor no vio este head";
    case "post_approve_push":
      return "un push tumbó tu approve";
    case "open_findings":
      return "push sobre findings abiertos";
    case "notification":
      return `notificación de GitHub: ${NOTIFICATION_LABEL[i.notificationReason] ?? (i.notificationReason || "sin motivo")}`;
    default:
      return "el deck no dice por qué";
  }
}

function numOf(raw: Record<string, unknown>): number | null {
  if (typeof raw.num === "number" && Number.isFinite(raw.num)) return raw.num;
  const m = /\/pull\/(\d+)(?:[/?#]|$)/.exec(str(raw.url));
  return m ? Number(m[1]) : null;
}

function itemOf(raw: unknown, bucket: "review" | "postApprovePush" | "notifications"): DeckItem | null {
  if (!isObj(raw)) return null;
  const repo = str(raw.repo);
  if (!repo) return null;
  const isNote = bucket === "notifications";
  const type = isNote ? str(raw.type) : "";
  // A notification only names a PR when its subject is one; the number then comes from the URL.
  const num = isNote && type !== "PullRequest" ? null : numOf(raw);
  let reason: DeckReason;
  if (isNote) reason = "notification";
  else if (bucket === "postApprovePush") reason = "post_approve_push";
  else if (raw.rereview === true) reason = "open_findings";
  else reason = raw.requested === false ? "unknown" : "review_requested";
  return {
    key: num !== null ? `${repo}#${num}` : str(raw.id) || `${repo}:${str(raw.title)}`,
    repo,
    num,
    title: str(raw.title) || "(sin título)",
    author: str(raw.author),
    url: str(raw.url),
    head: str(raw.head),
    reason,
    notificationReason: isNote ? str(raw.reason) : "",
    type,
  };
}

/**
 * The deck's state as the rail and the panel show it. `polledAt` is local time without an offset ("2026-11-10T10:51:12"),
 * which Date.parse reads as local, exactly like the plugin does: the total is the deck's counts.total, never recomputed.
 * A missing, unreadable or odd file (null, no counts.total) is "none". A failed poll (ok false) is stale, as on the deck.
 * Items that appear in several buckets (a PR and its notification) are listed once, the PR bucket first.
 */
export function deckView(raw: unknown, now: Date): DeckView {
  if (!isObj(raw)) return EMPTY;
  const counts = isObj(raw.counts) ? raw.counts : null;
  const total = counts && typeof counts.total === "number" && Number.isFinite(counts.total) ? counts.total : null;
  if (total === null) return EMPTY;
  const polledAt = str(raw.polledAt) || null;
  const polled = polledAt ? Date.parse(polledAt) : Number.NaN;
  const stale = raw.ok === false || Number.isNaN(polled) || now.getTime() - polled > DECK_STALE_MS;
  const buckets = isObj(raw.items) ? raw.items : {};
  const items: DeckItem[] = [];
  const seen = new Set<string>();
  for (const bucket of ["review", "postApprovePush", "notifications"] as const) {
    const list = Array.isArray(buckets[bucket]) ? (buckets[bucket] as unknown[]) : [];
    for (const r of list) {
      const it = itemOf(r, bucket);
      if (!it || seen.has(it.key)) continue;
      seen.add(it.key);
      items.push(it);
    }
  }
  return { state: stale ? "stale" : "fresh", total, polledAt, age: Number.isNaN(polled) ? "" : ageLabel(polledAt!, now), items };
}

// ---------- verdict ----------

export type DeckVerdict = "interesa" | "no_interesa" | "sin_dato";

/** What GitHub says about the PR right now (one fetchPrDetail), or why it could not be read. */
export type DeckGithub =
  | {
      status: "ok";
      head: string;
      draft: boolean;
      author: string;
      releaseTrain: boolean;
      /** Andrés's latest non-pending review: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED. */
      myReview: string | null;
      myReviewHead: string | null;
    }
  | { status: "none"; why: "rate_limit" | "error" | "off" };

/** What Mesa already has about the PR. */
export interface DeckMesa {
  /** An item for the PR exists (any station). */
  hasItem: boolean;
  /** "t12" of the review ticket, or null when there is no review. */
  ticketRef: string | null;
  /** The head the reviewer reviewed ("" when there is no review). */
  reviewHead: string;
  openFindings: number;
}

export interface DeckFacts {
  /** Andrés's GitHub login. */
  login: string;
  ignored: boolean;
  skipped: boolean;
  /** Null for a notification that is not a PR: there is nothing to read. */
  github: DeckGithub | null;
  mesa: DeckMesa;
}

export interface DeckPrView {
  key: string;
  repo: string;
  num: number | null;
  title: string;
  author: string;
  url: string;
  /** The deck's reason in Spanish. */
  reason: string;
  verdict: DeckVerdict;
  /** One line: why the verdict is what it is. */
  why: string;
  /** When Mesa's verdict disagrees with the deck (which counts every PR it lists): the one line that says why. Else null. */
  disagree: string | null;
  /** What Mesa already has ("Mesa ya la tiene: ..."), or null for a PR Mesa has nothing on. */
  mesa: string | null;
}

/** Two heads match when one is a prefix of the other (the deck keeps 7 chars, GitHub 40); both must be non-empty. */
export const sameHead = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a || !b) return false;
  const n = Math.min(a.length, b.length);
  return n >= 7 && a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
};

const short = (h: string) => h.slice(0, 7);

/** "Mesa ya la tiene: ticket t12, el reviewer vio fc5f20b (el actual), 1 hallazgo abierto". Null when Mesa has nothing. */
export function mesaNote(m: DeckMesa, currentHead: string): string | null {
  if (!m.hasItem && !m.ticketRef) return null;
  if (!m.ticketRef) return "Mesa ya la tiene en Hoy; aún sin review";
  const saw = m.reviewHead ? `el reviewer vio ${short(m.reviewHead)}${currentHead ? (sameHead(m.reviewHead, currentHead) ? " (el actual)" : " (no el actual)") : ""}` : "el reviewer aún no fija un head";
  const f = m.openFindings === 0 ? "sin hallazgos abiertos" : m.openFindings === 1 ? "1 hallazgo abierto" : `${m.openFindings} hallazgos abiertos`;
  return `Mesa ya la tiene: ticket ${m.ticketRef}, ${saw}, ${f}`;
}

const NO_GITHUB: Record<"rate_limit" | "error" | "off", string> = {
  rate_limit: "GitHub devolvió límite de uso; no se pudo leer la PR",
  error: "no se pudo leer la PR en GitHub",
  off: "GitHub está apagado en este Mesa; no se leyó la PR",
};

/**
 * Whether the PR matters to Mesa, with Mesa's existing gate only (mesa-sweep § 1) and nothing new: an ignored project, a
 * skipped item (Saltar), an own PR, a draft, a release-train PR, and a PR Andrés already approved at its current head do
 * not matter; everything else does. The first rule that applies decides, so the line says one reason. When GitHub could
 * not be read the rules that need it cannot be judged: "sin dato", never a guess. The deck counts every PR it lists, so a
 * "no interesa" is also a disagreement and carries the line that says why.
 */
export function deckPrView(i: DeckItem, f: DeckFacts): DeckPrView {
  const g = f.github;
  const gh = g && g.status === "ok" ? g : null;
  const head = gh?.head || i.head;
  const base = { key: i.key, repo: i.repo, num: i.num, title: i.title, author: i.author, url: i.url, reason: reasonLabel(i) };
  const no = (why: string, disagree: string): DeckPrView => ({ ...base, verdict: "no_interesa", why, disagree, mesa: mesaNote(f.mesa, head) });

  if (f.ignored) return no("el proyecto está ignorado en Mesa", "el deck la cuenta, pero el proyecto está ignorado en Mesa");
  if (f.skipped) return no("la saltaste en Mesa", "el deck la cuenta, pero la saltaste en Mesa");
  if (!g) return { ...base, verdict: "sin_dato", why: "no es una PR: Mesa no tiene reglas para esto", disagree: null, mesa: null };

  const author = i.author || gh?.author || "";
  if (author && author.toLowerCase() === f.login.toLowerCase()) return no("es una PR tuya", "el deck la cuenta, pero es una PR tuya");
  if (g.status === "none") return { ...base, verdict: "sin_dato", why: NO_GITHUB[g.why], disagree: null, mesa: mesaNote(f.mesa, head) };
  if (!gh) return { ...base, verdict: "sin_dato", why: NO_GITHUB.error, disagree: null, mesa: mesaNote(f.mesa, head) };
  if (gh.draft) return no("es un borrador", "el deck la cuenta, pero hoy es un borrador en GitHub");
  if (gh.releaseTrain) return no("es una PR de release train", "el deck la cuenta, pero es una PR de release train: se aprueba al desplegar");
  if (gh.myReview === "APPROVED" && sameHead(gh.myReviewHead, gh.head))
    return no(
      `ya aprobaste ${short(gh.head)} en GitHub`,
      `ya aprobaste este head en GitHub; el deck lee un estado viejo del pr-monitor`,
    );
  return {
    ...base,
    verdict: "interesa",
    why: gh.myReview && sameHead(gh.myReviewHead, gh.head) ? `tu último review en ${short(gh.head)} no es un approve` : `no has aprobado ${short(gh.head)}`,
    disagree: null,
    mesa: mesaNote(f.mesa, head) ?? "Mesa aún no la tiene",
  };
}
