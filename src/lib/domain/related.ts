// "Relacionado": what Mesa can tell is connected to a ticket without asking anyone (no network): the PR
// of its reviews and PR item and that PR's checks page, the other items on its board card, the items and
// tickets that mention the same PR or the same Slack / Basecamp address, and the CI runs named in its
// messages. Pure: read.ts gathers the (bounded) candidates and the rows it already shows under "Fuente".
import { checksUrl, classify, linkKey, normalizeUrl, prKey, prUrl, resourceKey, urlsIn } from "./links";
import type { Source } from "./types";

export interface RelItem {
  id: string;
  source: Source;
  title: string;
  excerpt: string;
  url: string | null;
  taskId: string | null;
  meta: Record<string, unknown>;
}

export interface RelTicket {
  id: string;
  ref: string;
  title: string;
  itemId: string | null;
  /** Message bodies and recommendations: where addresses are looked for. */
  texts: string[];
  /** Targets of its url refs. */
  refUrls: string[];
  /** PRs reviewed on it. */
  reviews: { repo: string; pr: number }[];
}

export type RelatedWhy = "pr" | "ci" | "card" | "mention" | "run";

export interface Related {
  /** Identity for dedupe and React keys. */
  key: string;
  /** An absolute address (opens in a new tab) or "/tickets?t=<ref>" (same tab). */
  href: string;
  internal: boolean;
  source?: Source;
  label: string;
  /** The rest of the line: a ticket's title. */
  detail?: string;
  why: RelatedWhy;
}

export interface RelatedInput {
  ticket: RelTicket & { taskId: string | null };
  /** The ticket's own item, or null. */
  item: RelItem | null;
  /** Candidates to mention-match, already bounded by the caller (may include the ticket's own item and card items). */
  items: RelItem[];
  /** The other tickets, already bounded by the caller. */
  tickets: RelTicket[];
  /** What "Fuente" already shows: addresses and ticket refs. */
  shown: { urls: string[]; tickets: string[] };
}

/** Most resources of the "mentions" kind shown, so a busy PR does not flood the block. */
export const MAX_MENTIONS = 8;

const MENTION = /^(?:pr|slack|basecamp):/;

const keysOfUrls = (urls: Iterable<string>): string[] => {
  const out: string[] = [];
  for (const u of urls) {
    const k = resourceKey(u);
    if (k && MENTION.test(k)) out.push(k);
  }
  return out;
};

export function itemPr(it: Pick<RelItem, "url" | "meta">): { repo: string; n: number } | null {
  const repo = it.meta.repo;
  const n = it.meta.pr;
  if (typeof repo === "string" && repo.includes("/") && typeof n === "number" && Number.isInteger(n)) return { repo, n };
  // A Slack message about a PR carries it as meta.pr "owner/repo#n" (mesa-sweep § 3, repo/intake.ts).
  const tagged = typeof n === "string" ? /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(n.trim()) : null;
  if (tagged) return { repo: tagged[1]!, n: Number(tagged[2]) };
  const l = it.url ? classify(it.url) : null;
  return l?.kind === "pr" && l.repo && l.n !== undefined ? { repo: l.repo, n: l.n } : null;
}

/** Resource keys an item carries: its own address, the PR in its meta, and the addresses in its text. */
export function itemKeys(it: RelItem): Set<string> {
  const keys = new Set(keysOfUrls([...(it.url ? [it.url] : []), ...urlsIn(`${it.title}\n${it.excerpt}`)]));
  const pr = itemPr(it);
  if (pr) keys.add(`pr:${prKey(pr.repo, pr.n)}`);
  return keys;
}

export function ticketKeys(t: RelTicket, item: RelItem | null): Set<string> {
  const keys = new Set(keysOfUrls([...t.texts.flatMap(urlsIn), ...t.refUrls]));
  for (const r of t.reviews) keys.add(`pr:${prKey(r.repo, r.pr)}`);
  if (item) for (const k of itemKeys(item)) keys.add(k);
  return keys;
}

const overlaps = (a: ReadonlySet<string>, b: ReadonlySet<string>) => {
  for (const k of a) if (b.has(k)) return true;
  return false;
};

const shortName = (repo: string) => repo.split("/")[1] ?? repo;

export function related(input: RelatedInput): Related[] {
  const { ticket, item, items, tickets } = input;
  const out: Related[] = [];
  const seen = new Set<string>([`ticket:${ticket.ref}`, ...input.shown.tickets.map((r) => `ticket:${r}`)]);
  for (const u of input.shown.urls) {
    const k = linkKey(u);
    if (k) seen.add(k);
  }
  const add = (r: Related) => {
    if (seen.has(r.key)) return;
    seen.add(r.key);
    out.push(r);
  };

  // (a) the PR of each review and of the PR item, and its checks page
  const prs: { repo: string; n: number }[] = [];
  for (const r of ticket.reviews) prs.push({ repo: r.repo, n: r.pr });
  const own = item ? itemPr(item) : null;
  if (own) prs.push(own);
  const donePrs = new Set<string>();
  for (const p of prs) {
    const id = prKey(p.repo, p.n);
    if (donePrs.has(id)) continue;
    donePrs.add(id);
    add({ key: `pr:${id}`, href: prUrl(p.repo, p.n), internal: false, source: "github", label: `${shortName(p.repo)}#${p.n}`, why: "pr" });
    add({ key: `checks:${id}`, href: checksUrl(p.repo, p.n), internal: false, source: "github", label: "CI", why: "ci" });
  }

  // (b) the other items on the ticket's board card
  if (ticket.taskId) {
    for (const it of items) {
      const href = it.url ? normalizeUrl(it.url) : null;
      if (it.taskId !== ticket.taskId || it.id === ticket.itemId || !href) continue;
      add({ key: linkKey(href) ?? `item:${it.id}`, href, internal: false, source: it.source, label: it.title, why: "card" });
    }
  }

  // (c) items and tickets that mention the same PR, Slack or Basecamp address
  const mine = ticketKeys(ticket, item);
  if (mine.size) {
    const itemById = new Map(items.map((i) => [i.id, i]));
    let n = 0;
    for (const it of items) {
      if (n >= MAX_MENTIONS) break;
      const href = it.url ? normalizeUrl(it.url) : null;
      if (it.id === ticket.itemId || !href || !overlaps(mine, itemKeys(it))) continue;
      const before = out.length;
      add({ key: linkKey(href) ?? `item:${it.id}`, href, internal: false, source: it.source, label: it.title, why: "mention" });
      if (out.length > before) n++;
    }
    for (const t of tickets) {
      if (n >= MAX_MENTIONS) break;
      if (t.id === ticket.id) continue;
      const theirs = ticketKeys(t, t.itemId ? (itemById.get(t.itemId) ?? null) : null);
      if (!overlaps(mine, theirs)) continue;
      const before = out.length;
      add({ key: `ticket:${t.ref}`, href: `/tickets?t=${t.ref}`, internal: true, label: `@${t.ref}`, detail: t.title, why: "mention" });
      if (out.length > before) n++;
    }
  }

  // (d) CI runs named in the ticket's messages and refs
  for (const u of [...ticket.texts.flatMap(urlsIn), ...ticket.refUrls.flatMap((r) => normalizeUrl(r) ?? [])]) {
    const l = classify(u);
    if (l?.kind === "run" && l.label) add({ key: linkKey(l.href) ?? l.href, href: l.href, internal: false, source: "github", label: l.label, why: "run" });
  }
  return out;
}

