// PR reviews driven by the reviewer agent. Findings are upserted by the agent; the
// buttons Andrés presses (Approve, Approve anyway, Post, Dismiss, Explain more) are
// review actions. Every GitHub write becomes a github salida that the button press
// approves with the usual 20 s undo window, and the lead executes it with gh.
import { randomBytes } from "node:crypto";
import { identity } from "../config/identity";
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { fromRow, fromRows, newId, NotFoundError, nowIso, TransitionError, ValidationError } from "../db/util";
import type { Finding, FindingState, Review, ReviewAction } from "../domain/types";
import { emitWake } from "../wake/wake";
import { ticketNeeds } from "../domain/ticket-needs";
import { salidasRepo } from "./salidas";
import { ticketsRepo } from "./tickets";
import { touchInteraction } from "./interaction";

/** The login reviews are posted as: MESA_GH_USER (default acorrea-designli). */
export const GITHUB_LOGIN = identity().ghUser;

export interface FindingInput {
  repo: string;
  pr: number;
  n?: number;
  /** Required for a new finding; an update of an existing n may omit any field and keeps the stored value. */
  label?: Finding["label"];
  at?: string;
  anchor?: string;
  summary?: string;
  explanation?: string;
  state?: FindingState;
  sha?: string;
  /** PR head to seed an empty head_sha with (server-side importers only; the API schema does not take it). Defaults to sha. */
  head?: string;
  ghCommentId?: string | null;
}

const F_SELECT = "SELECT f.*, r.repo, r.pr FROM review_findings f JOIN reviews r ON r.id = f.review_id";

/** "src/a.ts:42" -> { path, line } */
function parseAt(at: string): { path?: string; line?: number } {
  const m = /^(.+?):(\d+)(?:-\d+)?$/.exec(at.trim());
  return m ? { path: m[1], line: Number(m[2]) } : at.trim() ? { path: at.trim() } : {};
}

export const findingCommentBody = (f: Pick<Finding, "summary" | "explanation">) =>
  f.explanation ? `${f.summary}\n\n${f.explanation}` : f.summary;

export function reviewsRepo(db: Db) {
  const tickets = ticketsRepo(db);
  const salidas = salidasRepo(db);

  const findingsOf = (reviewId: string) =>
    fromRows<Finding>(db.prepare(`${F_SELECT} WHERE f.review_id = ? ORDER BY f.n`).all(reviewId));

  const get = (id: string): Review => {
    const row = db.prepare("SELECT * FROM reviews WHERE id = ?").get(id);
    if (!row) throw new NotFoundError("review", id);
    let r = fromRow<Omit<Review, "findings">>(row);
    // Follow the approve salida: sent -> approved; undone/denied/failed -> open again.
    if (r.state === "approving" && r.salidaId) {
      const s = salidas.get(r.salidaId);
      // An approval that landed on a commit older than the review's head (a push during the 20 s window) does not cover the head.
      const approvedAt = (s.destination as { commitId?: string }).commitId;
      const stale = !!approvedAt && !!r.headSha && approvedAt !== r.headSha;
      const next =
        s.status === "sent" ? (stale ? "open" : "approved") : ["pending", "denied", "failed", "expired", "withdrawn"].includes(s.status) ? "open" : null;
      if (next) {
        db.prepare("UPDATE reviews SET state = ?, salida_id = CASE WHEN ? = 'open' THEN NULL ELSE salida_id END WHERE id = ?").run(next, next, id);
        r = fromRow<Omit<Review, "findings">>(db.prepare("SELECT * FROM reviews WHERE id = ?").get(id));
      }
    }
    return { ...r, findings: findingsOf(id) };
  };

  /**
   * Find or create the review row of a PR. Only `open()` (head = true) is the authority on the PR head:
   * it moves head_sha, attaches the review to the ticket it names and reopens an approved review whose
   * head changed. A finding upsert only seeds an empty head_sha and an empty ticket: a finding's sha is
   * the commit it was found at, not necessarily the head.
   */
  const ensure = (repo: string, pr: number, ticketId: string | null, sha: string | undefined, ts: string, head = false): string => {
    const row = db.prepare("SELECT id, head_sha, state FROM reviews WHERE repo = ? AND pr = ?").get(repo, pr) as
      | { id: string; head_sha: string; state: string }
      | undefined;
    if (row) {
      if (head) {
        // The approval covered the old commit: an approved review goes back to open when the head moved. A closed card
        // (the lead's cleanup, `review close`) comes back at any head: opening it is a new review pass.
        const reopen = (row.state === "approved" && !!sha && sha !== row.head_sha) || row.state === "closed" ? 1 : 0;
        db.prepare(
          `UPDATE reviews SET head_sha = COALESCE(NULLIF(?, ''), head_sha), seen_head = COALESCE(NULLIF(?, ''), seen_head), ticket_id = COALESCE(?, ticket_id),
             state = CASE WHEN ? THEN 'open' ELSE state END, salida_id = CASE WHEN ? THEN NULL ELSE salida_id END,
             close_reason = CASE WHEN ? THEN NULL ELSE close_reason END, closed_at = CASE WHEN ? THEN NULL ELSE closed_at END, updated_at = ? WHERE id = ?`,
        ).run(sha ?? "", sha ?? "", ticketId, reopen, reopen, reopen, reopen, ts, row.id);
      } else {
        db.prepare(
          "UPDATE reviews SET head_sha = COALESCE(NULLIF(head_sha, ''), NULLIF(?, '')), ticket_id = COALESCE(ticket_id, ?), updated_at = ? WHERE id = ?",
        ).run(sha ?? "", ticketId, ts, row.id);
      }
      return row.id;
    }
    const id = newId("rv");
    db.prepare(
      "INSERT INTO reviews (id, ticket_id, repo, pr, head_sha, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
    ).run(id, ticketId, repo, pr, sha ?? "", ts, ts);
    return id;
  };

  const repo = {
    get,

    byPr(repoName: string, pr: number): Review {
      const row = db.prepare("SELECT id FROM reviews WHERE repo = ? AND pr = ?").get(repoName, pr) as { id: string } | undefined;
      if (!row) throw new NotFoundError("review", `${repoName}#${pr}`);
      return get(row.id);
    },

    list(f: { ticket?: string } = {}): Review[] {
      const rows = f.ticket
        ? db.prepare("SELECT id FROM reviews WHERE ticket_id = ? ORDER BY created_at").all(tickets.get(f.ticket).id)
        : db.prepare("SELECT id FROM reviews ORDER BY created_at").all();
      return (rows as { id: string }[]).map((r) => get(r.id));
    },

    findings(ticketIdOrRef: string): Finding[] {
      const t = tickets.get(ticketIdOrRef);
      return fromRows<Finding>(db.prepare(`${F_SELECT} WHERE r.ticket_id = ? ORDER BY r.repo, r.pr, f.n`).all(t.id));
    },

    /**
     * Open (or refresh) the review of a PR without any finding, so a clean pass still gets its
     * card with Approve. The head sha is required: Approve pins the GitHub review to it.
     * Idempotent; a new head reopens an approved review. Findings are never touched.
     */
    open(ticketIdOrRef: string, i: { repo: string; pr: number; sha: string }, now = new Date()): Review {
      if (!i.sha?.trim()) throw new TransitionError("review open needs the head sha");
      const ts = nowIso(now);
      const ticket = tickets.get(ticketIdOrRef);
      const sha = i.sha.trim();
      return tx(db, () => {
        const before = db.prepare("SELECT head_sha FROM reviews WHERE repo = ? AND pr = ?").get(i.repo, i.pr) as { head_sha: string } | undefined;
        const id = ensure(i.repo, i.pr, ticket.id, sha, ts, true);
        // A closed ticket whose review moved to a new head is back on the table (the same rule as the poll).
        if (before?.head_sha && before.head_sha !== sha && ticket.status === "closed") {
          tickets.reopenBySystem(ticket.id, { repo: i.repo, pr: i.pr, oldHead: before.head_sha, newHead: sha }, now);
        }
        return get(id);
      });
    },

    /**
     * The lead's cleanup of a stale card (t123): an `open` review becomes `closed` with the reason on the card
     * ("Cerrada · <reason>"; the findings stay as they are). Not Andrés's press: no wake, no lastInteractionAt, and
     * never through /actions. 409 unless the review is open (`approving`: a salida is in flight; `approved`; an
     * already `closed` card is refused, not a no-op, so a double close shows). The ticket stops waiting on Andrés for
     * it: a waiting_andres ticket with no other need (pending salida, permission, open question, planned needs_ok
     * step, another open review) moves to waiting_claude, quietly. `review open` at any head reopens the card.
     */
    close(reviewId: string, reason: string, now = new Date()): Review {
      return tx(db, () => {
        const why = reason.trim();
        if (!why) throw new ValidationError("closing a review needs a reason");
        const r = get(reviewId);
        if (r.state !== "open") {
          throw new TransitionError(r.state === "approving" ? "review is approving: a salida is in flight, let it finish or withdraw it first" : `review is ${r.state}`);
        }
        const ts = nowIso(now);
        db.prepare("UPDATE reviews SET state = 'closed', close_reason = ?, closed_at = ?, updated_at = ? WHERE id = ?").run(why, ts, ts, r.id);
        if (r.ticketId) {
          const t = tickets.detail(r.ticketId);
          if (t.status === "waiting_andres") {
            const needs = ticketNeeds(
              {
                status: t.status,
                messages: t.messages,
                questions: t.questions,
                steps: t.checklists.flatMap((c) => c.steps),
                actions: t.actions,
                approvals: db.prepare("SELECT status, agent, expires_at AS expiresAt FROM approvals WHERE ticket_id = ? AND status = 'pending'").all(t.id) as { status: "pending"; agent: string; expiresAt: string }[],
                reviews: repo.list({ ticket: t.id }),
                salidas: salidas.list({ status: ["pending"] }).filter((s) => s.ticketId === t.id),
              },
              now,
            );
            // With nothing else on him, ticketNeeds falls back to "Claude espera tu respuesta" for a waiting_andres status: that one is the status itself.
            const owed = needs.some((n) => n.kind !== "answer") || t.questions.some((q) => q.state === "open");
            if (!owed) tickets.andresActed(t.id, now);
          }
        }
        return get(r.id);
      });
    },

    /**
     * A head the GitHub poll (or the sandbox push) saw for a PR: the one server function behind
     * "a new push reopens a closed review ticket". It reopens the review's ticket (closed -> waiting_claude,
     * wake ticket.reopened { repo, pr, oldHead, newHead }) when the ticket is closed and the head is neither the
     * reviewed head nor the last head already handled; it then remembers the head, so a head reopens once.
     * `ignore` records the head without reopening (a push by Andrés himself or by a bot). An open ticket is
     * untouched and the head is not recorded: the review itself moves it, and if it closes first the head still counts.
     */
    noteHead(repoName: string, pr: number, head: string, o: { ignore?: boolean } = {}, now = new Date()): { reopened: boolean; oldHead: string; newHead: string } {
      const newHead = head.trim();
      if (!newHead) throw new TransitionError("a head sha is required");
      return tx(db, () => {
        const row = db.prepare("SELECT id, ticket_id, head_sha, seen_head FROM reviews WHERE repo = ? AND pr = ?").get(repoName, pr) as
          | { id: string; ticket_id: string | null; head_sha: string; seen_head: string }
          | undefined;
        const noop = { reopened: false, oldHead: row?.head_sha ?? "", newHead };
        if (!row?.ticket_id || !row.head_sha || newHead === row.head_sha || newHead === row.seen_head) return noop;
        const t = tickets.get(row.ticket_id);
        if (t.status !== "closed") return noop;
        db.prepare("UPDATE reviews SET seen_head = ?, updated_at = ? WHERE id = ?").run(newHead, nowIso(now), row.id);
        if (o.ignore) return noop;
        tickets.reopenBySystem(t.id, { repo: repoName, pr, oldHead: row.head_sha, newHead }, now);
        return { reopened: true, oldHead: row.head_sha, newHead };
      });
    },

    /** Reviews whose ticket was closed in the last `days` days: the ones a new push can bring back. */
    watchedClosed(now = new Date(), days = 30): { repo: string; pr: number; headSha: string; seenHead: string }[] {
      const since = nowIso(new Date(now.getTime() - days * 86_400_000));
      return fromRows<{ repo: string; pr: number; headSha: string; seenHead: string }>(
        db
          .prepare(
            `SELECT r.repo, r.pr, r.head_sha, r.seen_head FROM reviews r JOIN tickets t ON t.id = r.ticket_id
             WHERE t.status = 'closed' AND r.head_sha <> '' AND t.closed_at >= ? ORDER BY r.repo, r.pr`,
          )
          .all(since),
      );
    },

    /**
     * Sandbox only (the route gates it): pretend the PR of the review on this ticket got a new head, through the
     * same noteHead the poll uses. A random sha when none is given.
     */
    simulatePush(ticketIdOrRef: string, sha?: string, now = new Date()): { ticket: string; repo: string; pr: number; reopened: boolean; oldHead: string; newHead: string } {
      const t = tickets.get(ticketIdOrRef);
      const rows = db.prepare("SELECT repo, pr FROM reviews WHERE ticket_id = ? ORDER BY updated_at DESC, created_at DESC").all(t.id) as { repo: string; pr: number }[];
      const first = rows[0];
      if (!first) throw new NotFoundError("review of ticket", t.ref);
      const { repo: repoName, pr } = first;
      const res = repo.noteHead(repoName, pr, sha?.trim() || randomBytes(20).toString("hex"), {}, now);
      return { ticket: t.ref, repo: repoName, pr, ...res };
    },

    /** Insert or update a finding by (repo, pr, n). Without n, a new number is assigned. */
    upsertFinding(ticketIdOrRef: string | null, i: FindingInput, now = new Date()): Finding {
      const ts = nowIso(now);
      const ticketId = ticketIdOrRef ? tickets.get(ticketIdOrRef).id : null;
      return tx(db, () => {
        const reviewId = ensure(i.repo, i.pr, ticketId, i.head ?? i.sha, ts);
        const n =
          i.n ??
          (db.prepare("SELECT COALESCE(MAX(n), 0) + 1 AS n FROM review_findings WHERE review_id = ?").get(reviewId) as { n: number }).n;
        // An update names the fields it changes; the others keep their stored values. A new finding
        // (no n, or an n that is not stored yet) needs label and summary.
        const prev = i.n === undefined ? undefined : (db.prepare("SELECT * FROM review_findings WHERE review_id = ? AND n = ?").get(reviewId, n) as Record<string, string | null> | undefined);
        const label = i.label ?? (prev?.label as Finding["label"] | undefined);
        const summary = i.summary ?? prev?.summary;
        if (!label || !summary) {
          throw new ValidationError(
            `finding ${i.repo}#${i.pr}${i.n === undefined ? "" : ` n=${i.n}`} is new: label and summary are required (a state-only update needs an existing n)`,
          );
        }
        db.prepare(
          `INSERT INTO review_findings (id, review_id, n, label, at, anchor, summary, explanation, state, sha, gh_comment_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(review_id, n) DO UPDATE SET label = excluded.label, at = excluded.at, anchor = excluded.anchor,
             summary = excluded.summary, explanation = excluded.explanation, state = excluded.state, sha = excluded.sha,
             gh_comment_id = COALESCE(excluded.gh_comment_id, gh_comment_id), updated_at = excluded.updated_at`,
        ).run(
          newId("fd"),
          reviewId,
          n,
          label,
          i.at ?? prev?.at ?? "",
          i.anchor ?? prev?.anchor ?? "",
          summary,
          i.explanation ?? prev?.explanation ?? "",
          i.state ?? prev?.state ?? "open",
          i.sha ?? prev?.sha ?? "",
          i.ghCommentId ?? null,
          ts,
          ts,
        );
        return fromRow<Finding>(db.prepare(`${F_SELECT} WHERE f.review_id = ? AND f.n = ?`).get(reviewId, n));
      });
    },

    /**
     * A button Andrés pressed. Approve / Approve anyway / Post create github salidas that
     * the press approves (20 s undo). Dismiss only changes state. Explain more wakes the
     * reviewer. All of them emit review.action to the ticket owner.
     */
    action(reviewId: string, a: { action: ReviewAction; findingNs?: number[]; note?: string }, now = new Date()): Review & { salidaIds: string[] } {
      return tx(db, () => {
        const r = get(reviewId);
        if (r.state === "closed") throw new TransitionError(`review is closed (${r.closeReason ?? "closed by the lead"}); \`review open\` reopens it`);
        const t = r.ticketId ? tickets.get(r.ticketId) : null;
        const ts = nowIso(now);
        const pick = (ns?: number[]) => {
          const list = ns?.length ? r.findings.filter((f) => ns.includes(f.n)) : [];
          if (ns?.length && list.length !== ns.length) throw new NotFoundError("finding", ns.join(","));
          return list;
        };
        const setState = (f: Finding, state: FindingState) =>
          db.prepare("UPDATE review_findings SET state = ?, updated_at = ? WHERE id = ?").run(state, ts, f.id);
        const salidaIds: string[] = [];
        const write = (input: Parameters<typeof salidas.create>[0]) => {
          const s = salidas.create({ ...input, ticketId: r.ticketId ?? undefined, ownerSession: t?.ownerSession ?? undefined }, now);
          salidas.transition(s.id, { type: "approve", version: 1 }, now);
          salidaIds.push(s.id);
          return s.id;
        };
        let affected: number[] = [];
        touchInteraction(db, now);

        switch (a.action) {
          case "approve":
          case "approve_anyway": {
            if (r.state !== "open") throw new TransitionError(`review is ${r.state}`);
            const open = r.findings.filter((f) => f.state === "open");
            if (a.action === "approve" && open.some((f) => f.label === "blocker")) {
              throw new TransitionError("there are open blockers; use approve_anyway to waive them");
            }
            if (a.action === "approve_anyway") open.forEach((f) => setState(f, "waived"));
            affected = a.action === "approve_anyway" ? open.map((f) => f.n) : [];
            const id = write({
              source: "github",
              title: `Aprobar ${r.repo}#${r.pr}`,
              destination: { kind: "github_review", repo: r.repo, pr: r.pr, event: "APPROVE", commitId: r.headSha || undefined, postAs: GITHUB_LOGIN },
              body: a.note ?? "",
              links: [{ source: "github", label: `PR #${r.pr}`, url: `https://github.com/${r.repo}/pull/${r.pr}` }],
            });
            db.prepare("UPDATE reviews SET state = 'approving', salida_id = ?, updated_at = ? WHERE id = ?").run(id, ts, r.id);
            break;
          }
          case "post": {
            // ONE batched review per PR per decision: every chosen finding is an inline comment.
            const list = pick(a.findingNs);
            if (!list.length) throw new TransitionError("post needs findingNs");
            for (const f of list) if (f.ghCommentId || f.salidaId) throw new TransitionError(`finding ${f.n} was already posted`);
            // A blocker among the posted findings asks GitHub for changes; nits and comments only comment.
            const event = list.some((f) => f.label === "blocker") ? "REQUEST_CHANGES" : "COMMENT";
            const id = write({
              source: "github",
              title: `${event === "REQUEST_CHANGES" ? "Pedir cambios" : "Revisión"} ${r.repo}#${r.pr} · ${list.length} ${list.length === 1 ? "comentario" : "comentarios"}`,
              destination: {
                kind: "github_review",
                repo: r.repo,
                pr: r.pr,
                event,
                commitId: r.headSha || undefined,
                comments: list.map((f) => ({ ...parseAt(f.at), body: findingCommentBody(f), findingN: f.n })),
                postAs: GITHUB_LOGIN,
              },
              body: a.note ?? "",
            });
            for (const f of list) db.prepare("UPDATE review_findings SET salida_id = ?, updated_at = ? WHERE id = ?").run(id, ts, f.id);
            affected = list.map((f) => f.n);
            break;
          }
          case "dismiss": {
            const list = pick(a.findingNs);
            if (!list.length) throw new TransitionError("dismiss needs findingNs");
            list.forEach((f) => setState(f, "dismissed"));
            affected = list.map((f) => f.n);
            break;
          }
          case "explain": {
            const list = pick(a.findingNs);
            if (!list.length) throw new TransitionError("explain needs findingNs");
            affected = list.map((f) => f.n);
            break;
          }
        }

        // Any press is his turn taken: the ticket leaves Te espera (never a second wake: review.action wakes the owner).
        tickets.andresActed(r.ticketId, now);

        emitWake(
          db,
          {
            sessionId: t?.ownerSession ?? null,
            kind: "review.action",
            entityType: "review",
            entityId: r.id,
            payload: { action: a.action, repo: r.repo, pr: r.pr, findingNs: affected, salidaIds, note: a.note ?? null, ticketRef: t?.ref ?? null },
          },
          now,
        );
        return { ...get(r.id), salidaIds };
      });
    },
  };
  return repo;
}
