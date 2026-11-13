// Reads what /proyectos shows, from SQLite only (the cache of projects-reader.ts plus Mesa's reviews, tickets and
// review items), never from GitHub: GET /api/proyectos calls loadProjectsPayload.
import type { Db } from "../db/sqlite";
import { mapHealth, type SourceHealth } from "@/components/shell/health";
import type { Repos } from "../repo";
import { healthContext } from "./health";
import { GH_USER } from "./gh";
import { allRepos, loadProjects, type LoadedProjects } from "./projects-config";
import { projectsCache } from "./projects-cache";
import { buildProjectView, prKey, type MesaLink, type MesaLinks, type MesaReview, type ProjectView, type TicketChip } from "./projects-join";

const PR_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/i;
const PR_EXT = /^pr:([\w.-]+\/[\w.-]+)#(\d+)$/i;

/** Mesa's side of every PR in `keys` ("owner/repo#n", lower case): review, tickets, open review request. Sample rows are left out. */
export function mesaLinks(db: Db, keys: Set<string>): MesaLinks {
  const out: MesaLinks = new Map();
  const link = (k: string): MesaLink | null => {
    if (!keys.has(k)) return null;
    let l = out.get(k);
    if (!l) out.set(k, (l = { review: null, tickets: [], requested: false }));
    return l;
  };

  const tickets = new Map(
    (db.prepare("SELECT id, ref, title, status, updated_at FROM tickets WHERE is_sample = 0").all() as { id: string; ref: string; title: string; status: string; updated_at: string }[]).map((t) => [
      t.id,
      { ref: t.ref, title: t.title, status: t.status, updatedAt: t.updated_at } satisfies TicketChip,
    ]),
  );
  const addTicket = (k: string, ticketId: string | null) => {
    const t = ticketId ? tickets.get(ticketId) : undefined;
    const l = t ? link(k) : null;
    if (t && l && !l.tickets.some((x) => x.ref === t.ref)) l.tickets.push(t);
  };

  // Reviews (one per PR) with their open findings.
  const findings = new Map<string, { blockers: number; findings: number }>();
  for (const f of db.prepare("SELECT review_id, label FROM review_findings WHERE state = 'open'").all() as { review_id: string; label: string }[]) {
    const c = findings.get(f.review_id) ?? { blockers: 0, findings: 0 };
    c.findings++;
    if (f.label === "blocker") c.blockers++;
    findings.set(f.review_id, c);
  }
  for (const r of db.prepare("SELECT id, repo, pr, state, head_sha, ticket_id FROM reviews WHERE is_sample = 0").all() as {
    id: string;
    repo: string;
    pr: number;
    state: MesaReview["state"];
    head_sha: string;
    ticket_id: string | null;
  }[]) {
    const k = prKey(r.repo, r.pr);
    const l = link(k);
    if (!l) continue;
    l.review = { id: r.id, state: r.state, headSha: r.head_sha, ...(findings.get(r.id) ?? { blockers: 0, findings: 0 }) };
    addTicket(k, r.ticket_id);
  }

  // GitHub items of PRs: an open review request, and the tickets that point at the item.
  const itemKey = new Map<string, string>();
  for (const it of db.prepare("SELECT id, external_id, kind, station FROM items WHERE source = 'github' AND is_sample = 0").all() as { id: string; external_id: string; kind: string; station: string }[]) {
    const m = PR_EXT.exec(it.external_id);
    if (!m) continue;
    const k = prKey(m[1]!, Number(m[2]));
    itemKey.set(it.id, k);
    if (it.kind === "pr_review" && it.station !== "done") {
      const l = link(k);
      if (l) l.requested = true;
    }
  }
  for (const t of db.prepare("SELECT id, item_id FROM tickets WHERE item_id IS NOT NULL AND is_sample = 0").all() as { id: string; item_id: string }[]) {
    const k = itemKey.get(t.item_id);
    if (k) addTicket(k, t.id);
  }
  for (const ref of db.prepare("SELECT ticket_id, ref_type, target FROM ticket_refs WHERE ref_type IN ('url', 'item')").all() as { ticket_id: string; ref_type: string; target: string }[]) {
    if (ref.ref_type === "item") {
      const k = itemKey.get(ref.target);
      if (k) addTicket(k, ref.ticket_id);
      continue;
    }
    const m = PR_URL.exec(ref.target);
    if (m) addTicket(prKey(m[1]!, Number(m[2])), ref.ticket_id);
  }

  // Open tickets first, then the most recently touched.
  const open = (t: TicketChip) => (t.status === "closed" ? 1 : 0);
  for (const l of out.values()) l.tickets.sort((a, b) => open(a) - open(b) || b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/** The first open blocker of a Mesa review ("path:line" and its summary): the quote on the phone's PR screen. */
export function blockerQuote(db: Db, reviewId: string): { at: string; text: string } | null {
  const f = db.prepare("SELECT at, summary FROM review_findings WHERE review_id = ? AND state = 'open' AND label = 'blocker' ORDER BY n LIMIT 1").get(reviewId) as
    | { at: string; summary: string }
    | undefined;
  return f ? { at: f.at, text: f.summary } : null;
}

export interface ProjectsPayload {
  projects: { key: string; name: string; boardUrl: string; openPrs: number }[];
  /** Open PRs across every configured repo: the rail count. */
  openPrs: number;
  view: ProjectView | null;
  /** The reader's health row (Estados B), mapped like the rail. */
  health: SourceHealth;
  configError: string | null;
}

/** One project's view (the first configured one when `key` is absent), the project tabs and the rail count. Null view for an unknown key. */
export function loadProjectsPayload(r: Repos, key: string | null, o: { login?: string; config?: LoadedProjects; now?: Date } = {}): ProjectsPayload {
  const { projects, error } = o.config ?? loadProjects();
  const cache = projectsCache(r.db);
  const prs = cache.prs(allRepos(projects));
  const count = (repos: string[]) => {
    const want = new Set(repos.map((x) => x.toLowerCase()));
    return prs.filter((x) => want.has(x.repo.toLowerCase())).length;
  };
  const p = key ? projects.find((x) => x.key === key) : projects[0];
  let view: ProjectView | null = null;
  if (p) {
    const mine = prs.filter((x) => p.repos.some((rp) => rp.toLowerCase() === x.repo.toLowerCase()));
    view = buildProjectView({
      project: p,
      board: cache.board(p.key),
      items: cache.boardItems(p.key),
      prs: mine,
      mesa: mesaLinks(r.db, new Set(mine.map((x) => prKey(x.repo, x.number)))),
      login: o.login ?? GH_USER,
      repoReads: cache.repoReads(),
    });
  }
  return {
    projects: projects.map((x) => ({ key: x.key, name: x.name, boardUrl: x.boardUrl, openPrs: count(x.repos) })),
    openPrs: prs.length,
    view,
    health: mapHealth(r.sources.get("github_projects"), healthContext(r, o.now ?? new Date())),
    configError: error,
  };
}
