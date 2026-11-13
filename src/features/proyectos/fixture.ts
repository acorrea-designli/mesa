// Seeded cache for the /proyectos tests and screenshots (t152): the mock's data (DRE-RMS-backlog and Prospec as of
// 2026-11-13, .impeccable/mocks/screens/proyectos.html) written into the reader's cache tables and Mesa's tickets,
// reviews and review items, so the screen renders every state with no GitHub at all. Never imported by the app: only
// by tests and by a scratch database for Playwright (MESA_DB pointed at a copy, never data/mesa.db).
import type { Repos } from "@/lib/repo";
import { projectsCache } from "@/lib/integrations/projects-cache";
import type { BoardItem, OpenPr, PrDetail } from "@/lib/integrations/projects-gh";

export interface FixtureOptions {
  /** Andrés's GitHub login (his own PRs and the reviews requested from him). */
  login: string;
  /** GitHub rate-limited until 11:05: the reader's health row is degraded (Estados B). */
  limited?: boolean;
  /** Prospec with no open PRs. */
  emptyProspec?: boolean;
  /** Enough PRs to hit every cap: 8 PRs on GHI-484 and 14 more issues in In Development. */
  many?: boolean;
}

type St = "ok" | "blk" | "rev" | "mine";
type Ck = "bad" | "run" | "conf" | undefined;
interface P {
  r: string;
  n: number;
  t: string;
  a: string;
  d: number;
  i?: number;
  st?: St;
  ck?: Ck;
  gr?: "ap" | "ch" | "rq";
  draft?: boolean;
  train?: boolean;
  ticket?: boolean;
}

const DRE = "7-Arrow";
const DRE_ISSUES: [number, string, string | null][] = [
  [484, "Dispositions: screen fixes after review", "In Development"],
  [471, "Dispositions: add a county to each court", "In Development"],
  [483, "Dispositions: hardening after merge", "In Development"],
  [468, "DRE Connect: enable a tenant without a contract number", "In QA"],
  [472, "Only a Super Admin can change a user's state", null],
  [473, "Audit log: certification status and date changes", null],
  [474, "CEU: lock attachments and edits on approved credits", null],
  [475, "Audit log: roster edits on approved courses", null],
];

const dre = (login: string): P[] => [
  { r: "frontend", n: 610, t: "Super Admin state filter and column on Dispositions (GHI-484)", a: "jrodriguez", d: 1, i: 484, st: "ok", gr: "ap", ticket: true },
  { r: "frontend", n: 609, t: "Courts cover several counties on Disposition (GHI-471)", a: "jrodriguez", d: 1, i: 471, st: "ok", gr: "ap", ticket: true },
  { r: "backend", n: 490, t: "Super Admin state filter, lighter evaluation list (GHI-484)", a: "jrodriguez", d: 1, i: 484, st: "ok", gr: "ap", ticket: true },
  { r: "backend", n: 489, t: "Counties as a platform module; a disposition court (GHI-471)", a: "jrodriguez", d: 1, i: 471, st: "ok", gr: "ap", ticket: true },
  { r: "frontend", n: 608, t: "Disposition screen fixes: module-off gating (GHI-484)", a: "jrodriguez", d: 1, i: 484, st: "blk", ck: "bad", gr: "ch", ticket: true },
  { r: "backend", n: 488, t: "Disposition hardening: never fail a submit (GHI-483)", a: "jrodriguez", d: 1, i: 483, st: "ok", gr: "ap", ticket: true },
  { r: "backend", n: 487, t: "Bump fast-xml-parser and @aws-sdk/xml-builder", a: "dependabot", d: 2, st: "ok", gr: "ap", ticket: true },
  { r: "backend", n: 484, t: "Drop the transitional contractVerified field (GHI-468)", a: "jrodriguez", d: 3, i: 468, st: "blk", draft: true, ck: "run", gr: "ch", ticket: true },
  { r: "backend", n: 482, t: "Lock the evidence on approved CEU credits (GHI-474)", a: "7AIDEV", d: 3, i: 474, st: "ok", gr: "ap", ticket: true },
  { r: "frontend", n: 600, t: "State is read-only on the edit-user form (GHI-472)", a: "7AIDEV", d: 3, i: 472, st: "ok", gr: "ap", ticket: true },
  { r: "backend", n: 481, t: "Only a Super Admin can change a user's state (GHI-472)", a: "7AIDEV", d: 3, i: 472, st: "ok", gr: "ap", ticket: true },
  { r: "backend", n: 480, t: "Audit certification status and date changes (GHI-473)", a: "7AIDEV", d: 3, i: 473, st: "ok", gr: "ap", ticket: true },
  { r: "backend", n: 479, t: "Record who and what changed when a course roster changes (GHI-475)", a: "7AIDEV", d: 3, i: 475, st: "ok", gr: "ap", ticket: true },
  { r: "frontend", n: 598, t: "Release 9 November 2026 (v1.15.0)", a: "jrodriguez", d: 4, st: "ok", gr: "ap", ticket: true },
  { r: "backend", n: 477, t: "Release 9 November 2026 (v1.15.0)", a: "jrodriguez", d: 4, st: "ok", gr: "ap", ticket: true },
  { r: "frontend", n: 587, t: "Fix sign-in sending users to Access Denied", a: "7AIDEV", d: 8, st: "ok", gr: "ap", ticket: true },
  { r: "frontend", n: 586, t: "Let Super Admins edit the default recertification", a: "7AIDEV", d: 8, st: "ok", gr: "ap", ticket: true },
  { r: "frontend", n: 567, t: "Fail the build if emitted HTML would ship an inline script", a: "7AIDEV", d: 13, st: "ok", gr: "ap", ticket: true },
  { r: "frontend", n: 566, t: "View-as lands on Access Denied instead of the dashboard", a: "7AIDEV", d: 13, st: "ok", gr: "ap", ticket: true },
  { r: "infra", n: 70, t: "Not-found page in place of S3's raw XML error", a: "7AIDEV", d: 13, st: "ok", gr: "ap", ticket: true },
  { r: "frontend", n: 565, t: "Static not-found page in place of S3's raw XML error", a: "7AIDEV", d: 13, st: "ok", gr: "ap", ticket: true },
  { r: "backend", n: 452, t: "Seeders: never create or change accounts in production", a: "7AIDEV", d: 14, st: "rev", ck: "conf", gr: "rq" },
  { r: "backend", n: 439, t: "Labs: backfill Midwest Regional Forensic Laboratory", a: "7AIDEV", d: 15, st: "rev", gr: "rq" },
  { r: "frontend", n: 546, t: "Approval dashboard: open evaluations in the same tab", a: "7AIDEV", d: 16, st: "rev", gr: "rq" },
  { r: "frontend", n: 492, t: "PWA: report failed service-worker update checks", a: "7AIDEV", d: 25, st: "rev", gr: "rq" },
  { r: "infra", n: 61, t: "Bastion: remove tweak and the terraform key pair", a: login, d: 29, st: "mine", gr: "rq" },
];

const PRO = "designli";
const prospec = (): P[] => [
  { r: "backend", n: 46, t: "Manager assign and reassign, salesperson availability (#219)", a: "ialfaro", d: 0, i: 219, st: "ok", gr: "ap", ck: "run", ticket: true },
  { r: "backend", n: 44, t: "Cortex: go-live mission for December 7 and the subscription decision", a: "dsanchez", d: 4, st: "ok", gr: "ap", ticket: true },
  { r: "backend", n: 3, t: "Create staging PR", a: "github-actions", d: 227, train: true },
  { r: "frontend", n: 2, t: "Create staging PR", a: "github-actions", d: 227, train: true },
  { r: "admin", n: 1, t: "Create staging PR", a: "github-actions", d: 67, train: true },
];

const DAY = 86_400_000;

/** Writes the fixture into `r` at `now`. Returns the PR count per project. */
export function seedProyectosFixture(r: Repos, now: Date, o: FixtureOptions): { dre: number; prospec: number } {
  const c = projectsCache(r.db);
  const iso = (days: number) => new Date(now.getTime() - days * DAY - 3 * 3_600_000).toISOString();
  const read = new Date(now.getTime() - 2 * 60_000);
  const lead = "lead";
  r.sessions.touch({ id: lead }, now);

  const dreList = dre(o.login);
  if (o.many) {
    for (let k = 0; k < 6; k++) dreList.push({ r: k % 2 ? "frontend" : "backend", n: 700 + k, t: `Disposition follow-up ${k + 1} (GHI-484)`, a: "jrodriguez", d: 2, i: 484, st: "rev", gr: "rq" });
    for (let k = 0; k < 14; k++) dreList.push({ r: "backend", n: 720 + k, t: `Evaluation list: step ${k + 1} (GHI-${500 + k})`, a: "7AIDEV", d: 5, i: 500 + k, gr: "rq" });
  }
  const issues = [...DRE_ISSUES, ...(o.many ? Array.from({ length: 14 }, (_, k): [number, string, string | null] => [500 + k, `Evaluation list, part ${k + 1}`, "In Development"]) : [])];
  const items: BoardItem[] = issues.map(([n, t, s]) => ({ itemId: `I${n}`, contentType: "Issue", repo: `${DRE}/dre-backlog`, number: n, title: t, url: `https://github.com/${DRE}/dre-backlog/issues/${n}`, state: "OPEN", status: s, linkedPrs: [] }));
  for (let k = 0; k < 44; k++) items.push({ itemId: `T${k}`, contentType: "Issue", repo: `${DRE}/dre-backlog`, number: 300 + k, title: `Backlog ${k}`, url: null, state: "OPEN", status: "To-do", linkedPrs: [] });
  for (let k = 0; k < 12; k++) items.push({ itemId: `D${k}`, contentType: "Issue", repo: `${DRE}/dre-backlog`, number: 200 + k, title: `Done ${k}`, url: null, state: "CLOSED", status: "Done", linkedPrs: [] });

  write(r, c, DRE, ["dre-backend", "dre-frontend", "dre-infra", "dre-connect-intake"], dreList, o.login, iso, read, now);
  c.replaceBoard(
    "dre",
    { owner: DRE, number: 2 },
    { title: "DRE-RMS-backlog", url: `https://github.com/orgs/${DRE}/projects/2`, statusOptions: ["Blocked", "To-do", "Copied to Dev Jira", "In Development", "In QA", "Approved by QA", "Ready for UAT", "Approved", "Done"], items },
    read,
  );

  const proList = o.emptyProspec ? [] : prospec();
  write(r, c, PRO, ["prospec-backend", "prospec-frontend", "prospec-admin"], proList, o.login, iso, read, now);
  const proItems: BoardItem[] = [
    { itemId: "P219", contentType: "Issue", repo: `${PRO}/prospec-backlog`, number: 219, title: "Salesperson workspace: estimates pipeline, estimate detail and team queue", url: `https://github.com/${PRO}/prospec-backlog/issues/219`, state: "OPEN", status: "In QA", linkedPrs: [] },
    { itemId: "P245", contentType: "Issue", repo: `${PRO}/prospec-backlog`, number: 245, title: "Team queue: reassign from the estimate", url: null, state: "OPEN", status: "In QA", linkedPrs: [] },
    { itemId: "P250", contentType: "Issue", repo: `${PRO}/prospec-backlog`, number: 250, title: "Visits: overlap check", url: null, state: "OPEN", status: "In Development", linkedPrs: [] },
  ];
  for (let k = 0; k < 36; k++) proItems.push({ itemId: `PT${k}`, contentType: "Issue", repo: `${PRO}/prospec-backlog`, number: 100 + k, title: `Todo ${k}`, url: null, state: "OPEN", status: "Todo", linkedPrs: [] });
  for (let k = 0; k < 64; k++) proItems.push({ itemId: `PU${k}`, contentType: "Issue", repo: `${PRO}/prospec-backlog`, number: 300 + k, title: `UAT ${k}`, url: null, state: "OPEN", status: "Ready for UAT", linkedPrs: [] });
  c.replaceBoard(
    "prospec",
    { owner: PRO, number: 45 },
    { title: "Prospec", url: `https://github.com/orgs/${PRO}/projects/45`, statusOptions: ["Backlog", "Todo", "Blocked", "In Development", "Pending PR approval", "Ready for QA", "In QA", "Ready for UAT", "Done"], items: proItems },
    read,
  );

  r.sources.set(
    "github_projects",
    o.limited
      ? { health: "degraded", note: "límite de API · 11:05", lastChecked: now.toISOString(), backoffUntil: new Date(now.getTime() + 25 * 60_000).toISOString(), cadenceS: 120 }
      : { health: "ok", note: "", lastChecked: now.toISOString(), backoffUntil: null, cadenceS: 120 },
    now,
  );
  return { dre: dreList.length, prospec: proList.length };
}

function write(r: Repos, c: ReturnType<typeof projectsCache>, owner: string, repos: string[], list: P[], login: string, iso: (d: number) => string, read: Date, now: Date) {
  for (const name of repos) {
    const repo = `${owner}/${name}`;
    const short = name.replace(/^(dre|prospec)-/, "");
    const mine = list.filter((p) => p.r === short);
    const open: OpenPr[] = mine.map((p) => ({
      repo,
      number: p.n,
      title: p.t,
      url: `https://github.com/${repo}/pull/${p.n}`,
      author: p.a,
      draft: !!p.draft,
      createdAt: iso(p.d),
      updatedAt: iso(Math.max(0, p.d - 1)),
      headSha: `sha${p.n}`,
      headRef: p.train ? "develop" : p.i ? `feat/ghi-${p.i}-${p.n}` : `fix/${p.n}`,
      baseRef: p.train ? "staging" : "develop",
      body: "",
      requested: p.st === "rev" ? [login] : [],
    }));
    c.replaceRepo(repo, open, { etag: `"${name}"`, truncated: false }, read);
    const details: PrDetail[] = mine
      .filter((p) => !p.train)
      .map((p) => ({
        repo,
        number: p.n,
        headSha: `sha${p.n}`,
        mergeable: p.ck === "conf" ? "CONFLICTING" : "MERGEABLE",
        checks: p.ck === "bad" ? { state: "fail", total: 4, failed: 1, pending: 0 } : p.ck === "run" ? { state: "pending", total: 4, failed: 0, pending: 2 } : { state: "pass", total: 4, failed: 0, pending: 0 },
        reviewDecision: p.gr === "ap" ? "APPROVED" : p.gr === "ch" ? "CHANGES_REQUESTED" : "REVIEW_REQUIRED",
        myReview: null,
        closingIssues: [],
      }));
    c.setDetails(details, read);
    // Mesa: a review ticket per PR he reviewed (approved, or open with a blocker).
    for (const p of mine) {
      if (!p.ticket) continue;
      const t = r.tickets.create({ direction: "andres_asks", title: `Review ${name}#${p.n}`, ownerSession: "lead", project: name }, now);
      r.reviews.open(t.ref, { repo, pr: p.n, sha: `sha${p.n}` }, now);
      if (p.st === "blk") r.reviews.upsertFinding(t.ref, { repo, pr: p.n, label: "blocker", at: "disposition.constant.ts:79", summary: "Un registro cuya única respuesta es None vuelve como no_impairment_charges y aquí nada lo etiqueta.", sha: `sha${p.n}` }, now);
      else r.db.prepare("UPDATE reviews SET state = 'approved' WHERE repo = ? AND pr = ?").run(repo, p.n);
    }
  }
}
