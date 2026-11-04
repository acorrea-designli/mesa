// PR reviews driven by the reviewer agent. Findings are upserted by the agent; the
// buttons Andrés presses (Approve, Approve anyway, Post, Dismiss, Explain more) are
// review actions. Every GitHub write becomes a github salida that the button press
// approves with the usual 20 s undo window, and the lead executes it with gh.
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { fromRow, fromRows, newId, NotFoundError, nowIso, TransitionError } from "../db/util";
import type { Finding, FindingState, Review, ReviewAction } from "../domain/types";
import { emitWake } from "../wake/wake";
import { salidasRepo } from "./salidas";
import { ticketsRepo } from "./tickets";
import { touchInteraction } from "./interaction";

export const GITHUB_LOGIN = "acorrea-designli";

export interface FindingInput {
  repo: string;
  pr: number;
  n?: number;
  label: Finding["label"];
  at?: string;
  anchor?: string;
  summary: string;
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
        s.status === "sent" ? (stale ? "open" : "approved") : ["pending", "denied", "failed", "expired"].includes(s.status) ? "open" : null;
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
        // The approval covered the old commit: an approved review goes back to open when the head moved.
        const reopen = row.state === "approved" && !!sha && sha !== row.head_sha ? 1 : 0;
        db.prepare(
          `UPDATE reviews SET head_sha = COALESCE(NULLIF(?, ''), head_sha), ticket_id = COALESCE(?, ticket_id),
             state = CASE WHEN ? THEN 'open' ELSE state END, salida_id = CASE WHEN ? THEN NULL ELSE salida_id END, updated_at = ? WHERE id = ?`,
        ).run(sha ?? "", ticketId, reopen, reopen, ts, row.id);
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
      const ticketId = tickets.get(ticketIdOrRef).id;
      return tx(db, () => get(ensure(i.repo, i.pr, ticketId, i.sha.trim(), ts, true)));
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
          i.label,
          i.at ?? "",
          i.anchor ?? "",
          i.summary,
          i.explanation ?? "",
          i.state ?? "open",
          i.sha ?? "",
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
