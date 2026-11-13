// The SQLite cache of /proyectos (migration 1100_github_projects.sql). The reader writes it; the API reads it. Nothing
// here talks to GitHub.
import type { Db } from "../db/sqlite";
import { tx } from "../db/sqlite";
import { nowIso } from "../db/util";
import type { BoardItem, BoardRead, OpenPr, PrDetail } from "./projects-gh";

export interface CachedPr extends OpenPr {
  mergeable: PrDetail["mergeable"];
  checks: PrDetail["checks"] | null;
  reviewDecision: PrDetail["reviewDecision"];
  myReview: string | null;
  closingIssues: string[];
  detailHead: string | null;
  detailUpdatedAt: string | null;
  detailAt: string | null;
  seenAt: string;
}

export interface RepoRead {
  repo: string;
  etag: string | null;
  readAt: string;
  prCount: number;
  truncated: boolean;
}

export interface CachedBoard {
  project: string;
  owner: string;
  number: number;
  title: string;
  url: string;
  statusOptions: string[];
  itemCount: number;
  readAt: string;
}

interface PrRow {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  draft: number;
  created_at: string;
  updated_at: string;
  head_sha: string;
  head_ref: string;
  base_ref: string;
  body: string;
  requested: string;
  mergeable: string | null;
  checks_state: string | null;
  checks_total: number;
  checks_failed: number;
  checks_pending: number;
  review_decision: string | null;
  my_review: string | null;
  closing_issues: string;
  detail_head: string | null;
  detail_updated_at: string | null;
  detail_at: string | null;
  seen_at: string;
}

const json = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

const toPr = (r: PrRow): CachedPr => ({
  repo: r.repo,
  number: r.number,
  title: r.title,
  url: r.url,
  author: r.author,
  draft: Boolean(r.draft),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  headSha: r.head_sha,
  headRef: r.head_ref,
  baseRef: r.base_ref,
  body: r.body,
  requested: json<string[]>(r.requested, []),
  mergeable: (r.mergeable as PrDetail["mergeable"]) ?? null,
  checks: r.checks_state ? { state: r.checks_state as PrDetail["checks"]["state"], total: r.checks_total, failed: r.checks_failed, pending: r.checks_pending } : null,
  reviewDecision: (r.review_decision as PrDetail["reviewDecision"]) ?? null,
  myReview: r.my_review,
  closingIssues: json<string[]>(r.closing_issues, []),
  detailHead: r.detail_head,
  detailUpdatedAt: r.detail_updated_at,
  detailAt: r.detail_at,
  seenAt: r.seen_at,
});

export function projectsCache(db: Db) {
  return {
    prs(repos?: string[]): CachedPr[] {
      const rows = db.prepare("SELECT * FROM gh_open_prs ORDER BY repo, number").all() as unknown as PrRow[];
      const want = repos ? new Set(repos.map((r) => r.toLowerCase())) : null;
      return rows.filter((r) => !want || want.has(r.repo.toLowerCase())).map(toPr);
    },

    /** Open PRs of these repos: the rail count. */
    count(repos: string[]): number {
      if (!repos.length) return 0;
      const want = new Set(repos.map((r) => r.toLowerCase()));
      return (db.prepare("SELECT repo, COUNT(*) AS n FROM gh_open_prs GROUP BY repo").all() as { repo: string; n: number }[]).reduce((n, r) => n + (want.has(r.repo.toLowerCase()) ? r.n : 0), 0);
    },

    repoRead(repo: string): RepoRead | null {
      const r = db.prepare("SELECT * FROM gh_repo_reads WHERE repo = ?").get(repo) as
        | { repo: string; etag: string | null; read_at: string; pr_count: number; truncated: number }
        | undefined;
      return r ? { repo: r.repo, etag: r.etag, readAt: r.read_at, prCount: r.pr_count, truncated: Boolean(r.truncated) } : null;
    },

    /** Drop what a config change left behind: PRs and reads of repos, boards and items of projects no longer configured. */
    prune(repos: string[], projects: string[]): void {
      tx(db, () => {
        const keepRepos = new Set(repos.map((r) => r.toLowerCase()));
        for (const { repo } of db.prepare("SELECT DISTINCT repo FROM gh_open_prs UNION SELECT repo FROM gh_repo_reads").all() as { repo: string }[]) {
          if (keepRepos.has(repo.toLowerCase())) continue;
          db.prepare("DELETE FROM gh_open_prs WHERE repo = ?").run(repo);
          db.prepare("DELETE FROM gh_repo_reads WHERE repo = ?").run(repo);
        }
        const keepProjects = new Set(projects);
        for (const { project } of db.prepare("SELECT project FROM gh_boards UNION SELECT DISTINCT project FROM gh_board_items").all() as { project: string }[]) {
          if (keepProjects.has(project)) continue;
          db.prepare("DELETE FROM gh_board_items WHERE project = ?").run(project);
          db.prepare("DELETE FROM gh_boards WHERE project = ?").run(project);
        }
      });
    },

    repoReads(): RepoRead[] {
      return (db.prepare("SELECT * FROM gh_repo_reads ORDER BY repo").all() as { repo: string; etag: string | null; read_at: string; pr_count: number; truncated: number }[]).map((r) => ({
        repo: r.repo,
        etag: r.etag,
        readAt: r.read_at,
        prCount: r.pr_count,
        truncated: Boolean(r.truncated),
      }));
    },

    /** A 304: the list did not change; only the read time moves. */
    touchRepo(repo: string, now = new Date()): void {
      db.prepare("UPDATE gh_repo_reads SET read_at = ? WHERE repo = ?").run(nowIso(now), repo);
    },

    /**
     * Replace one repo's open PRs with a complete list read. List fields are overwritten; the detail block of a PR
     * that is still open is kept (the reader decides whether it is still current). PRs gone from the list are deleted.
     * Returns whether anything a screen shows changed.
     */
    replaceRepo(repo: string, prs: OpenPr[], read: { etag: string | null; truncated: boolean }, now = new Date()): boolean {
      return tx(db, () => {
        const before = new Map((db.prepare("SELECT number, updated_at, title, draft FROM gh_open_prs WHERE repo = ?").all(repo) as { number: number; updated_at: string; title: string; draft: number }[]).map((r) => [r.number, r]));
        let changed = before.size !== prs.length;
        const at = nowIso(now);
        const up = db.prepare(`INSERT INTO gh_open_prs (repo, number, title, url, author, draft, created_at, updated_at, head_sha, head_ref, base_ref, body, requested, seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (repo, number) DO UPDATE SET title = excluded.title, url = excluded.url, author = excluded.author, draft = excluded.draft,
            created_at = excluded.created_at, updated_at = excluded.updated_at, head_sha = excluded.head_sha, head_ref = excluded.head_ref,
            base_ref = excluded.base_ref, body = excluded.body, requested = excluded.requested, seen_at = excluded.seen_at`);
        for (const p of prs) {
          const b = before.get(p.number);
          if (!b || b.updated_at !== p.updatedAt || b.title !== p.title || Boolean(b.draft) !== p.draft) changed = true;
          up.run(repo, p.number, p.title, p.url, p.author, p.draft ? 1 : 0, p.createdAt, p.updatedAt, p.headSha, p.headRef, p.baseRef, p.body, JSON.stringify(p.requested), at);
        }
        const keep = new Set(prs.map((p) => p.number));
        for (const n of before.keys()) if (!keep.has(n)) db.prepare("DELETE FROM gh_open_prs WHERE repo = ? AND number = ?").run(repo, n);
        db.prepare(`INSERT INTO gh_repo_reads (repo, etag, read_at, pr_count, truncated) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (repo) DO UPDATE SET etag = excluded.etag, read_at = excluded.read_at, pr_count = excluded.pr_count, truncated = excluded.truncated`).run(
          repo,
          read.etag,
          at,
          prs.length,
          read.truncated ? 1 : 0,
        );
        return changed;
      });
    },

    /**
     * Store the detail block of PRs still in the cache, stamped with the head GitHub answered for and the PR's
     * updated_at as the list read last saw it. Returns whether anything a screen shows changed.
     */
    setDetails(details: PrDetail[], now = new Date()): boolean {
      return tx(db, () => {
        let changed = false;
        const get = db.prepare("SELECT mergeable, checks_state, checks_failed, checks_total, review_decision, my_review, closing_issues FROM gh_open_prs WHERE repo = ? AND number = ?");
        const set = db.prepare(`UPDATE gh_open_prs SET mergeable = ?, checks_state = ?, checks_total = ?, checks_failed = ?, checks_pending = ?, review_decision = ?, my_review = ?,
          closing_issues = ?, detail_head = ?, detail_updated_at = updated_at, detail_at = ? WHERE repo = ? AND number = ?`);
        for (const d of details) {
          const prev = get.get(d.repo, d.number) as Record<string, unknown> | undefined;
          if (!prev) continue;
          const closing = JSON.stringify(d.closingIssues);
          if (
            prev.mergeable !== d.mergeable ||
            prev.checks_state !== d.checks.state ||
            prev.checks_failed !== d.checks.failed ||
            prev.checks_total !== d.checks.total ||
            prev.review_decision !== d.reviewDecision ||
            prev.my_review !== d.myReview ||
            prev.closing_issues !== closing
          )
            changed = true;
          set.run(d.mergeable, d.checks.state, d.checks.total, d.checks.failed, d.checks.pending, d.reviewDecision, d.myReview, closing, d.headSha, nowIso(now), d.repo, d.number);
        }
        return changed;
      });
    },

    board(project: string): CachedBoard | null {
      const r = db.prepare("SELECT * FROM gh_boards WHERE project = ?").get(project) as
        | { project: string; owner: string; number: number; title: string; url: string; status_options: string; item_count: number; read_at: string }
        | undefined;
      return r
        ? { project: r.project, owner: r.owner, number: r.number, title: r.title, url: r.url, statusOptions: json<string[]>(r.status_options, []), itemCount: r.item_count, readAt: r.read_at }
        : null;
    },

    boardItems(project: string): BoardItem[] {
      return (
        db.prepare("SELECT * FROM gh_board_items WHERE project = ? ORDER BY rowid").all(project) as {
          item_id: string;
          content_type: BoardItem["contentType"];
          repo: string | null;
          number: number | null;
          title: string;
          url: string | null;
          state: string | null;
          status: string | null;
          linked_prs: string;
        }[]
      ).map((r) => ({
        itemId: r.item_id,
        contentType: r.content_type,
        repo: r.repo,
        number: r.number,
        title: r.title,
        url: r.url,
        state: r.state,
        status: r.status,
        linkedPrs: json<string[]>(r.linked_prs, []),
      }));
    },

    /** Replace a board and all its items with a complete read. Returns whether anything a screen shows changed. */
    replaceBoard(project: string, b: Pick<CachedBoard, "owner" | "number">, read: Pick<BoardRead, "title" | "url" | "statusOptions" | "items">, now = new Date()): boolean {
      return tx(db, () => {
        const sig = (items: BoardItem[]) => items.map((i) => `${i.itemId}|${i.status ?? ""}|${i.state ?? ""}|${i.title}|${i.linkedPrs.join(",")}`).sort().join("\n");
        const prevBoard = this.board(project);
        const changed = !prevBoard || sig(this.boardItems(project)) !== sig(read.items) || JSON.stringify(prevBoard.statusOptions) !== JSON.stringify(read.statusOptions);
        db.prepare("DELETE FROM gh_board_items WHERE project = ?").run(project);
        const ins = db.prepare("INSERT INTO gh_board_items (project, item_id, content_type, repo, number, title, url, state, status, linked_prs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        for (const i of read.items) ins.run(project, i.itemId, i.contentType, i.repo, i.number, i.title, i.url, i.state, i.status, JSON.stringify(i.linkedPrs));
        db.prepare(`INSERT INTO gh_boards (project, owner, number, title, url, status_options, item_count, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (project) DO UPDATE SET owner = excluded.owner, number = excluded.number, title = excluded.title, url = excluded.url,
            status_options = excluded.status_options, item_count = excluded.item_count, read_at = excluded.read_at`).run(
          project,
          b.owner,
          b.number,
          read.title,
          read.url,
          JSON.stringify(read.statusOptions),
          read.items.length,
          nowIso(now),
        );
        return changed;
      });
    },
  };
}

export type ProjectsCache = ReturnType<typeof projectsCache>;
