// Mesa's own PR intake (t107): PRs and Slack messages about PRs reach Claude without Andrés handing them over.
//
//  - GitHub: a review request the sync upserts for the first time, or one that comes back from Hecho (re-requested),
//    gets its review ticket here: the PR's existing ticket when there is one (reopened if closed), else a card and an
//    andres_asks ticket of kind review, with the same wakes as "Dárselas a Claude" (one ticket.created, 2+ in one
//    sync: one ticket.batch with origin "github"). Items already in Hoy are never back-filled: only what the sync
//    creates or brings back counts.
//  - Slack: an upserted Slack item with meta.pr ("owner/repo#n") is linked to the PR's ticket (meta.ticketRef), which
//    is created the same way when the PR has none. Mesa does not judge the message (t107: an Opus agent on the
//    ticket does): the ticket (reopened quietly if closed) gets a neutral line and the lead ONE ticket.pr_message
//    wake, and spawns or reuses writer-<ref>. The writer either records a notice (prNotice: a line, the item to
//    Hecho, no salida) or answers with a Slack salida to the same thread; the item stays in Hoy until one of them.
//  - One switch turns all of it off: config/sweep.json "autoDispatch" (env MESA_AUTO_DISPATCH overrides it).
//
// A PR is matched to its ticket by the review row (repo + pr), then by the PR item on a card; never by title.
// Nothing here writes outward: tickets, cards, lines and wakes only. Every write runs in one transaction.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { fromRow, nowIso, TransitionError } from "../db/util";
import { classify, prKey, prUrl } from "../domain/links";
import type { Item, Salida, Ticket } from "../domain/types";
import { emitWake } from "../wake/wake";
import { dispatchRepo } from "./dispatch";
import { ignoredRepo } from "./ignored";
import { itemsRepo, type ItemInput } from "./items";
import { tasksRepo } from "./tasks";
import { FOLDED_REF_LABEL, ticketsRepo } from "./tickets";

// ---------- the switch ----------

const OFF = new Set(["off", "0", "false", "no"]);

/**
 * Whether Mesa dispatches PRs and links Slack PR messages on its own. One switch: `autoDispatch` in
 * config/sweep.json (default on; a missing or unreadable file is on). MESA_AUTO_DISPATCH=on|off overrides it for one
 * server (a dev board, a test). Read on every call, so flipping the file needs no restart.
 */
export function autoDispatchEnabled(env: Record<string, string | undefined> = process.env, path = join(process.cwd(), "config", "sweep.json")): boolean {
  const v = env.MESA_AUTO_DISPATCH?.trim().toLowerCase();
  if (v) return !OFF.has(v);
  try {
    const c = JSON.parse(readFileSync(/*turbopackIgnore: true*/ path, "utf8")) as { autoDispatch?: unknown };
    return c.autoDispatch !== false;
  } catch {
    return true;
  }
}

// ---------- PR references ----------

export interface PrRef {
  repo: string;
  n: number;
}

const PR_REF = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/;

/** meta.pr as the sweeper writes it ("owner/repo#n"), or a PR address in any form. Null for anything else. */
export function parsePrRef(v: unknown): PrRef | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const m = PR_REF.exec(s);
  if (m) return { repo: m[1]!, n: Number(m[2]) };
  const l = classify(s);
  return l?.kind === "pr" && l.repo && l.n !== undefined ? { repo: l.repo, n: l.n } : null;
}

/** The PR a GitHub review item stands for: meta.repo + meta.pr, else its address. */
function prOfItem(i: Pick<Item, "url" | "meta">): PrRef | null {
  const { repo, pr } = i.meta ?? {};
  if (typeof repo === "string" && repo.includes("/") && typeof pr === "number" && Number.isInteger(pr)) return { repo, n: pr };
  return i.url ? parsePrRef(i.url) : null;
}

/** Same key as github-ingest prExternalId; matched case-insensitively (a Slack link may not keep GitHub's casing). */
const prExt = (p: PrRef) => `pr:${p.repo}#${p.n}`;

const shortName = (repo: string) => repo.split("/")[1] ?? repo;

/** The card title (mesa-review § Spawning): "<owner/repo>#<n> · <author>: <PR title>", leaving out what is unknown. */
export function prCardTitle(p: PrRef, author?: string, title?: string): string {
  const head = `${p.repo}#${p.n}`;
  const who = author ? ` · ${author}` : "";
  return title ? `${head}${who}: ${title}` : `${head}${who}`;
}

function prFacts(i: Pick<Item, "title" | "meta">, p: PrRef): { author?: string; title?: string } {
  const author = typeof i.meta?.author === "string" && i.meta.author ? i.meta.author : undefined;
  const fromMeta = typeof i.meta?.title === "string" && i.meta.title ? i.meta.title : undefined;
  // The sync's item title is "#<n> · <PR title>"; an item made from a Slack link is only "#<n>".
  const fromItem = i.title.replace(new RegExp(`^#${p.n}(?:\\s*·\\s*)?`), "").trim() || undefined;
  return { author, title: fromMeta ?? fromItem };
}

// ---------- results ----------

export interface ReviewIntakeResult {
  /** Refs of the review tickets opened in this call. */
  created: string[];
  /** Refs of existing PR tickets the items were given to instead (re-requests), open or reopened. */
  reused: string[];
  /** Refs among `reused` that were closed and reopened (ticket.reopened). */
  reopened: string[];
  /** The ticket.batch id when 2+ tickets opened at once; null otherwise. */
  batchId: string | null;
}

/** item.meta.prIntake. `verdict` stays null until the writer records a notice (a question ends in a salida instead). */
export interface PrIntakeMeta {
  at: string;
  ticketCreated: boolean;
  /** This message reopened the PR's closed ticket (quietly); a notice verdict may close it again. */
  reopened: boolean;
  verdict: "notice" | null;
  verdictAt?: string;
}

export interface SlackIntake {
  ticketRef: string;
  /** The PR's ticket was opened by this message. */
  ticketCreated: boolean;
  /** This upsert repeated a message already handled: nothing new was written or woken. */
  repeated: boolean;
}

export interface UpsertResult {
  item: Item;
  created: boolean;
  intake?: SlackIntake;
}

/** Item meta keys the intake owns: kept across re-upserts (the sweeper does not send them back). */
const OWN_KEYS = ["ticketRef", "prTicketId", "prIntake"] as const;

const prLabel = (p: PrRef) => `${shortName(p.repo)}#${p.n}`;

/** Who wrote a Slack item: meta.person, else the first part of its "<person> · <ask>" title. */
const whoOf = (i: Pick<Item, "title" | "meta">): string =>
  (typeof i.meta?.person === "string" && i.meta.person) || i.title.split(" · ")[0]!.trim() || "alguien";

const whatOf = (i: Pick<Item, "title" | "excerpt">): string => (i.excerpt || i.title.split(" · ").slice(1).join(" · ") || i.title).trim();

const slackRefs = (i: Pick<Item, "url">, who: string) => (i.url ? [{ refType: "url" as const, target: i.url, label: `Slack · ${who}` }] : []);

/** Salida states that still lead somewhere: a ticket with one of these is not finished. */
const LIVE_SALIDA = ["draft", "pending", "sending", "failed", "scheduled", "queued_until_back", "draft_created"];

type TicketRow = Pick<Ticket, "id" | "ref" | "status" | "taskId" | "isSample">;

export function intakeRepo(db: Db) {
  const items = itemsRepo(db);
  const tasks = tasksRepo(db);
  const tickets = ticketsRepo(db);
  const dispatch = dispatchRepo(db);
  const ignored = ignoredRepo(db);

  const ticketRow = (id: string): TicketRow | null => {
    const row = db.prepare("SELECT id, ref, status, task_id, is_sample FROM tickets WHERE id = ? OR ref = ?").get(id, id);
    return row ? fromRow<TicketRow>(row, { bool: ["is_sample"] }) : null;
  };

  /** A ticket folded into another (ticket fold) stands for its primary. */
  const primaryOf = (t: TicketRow): TicketRow => {
    const ref = db
      .prepare("SELECT target FROM ticket_refs WHERE ticket_id = ? AND ref_type = 'ticket' AND label = ? ORDER BY created_at DESC LIMIT 1")
      .get(t.id, FOLDED_REF_LABEL) as { target: string } | undefined;
    return (ref && ticketRow(ref.target)) || t;
  };

  /**
   * The PR's ticket, or the card it already has without one. By the review row (repo + pr), then by any item on a
   * card that stands for the PR (its key or its address). An open ticket wins over a closed one; samples never count.
   */
  const findPr = (p: PrRef): { ticket: TicketRow | null; taskId: string | null } => {
    const rv = db
      .prepare("SELECT ticket_id FROM reviews WHERE lower(repo) = lower(?) AND pr = ? AND ticket_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1")
      .get(p.repo, p.n) as { ticket_id: string } | undefined;
    const fromReview = rv ? ticketRow(rv.ticket_id) : null;
    if (fromReview && !fromReview.isSample) return { ticket: primaryOf(fromReview), taskId: null };

    const key = prKey(p.repo, p.n);
    const rows = db
      .prepare(
        `SELECT i.external_id AS ext, i.url, i.meta, i.task_id AS taskId, t.ticket_id AS ticketId FROM items i JOIN tasks t ON t.id = i.task_id
          WHERE i.is_sample = 0 AND t.is_sample = 0 AND (lower(i.external_id) = lower(?) OR i.url LIKE ?) ORDER BY t.updated_at DESC`,
      )
      .all(prExt(p), `%/pull/${p.n}%`) as { ext: string; url: string | null; meta: string; taskId: string; ticketId: string | null }[];
    const sameKey = (url: string | null) => {
      const q = url ? parsePrRef(url) : null;
      return Boolean(q && prKey(q.repo, q.n) === key);
    };
    const hits = rows.filter((r) => r.ext.toLowerCase() === prExt(p).toLowerCase() || sameKey(r.url));
    const withTicket = hits
      .map((h) => (h.ticketId ? ticketRow(h.ticketId) : null))
      .filter((t): t is TicketRow => Boolean(t && !t.isSample))
      .map(primaryOf);
    const ticket = withTicket.find((t) => t.status !== "closed") ?? withTicket[0] ?? null;
    return { ticket, taskId: ticket ? null : (hits[0]?.taskId ?? null) };
  };

  /** The GitHub review item of a PR, whatever casing its key was stored with. */
  const prItem = (p: PrRef): Item | null => {
    const row = db.prepare("SELECT id FROM items WHERE source = 'github' AND lower(external_id) = lower(?) LIMIT 1").get(prExt(p)) as { id: string } | undefined;
    return row ? items.get(row.id) : null;
  };

  /** A PR that already has a ticket: give it the item's card link, and bring it back if it was closed. */
  const reuse = (t: TicketRow, item: Item | null, p: PrRef, reason: string, now: Date, quiet = false): { reopened: boolean } => {
    let reopened = false;
    if (t.status === "closed") {
      tickets.reopenBySystem(t.id, { repo: p.repo, pr: p.n, reason }, now, { quiet });
      reopened = true;
    }
    if (item && !item.taskId && t.taskId) tasks.linkItems(t.taskId, [item.id], now);
    return { reopened };
  };

  /** The card a PR item is dispatched from: the PR's card without a ticket, the item's own, else a new one. */
  const cardFor = (item: Item, p: PrRef, existing: string | null, now: Date): string => {
    if (existing) {
      if (!item.taskId) tasks.linkItems(existing, [item.id], now);
      return existing;
    }
    if (item.taskId) return item.taskId;
    const f = prFacts(item, p);
    return tasks.create(
      { title: prCardTitle(p, f.author, f.title), source: "github", project: item.project, excerpt: item.excerpt, station: item.station, itemIds: [item.id] },
      now,
    ).id;
  };

  const reviewTitle = (item: Item, p: PrRef) => {
    const f = prFacts(item, p);
    return `Review ${prCardTitle(p, f.author, f.title)}`;
  };

  /**
   * The PR's ticket for a Slack message: the existing one, else a new review ticket with its PR item and card
   * (ticket.created, origin slack). Null when the PR's repo is ignored or Andrés skipped the PR.
   */
  const ensurePrTicket = (p: PrRef, now: Date): { ticket: TicketRow; created: boolean } | null => {
    const found = findPr(p);
    if (found.ticket) return { ticket: found.ticket, created: false };
    let pi = prItem(p);
    if (pi?.skippedAt) return null;
    if (ignored.isItemIgnored({ source: "github", externalId: prExt(p), project: shortName(p.repo) }) || ignored.isItemIgnored({ source: "github", externalId: prExt(p), project: p.repo })) return null;
    // Same key as the GitHub sync, so the review request that may follow lands on this item and this card.
    pi ??= items.create(
      {
        source: "github",
        externalId: prExt(p),
        kind: "pr_review",
        title: `#${p.n}`,
        project: shortName(p.repo),
        url: prUrl(p.repo, p.n),
        need: "approve_pr",
        waitOn: "you",
        meta: { repo: p.repo, pr: p.n, via: "slack" },
      },
      now,
    );
    const card = cardFor(pi, p, found.taskId, now);
    const res = dispatch.dispatchAuto([card], { kind: "review", origin: "slack", titles: new Map([[card, reviewTitle(pi, p)]]) }, now);
    const r = res.results[0];
    if (!r) return null; // a sample card: never dispatched
    return { ticket: ticketRow(r.ticket.id)!, created: r.created };
  };

  return {
    /**
     * The GitHub sync's new or re-requested review items (by id), in one transaction. Each PR gets exactly one
     * ticket: an existing one is reused (reopened with ticket.reopened if closed), the rest are dispatched together
     * (one ticket.created, or one ticket.batch with origin github for 2+). Samples, skipped items and items that
     * are not a PR are left alone.
     */
    reviewItems(itemIds: string[], now = new Date()): ReviewIntakeResult {
      return tx(db, () => {
        const out: ReviewIntakeResult = { created: [], reused: [], reopened: [], batchId: null };
        const cards: string[] = [];
        const titles = new Map<string, string>();
        for (const id of [...new Set(itemIds)]) {
          const item = items.get(id);
          const p = prOfItem(item);
          if (item.isSample || item.skippedAt || !p) continue;
          const found = findPr(p);
          if (found.ticket) {
            const { reopened } = reuse(found.ticket, item, p, "review re-requested", now);
            out.reused.push(found.ticket.ref);
            if (reopened) out.reopened.push(found.ticket.ref);
            continue;
          }
          const card = cardFor(item, p, found.taskId, now);
          if (titles.has(card)) continue;
          cards.push(card);
          titles.set(card, reviewTitle(item, p));
        }
        if (cards.length) {
          const res = dispatch.dispatchAuto(cards, { kind: "review", origin: "github", titles }, now);
          out.batchId = res.batchId;
          for (const r of res.results) (r.created ? out.created : out.reused).push(r.ticket.ref);
        }
        return out;
      });
    },

    /**
     * POST /api/items/upsert. Any item is upserted as before; a Slack item with meta.pr is also linked to the PR's
     * ticket (created when the PR has none), once per externalId: a repeat refreshes the content only, keeping the
     * station, waitOn and the link, and writes no line, wake or ticket. meta.intent is ignored: the writer judges.
     * `enabled` defaults to the switch.
     */
    upsertItem(input: ItemInput, o: { enabled?: boolean } = {}, now = new Date()): UpsertResult {
      const p = input.source === "slack" && !input.isSample ? parsePrRef(input.meta?.pr) : null;
      if (!p || !(o.enabled ?? autoDispatchEnabled())) return items.upsert(input, now);
      return tx(db, () => {
        const prev = db.prepare("SELECT meta FROM items WHERE source = ? AND external_id = ?").get(input.source, input.externalId) as { meta: string } | undefined;
        const prevMeta = prev ? (JSON.parse(prev.meta || "{}") as Record<string, unknown>) : null;
        if (prevMeta?.prIntake) {
          const keep = Object.fromEntries(OWN_KEYS.filter((k) => k in prevMeta).map((k) => [k, prevMeta[k]]));
          const { station: _s, waitOn: _w, ...rest } = input;
          void _s;
          void _w;
          const r = items.upsert({ ...rest, meta: { ...(input.meta ?? {}), ...keep } }, now);
          return { ...r, intake: { ticketRef: String(prevMeta.ticketRef ?? ""), ticketCreated: false, repeated: true } };
        }

        const { item, created } = items.upsert(input, now);
        if (item.skippedAt) return { item, created };
        const pt = ensurePrTicket(p, now);
        if (!pt) return { item, created };
        const who = whoOf(item);
        const [channelId = "", ts = ""] = item.externalId.split(":");
        const threadTs = typeof input.meta?.threadTs === "string" && input.meta.threadTs ? input.meta.threadTs : ts;
        // The writer works on a live ticket: a closed one comes back quietly (the wake below says why).
        const reopened = pt.ticket.status === "closed";
        if (reopened) reuse(pt.ticket, null, p, "slack message", now, true);
        const t = tickets.get(pt.ticket.id);
        const messageId = tickets.note(t.id, { body: `Mensaje en Slack de ${who} sobre ${prLabel(p)}: ${whatOf(item)}${item.url ? `\n${item.url}` : ""}`, refs: slackRefs(item, who) }, now);
        emitWake(
          db,
          {
            sessionId: t.ownerSession,
            kind: "ticket.pr_message",
            entityType: "ticket",
            entityId: t.id,
            payload: { ref: t.ref, ticketRef: t.ref, messageId, itemId: item.id, repo: p.repo, pr: p.n, who, url: item.url, channelId, ts, threadTs },
          },
          now,
        );
        const prIntake: PrIntakeMeta = { at: nowIso(now), ticketCreated: pt.created, reopened, verdict: null };
        const linked = items.update(item.id, { meta: { ...item.meta, ticketRef: t.ref, prTicketId: t.id, prIntake } }, now);
        return { item: linked, created, intake: { ticketRef: t.ref, ticketCreated: pt.created, repeated: false } };
      });
    },

    /**
     * The writer judged a linked Slack PR message a notice (`mesa item pr-notice <id>`, POST /api/items/:id/pr-notice):
     * the verdict is recorded, the item goes to Hecho (waitOn none) and the PR ticket gets one informational line (no
     * status change, no wake, no salida). If this message had reopened a closed ticket and nothing else is pending
     * on it (another linked message without a verdict, a salida still in flight), the ticket closes again, quietly.
     * Idempotent: a second call changes nothing. 409 for an item that is not a linked Slack PR message.
     */
    prNotice(itemId: string, now = new Date()): { item: Item; ticketRef: string; repeated: boolean } {
      return tx(db, () => {
        const item = items.get(itemId);
        const pi = item.meta.prIntake as PrIntakeMeta | undefined;
        const ticketId = item.meta.prTicketId;
        if (item.source !== "slack" || !pi || typeof ticketId !== "string") {
          throw new TransitionError(`item ${item.id} is not a Slack message linked to a PR ticket`);
        }
        const t = tickets.get(ticketId);
        if (pi.verdict === "notice") return { item, ticketRef: t.ref, repeated: true };
        const p = parsePrRef(item.meta.pr);
        const who = whoOf(item);
        tickets.note(t.id, { body: `Aviso en Slack de ${who}${p ? ` sobre ${prLabel(p)}` : ""}, sin respuesta: ${whatOf(item)}${item.url ? `\n${item.url}` : ""}`, refs: slackRefs(item, who) }, now);
        const prIntake: PrIntakeMeta = { ...pi, verdict: "notice", verdictAt: nowIso(now) };
        const out = items.update(item.id, { station: "done", waitOn: "none", meta: { ...item.meta, prIntake } }, now);
        if (pi.reopened && t.status !== "closed") {
          const otherMessage = db
            .prepare(
              `SELECT 1 FROM items WHERE source = 'slack' AND id <> ? AND station <> 'done' AND json_extract(meta, '$.prTicketId') = ?
                 AND json_extract(meta, '$.prIntake') IS NOT NULL AND COALESCE(json_extract(meta, '$.prIntake.verdict'), '') <> 'notice' LIMIT 1`,
            )
            .get(item.id, t.id);
          const liveSalida = db
            .prepare(`SELECT 1 FROM salidas WHERE ticket_id = ? AND status IN (${LIVE_SALIDA.map(() => "?").join(",")}) LIMIT 1`)
            .get(t.id, ...LIVE_SALIDA);
          if (!otherMessage && !liveSalida) tickets.transition(t.id, { type: "close", by: "claude" }, undefined, now);
        }
        return { item: out, ticketRef: t.ref, repeated: false };
      });
    },
  };
}

/**
 * A Slack salida of a PR ticket reached an end (sent, denied, expired): the linked Slack PR messages it answers (all
 * but those the writer judged a notice, which are already in Hecho) leave Hoy.
 * Matched by the ticket and, when the salida names them, the channel and the thread. Joins the caller's transaction.
 */
export function settlePrQuestions(db: Db, s: Pick<Salida, "ticketId" | "source" | "destination" | "status">, now = new Date()): number {
  if (!s.ticketId || s.source !== "slack" || !["sent", "denied", "expired"].includes(s.status)) return 0;
  const d = s.destination as { channelId?: string; threadTs?: string };
  const rows = db
    .prepare(
      `SELECT id, external_id AS ext, meta FROM items WHERE source = 'slack' AND station <> 'done'
         AND json_extract(meta, '$.prTicketId') = ? AND json_extract(meta, '$.prIntake') IS NOT NULL
         AND COALESCE(json_extract(meta, '$.prIntake.verdict'), '') <> 'notice'`,
    )
    .all(s.ticketId) as { id: string; ext: string; meta: string }[];
  let n = 0;
  for (const r of rows) {
    const meta = JSON.parse(r.meta || "{}") as { threadTs?: string };
    const [channelId, ts] = r.ext.split(":");
    if (d.channelId && d.channelId !== channelId) continue;
    if (d.threadTs && d.threadTs !== (meta.threadTs || ts)) continue;
    db.prepare("UPDATE items SET station = 'done', wait_on = 'none', updated_at = ? WHERE id = ?").run(nowIso(now), r.id);
    n++;
  }
  return n;
}
