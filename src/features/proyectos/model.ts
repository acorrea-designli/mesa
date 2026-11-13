// The /proyectos screen model (t152 PR 2, Proyectos A "Línea del proyecto" in .impeccable/mocks/screens/proyectos.*).
// Pure: from the GET /api/proyectos payload (the SQLite cache joined with Mesa) and the URL to everything the screen
// draws, with every text already formatted on the server (no clock or locale work in the browser). The band is laid out
// here too: stations, lines, ticks, the "Sin issue" spur and the "Tren a staging" track, desktop and the phone corridor.
import type { ProjectsPayload } from "@/lib/integrations/projects-view";
import type { IssueView, PrView, ProjectView, StationView } from "@/lib/integrations/projects-join";
import { clock, ago } from "@/features/hoy/format";

// Station keys of projects-join.ts (kept as literals: that module is server only).
export const SIN_ESTADO = "sin-estado";
export const SIN_ISSUE = "sin-issue";
export const TREN = "tren";

// ---------- the URL ----------

export type Vista = "estacion" | "todo" | "te-tocan";
export interface PjQuery {
  proyecto: string | null;
  estacion: string | null;
  vista: Vista;
  pr: string | null;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseQuery(raw: Record<string, string | string[] | undefined>): PjQuery {
  const proyecto = one(raw.proyecto);
  const estacion = one(raw.estacion);
  const vista = one(raw.vista);
  const pr = one(raw.pr);
  return {
    proyecto: proyecto && /^[a-z0-9-]{1,40}$/.test(proyecto) ? proyecto : null,
    estacion: estacion && estacion.length <= 80 ? estacion : null,
    vista: vista === "todo" || vista === "te-tocan" ? vista : "estacion",
    pr: pr && /^[\w.-]+\/[\w.-]+#\d+$/.test(pr) && pr.length <= 200 ? pr.toLowerCase() : null,
  };
}

/** /proyectos with `q` changed by `over`; the defaults (no project, the default station, "estacion") stay out of the URL. */
export function pjHref(q: PjQuery, over: Partial<PjQuery> = {}): string {
  const n = { ...q, ...over };
  const s = new URLSearchParams();
  if (n.proyecto) s.set("proyecto", n.proyecto);
  if (n.estacion) s.set("estacion", n.estacion);
  if (n.vista !== "estacion") s.set("vista", n.vista);
  if (n.pr) s.set("pr", n.pr);
  const qs = s.toString();
  return qs ? `/proyectos?${qs}` : "/proyectos";
}

/** A Mesa ticket's address (the tickets screen opens it from ?t=; there is no /tickets/<ref> page). */
const ticketHref = (ref: string) => `/tickets?t=${encodeURIComponent(ref)}`;

// ---------- the screen ----------

export type Icon = "check" | "stop" | "eye" | "mine" | "ckok" | "ckbad" | "ckrun" | "conf" | "none";

export interface Cell {
  icon: Icon | null;
  text: string;
  /** Ink and bold: what asks for attention (a failing check, conflicts, changes requested). Never a colour. */
  strong: boolean;
  sub?: string;
}

export interface Tag {
  kind: "draft" | "blk" | "ok" | "plain";
  icon: Icon | null;
  text: string;
}

export interface Row {
  key: string;
  number: number;
  title: string;
  url: string;
  author: string;
  /** "abierta hace 3 días" */
  age: string;
  /** "3 días": the phone's short age chip. */
  ageShort: string;
  repo: string;
  /** The line label: "backend". */
  line: string;
  /** "Dato de las 10:38" while GitHub is limited. */
  stale: string | null;
  checks: Cell;
  github: Cell;
  tags: Tag[];
  ticket: { ref: string; href: string; title: string } | null;
  moreTickets: number;
  selected: boolean;
  /** Selects the row (the phone opens it full screen). */
  href: string;
  teToca: boolean;
  draft: boolean;
  blocker: boolean;
}

export type Block =
  | {
      kind: "issue";
      key: string;
      label: string;
      title: string;
      url: string | null;
      interchange: boolean;
      /** "2 PRs · dre-backend + dre-frontend" */
      meta: string;
      status: string;
      statusNone: boolean;
      rows: Row[];
      cap: number;
      more: string;
    }
  | { kind: "group"; key: string; title: string; note: string; rows: Row[]; cap: number; fold: boolean; more: string }
  | { kind: "train"; key: string; title: string; sub: string; prs: { label: string; url: string }[]; url: string | null };

export interface TabLink {
  key: string;
  label: string;
  count: number;
  href: string;
  on: boolean;
}

export interface BandTick {
  x: number;
  y: number;
  you: boolean;
  draft: boolean;
  blocker: boolean;
  ring: boolean;
  title: string;
}

export interface BandStop {
  x: number;
  label: string;
  connector: { x: number; y1: number; y2: number } | null;
  ticks: BandTick[];
}

export interface BandStation {
  key: string;
  name: string;
  count: string;
  x: number;
  on: boolean;
  quiet: boolean;
  dashed: boolean;
  href: string;
}

export interface BandModel {
  W: number;
  H: number;
  L: number;
  lines: { label: string; y: number; quiet: boolean }[];
  dotted: boolean;
  empty: boolean;
  capTop: number;
  capH: number;
  labelY: number;
  stations: BandStation[];
  stops: { station: string; dim: boolean; stops: BandStop[]; more: { x: number; text: string } | null }[];
  spur: { d: string; on: boolean; ticks: BandTick[]; more: { x: number; text: string } | null; labelX: number; note: string; noteX: number; href: string } | null;
  train: { d: string; on: boolean; ticks: BandTick[]; labelX: number; note: string; noteX: number; href: string } | null;
  legend: boolean;
}

export interface CorridorModel {
  W: number;
  H: number;
  name: string;
  prev: { name: string; href: string } | null;
  next: { name: string; href: string } | null;
  lines: { y: number; quiet: boolean }[];
  dotted: boolean;
  cap: { x: number; y: number; h: number };
  labelY: number;
  stops: BandStop[];
  more: { x: number; text: string } | null;
}

export interface Detail {
  back: { label: string; href: string };
  pos: string;
  kind: string;
  title: string;
  by: string;
  url: string;
  estado: { icon: Icon; title: string; text: string; quote?: { at: string; text: string } }[];
  issue: { label: string; status: string; statusNone: boolean; interchange: boolean; siblings: string | null; url: string | null } | null;
  tickets: { ref: string; href: string; title: string; status: string }[];
}

export interface ProjectScreen {
  key: string;
  name: string;
  /** "7-Arrow / DRE-RMS-backlog" */
  path: string;
  boardUrl: string;
  sync: { limited: boolean; lead: string; strong: string; tail: string };
  notes: string[];
  band: BandModel;
  sel: { title: string; sub: string; tabs: TabLink[] };
  blocks: Block[];
  capBlocks: number;
  moreBlocks: string;
  empty: { title: string; text: string; actions: { label: string; href: string; external: boolean }[] } | null;
  phone: { readAgo: string; stations: TabLink[]; corridor: CorridorModel | null; detail: Detail | null };
}

export interface Screen {
  tabs: TabLink[];
  configError: string | null;
  project: ProjectScreen | null;
}

/** Context the page adds to the payload: the project's issue key prefix ("GHI-") and repo, the open blocker of the selected PR. */
export interface ScreenExtras {
  issuePrefix?: string;
  issueRepo?: string | null;
  blockerQuote?: { at: string; text: string } | null;
}

// ---------- caps ----------

export const CAP_ISSUE_ROWS = 5;
export const CAP_TE_TOCAN = 3;
export const CAP_GROUP_ROWS = 5;
export const CAP_BLOCKS = 12;
const SPUR_TICKS = 10;

// ---------- text ----------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const prs = (n: number) => plural(n, "PR", "PRs");
const issues = (n: number) => plural(n, "issue", "issues");

/** Days since `iso` at `now`: "hoy", "hace 1 día", "hace 3 días". */
export function daysAgo(iso: string, now: Date): { long: string; short: string } {
  const d = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000));
  if (d === 0) return { long: "hoy", short: "hoy" };
  return { long: d === 1 ? "hace 1 día" : `hace ${d} días`, short: d === 1 ? "1 día" : `${d} días` };
}

/** "and" list in Spanish: "a", "a y b", "a, b y c". */
const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/** Line labels: the repos' names without the prefix they all share ("dre-backend" -> "backend"). */
export function lineLabels(repos: string[]): Map<string, string> {
  const names = repos.map((r) => r.split("/")[1] ?? r);
  const dash = names.map((n) => n.indexOf("-"));
  const prefix = names.length > 1 && dash.every((d) => d > 0) && names.every((n) => n.slice(0, dash[0]! + 1) === names[0]!.slice(0, dash[0]! + 1)) ? dash[0]! + 1 : 0;
  return new Map(repos.map((r, i) => [r.toLowerCase(), names[i]!.slice(prefix) || names[i]!]));
}

/** "GHI-" from a pattern like \bGHI-(\d+)\b; "" when the keys are bare numbers. */
export function issuePrefixOf(issueKeys: string[]): string {
  for (const k of issueKeys) {
    const m = /^(?:\\b)?([A-Za-z][A-Za-z0-9]*-)\(/.exec(k);
    if (m) return m[1]!;
  }
  return "";
}

/** Approximate width of a text in the band (Hanken Grotesk). */
export const textW = (s: string, px: number, bold = false) => Math.ceil(s.length * px * (bold ? 0.58 : 0.54));

function checksCell(pr: PrView): Cell {
  if (!pr.checks) return { icon: "ckrun", text: "sin datos", strong: false };
  const c = pr.checks;
  const text =
    c.state === "fail" ? `fallan ${c.failed} de ${c.total}` : c.state === "pending" ? "corriendo" : c.state === "pass" ? "pasan" : "sin checks";
  const icon: Icon = c.state === "fail" ? "ckbad" : c.state === "pending" ? "ckrun" : c.state === "pass" ? "ckok" : "none";
  if (pr.conflicts) return { icon: "conf", text: "conflictos", strong: true, sub: text };
  return { icon, text, strong: c.state === "fail" };
}

function githubCell(pr: PrView): Cell {
  if (!pr.checks) return { icon: null, text: "sin datos", strong: false };
  if (pr.reviewDecision === "APPROVED") return { icon: "check", text: "Aprobada", strong: false };
  if (pr.reviewDecision === "CHANGES_REQUESTED") return { icon: "stop", text: "Cambios pedidos", strong: true };
  if (pr.reviewDecision === "REVIEW_REQUIRED") return { icon: null, text: "Review pendiente", strong: false };
  return { icon: null, text: "Sin review requerida", strong: false };
}

function tags(pr: PrView): Tag[] {
  const out: Tag[] = [];
  if (pr.draft) out.push({ kind: "draft", icon: null, text: "Borrador" });
  switch (pr.you) {
    case "tuya":
      out.push({ kind: "plain", icon: "mine", text: "Tuya" });
      break;
    case "bloqueante":
      out.push({ kind: "blk", icon: "stop", text: plural(pr.mesa?.blockers ?? 1, "bloqueante", "bloqueantes") });
      break;
    case "aprobaste":
      out.push({ kind: "ok", icon: "check", text: "Aprobaste · sin merge" });
      break;
    case "en-revision":
      out.push({ kind: "plain", icon: "eye", text: "En revisión" });
      break;
    case "sin-review":
      out.push({ kind: "plain", icon: "eye", text: "Sin tu review" });
      break;
  }
  return out;
}

// ---------- building ----------

interface Ctx {
  view: ProjectView;
  q: PjQuery;
  now: Date;
  lines: Map<string, string>;
  stale: string | null;
  byKey: Map<string, PrView>;
  issueLabel: (iv: IssueView) => string;
  limited: boolean;
}

function row(pr: PrView, c: Ctx): Row {
  const age = daysAgo(pr.createdAt, c.now);
  const [first, ...rest] = pr.tickets;
  return {
    key: pr.key,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.author,
    age: `abierta ${age.long}`,
    ageShort: age.short,
    repo: pr.repo.split("/")[1] ?? pr.repo,
    line: c.lines.get(pr.repo.toLowerCase()) ?? pr.repo,
    stale: c.stale,
    checks: checksCell(pr),
    github: githubCell(pr),
    tags: tags(pr),
    ticket: first ? { ref: first.ref, href: ticketHref(first.ref), title: first.title } : null,
    moreTickets: rest.length,
    selected: c.q.pr === pr.key,
    href: pjHref(c.q, { pr: pr.key }),
    teToca: pr.teToca,
    draft: pr.draft,
    blocker: pr.blocker,
  };
}

function issueBlock(iv: IssueView, list: PrView[], c: Ctx): Block {
  const repos = [...new Set(list.map((p) => p.repo.split("/")[1] ?? p.repo))];
  return {
    kind: "issue",
    key: iv.key,
    label: c.issueLabel(iv),
    title: iv.title,
    url: iv.url,
    interchange: iv.interchange,
    meta: `${prs(list.length)} · ${repos.join(" + ")}`,
    status: iv.station === SIN_ESTADO ? "Sin estado" : iv.station,
    statusNone: iv.station === SIN_ESTADO,
    rows: list.map((p) => row(p, c)),
    cap: CAP_ISSUE_ROWS,
    more: `${list.length - CAP_ISSUE_ROWS} más`,
  };
}

/** Issue blocks for the PRs in `list`, in the view's issue order (band order). */
function issueBlocks(list: PrView[], c: Ctx): Block[] {
  const keys = new Set(list.map((p) => p.key));
  return c.view.issues
    .map((iv) => ({ iv, mine: iv.prs.filter((k) => keys.has(k)).map((k) => c.byKey.get(k)!) }))
    .filter((x) => x.mine.length)
    .map((x) => issueBlock(x.iv, x.mine, c));
}

const RELEASE = /^\s*release\b.*?\(?\b(v?\d+(?:\.\d+){1,3})\b\)?/i;

/** The "Sin issue" spur as a list: te tocan first (capped), then each release, then what he approved, then the rest folded. */
function spurBlocks(list: PrView[], c: Ctx): Block[] {
  const out: Block[] = [];
  const you = list.filter((p) => p.teToca);
  const left = list.filter((p) => !p.teToca);
  const releases = new Map<string, PrView[]>();
  for (const p of left) {
    const m = RELEASE.exec(p.title);
    if (m) releases.set(m[1]!.replace(/^v?/, "v"), [...(releases.get(m[1]!.replace(/^v?/, "v")) ?? []), p]);
  }
  const inRelease = new Set([...releases.values()].flat().map((p) => p.key));
  const approved = left.filter((p) => !inRelease.has(p.key) && p.you === "aprobaste");
  const rest = left.filter((p) => !inRelease.has(p.key) && p.you !== "aprobaste");
  const sample = (xs: PrView[]) => {
    const names = xs.slice(0, 3).map((p) => `${p.author === "dependabot[bot]" || p.author === "dependabot" ? "dependabot" : c.lines.get(p.repo.toLowerCase())} #${p.number}`);
    return names.join(", ") + (xs.length > 3 ? "…" : "");
  };
  if (you.length)
    out.push({ kind: "group", key: "te-tocan", title: "Te tocan", note: String(you.length), rows: you.map((p) => row(p, c)), cap: CAP_TE_TOCAN, fold: false, more: `${you.length - CAP_TE_TOCAN} más que te tocan` });
  for (const [v, xs] of releases) {
    const all = xs.every((p) => p.reviewDecision === "APPROVED");
    const parts = xs.map((p) => `${c.lines.get(p.repo.toLowerCase())} #${p.number}`).join(" + ");
    const note = all ? `${parts} · ${xs.length === 2 ? "las dos aprobadas" : xs.length === 1 ? "aprobada" : "todas aprobadas"}` : parts;
    out.push({ kind: "group", key: `release-${v}`, title: `Release ${v}`, note, rows: xs.map((p) => row(p, c)), cap: 0, fold: true, more: xs.length === 1 ? "Ver la PR" : `Ver las ${xs.length}` });
  }
  if (approved.length)
    out.push({ kind: "group", key: "aprobaste", title: "Aprobaste, sin merge", note: String(approved.length), rows: approved.map((p) => row(p, c)), cap: 0, fold: true, more: `Ver las ${approved.length}: ${sample(approved)}` });
  if (rest.length)
    out.push({
      kind: "group",
      key: "resto",
      title: you.length || approved.length || releases.size ? "Del equipo" : "Sin issue",
      note: String(rest.length),
      rows: rest.map((p) => row(p, c)),
      cap: you.length || approved.length || releases.size ? 0 : CAP_GROUP_ROWS,
      fold: !!(you.length || approved.length || releases.size),
      more: you.length || approved.length || releases.size ? `Ver las ${rest.length}: ${sample(rest)}` : `${rest.length - CAP_GROUP_ROWS} más`,
    });
  return out;
}

function trainBlock(list: PrView[], c: Ctx): Block | null {
  if (!list.length) return null;
  const titles = [...new Set(list.map((p) => p.title.trim()))];
  const authors = [...new Set(list.map((p) => p.author))];
  const since = list.map((p) => `${p.repo.split("/")[1]} #${p.number} ${daysAgo(p.createdAt, c.now).long === "hoy" ? "abierta hoy" : `abierta ${daysAgo(p.createdAt, c.now).long}`}`);
  return {
    kind: "train",
    key: "tren",
    title: titles.length === 1 ? `${prs(list.length)} «${titles[0]}»` : prs(list.length),
    sub: `${authors.join(", ")} · ${andList(since)}`,
    prs: list.map((p) => ({ label: `${c.lines.get(p.repo.toLowerCase())} #${p.number}`, url: p.url })),
    url: list.length === 1 ? list[0]!.url : null,
  };
}

function listFor(station: StationView | null, selKey: string, c: Ctx): Block[] {
  const all = c.view.prs;
  if (c.q.vista === "todo") {
    const blocks = issueBlocks(
      all.filter((p) => p.issue),
      c,
    );
    const loose = all.filter((p) => p.station === SIN_ISSUE);
    if (loose.length)
      blocks.push({ kind: "group", key: "sin-issue", title: "Sin issue", note: String(loose.length), rows: loose.map((p) => row(p, c)), cap: CAP_GROUP_ROWS, fold: false, more: `${loose.length - CAP_GROUP_ROWS} más` });
    const t = trainBlock(
      all.filter((p) => p.station === TREN),
      c,
    );
    if (t) blocks.push({ kind: "group", key: "tren-head", title: "Tren a staging", note: "develop → staging · las abre el bot, no piden review", rows: [], cap: 0, fold: false, more: "" }, t);
    return blocks;
  }
  if (c.q.vista === "te-tocan") {
    const mine = all.filter((p) => p.teToca);
    const blocks = issueBlocks(
      mine.filter((p) => p.issue),
      c,
    );
    const loose = mine.filter((p) => !p.issue);
    if (loose.length) blocks.push({ kind: "group", key: "sin-issue", title: "Sin issue", note: String(loose.length), rows: loose.map((p) => row(p, c)), cap: CAP_GROUP_ROWS, fold: false, more: `${loose.length - CAP_GROUP_ROWS} más` });
    return blocks;
  }
  if (selKey === SIN_ISSUE) return spurBlocks(
    all.filter((p) => p.station === SIN_ISSUE),
    c,
  );
  if (selKey === TREN) {
    const t = trainBlock(
      all.filter((p) => p.station === TREN),
      c,
    );
    return t ? [{ kind: "group", key: "tren-head", title: "Tren a staging", note: "develop → staging · las abre el bot, no piden review", rows: [], cap: 0, fold: false, more: "" }, t] : [];
  }
  if (!station) return [];
  return issueBlocks(
    all.filter((p) => p.station === selKey && p.issue),
    c,
  );
}

function selHeader(station: StationView | null, selKey: string, c: Ctx): ProjectScreen["sel"] {
  const v = c.view;
  const tab = (key: Vista, label: string, count: number): TabLink => ({ key, label, count, href: pjHref(c.q, { vista: key, pr: null }), on: c.q.vista === key });
  if (selKey === SIN_ISSUE) {
    const here = v.prs.filter((p) => p.station === SIN_ISSUE);
    const you = here.filter((p) => p.teToca).length;
    return {
      title: "Sin issue en el board",
      sub: `${plural(here.length, "PR que no cuelga", "PRs que no cuelgan")} de ninguna issue${you ? ` · ${you} te ${you === 1 ? "toca" : "tocan"}` : ""}`,
      tabs: [tab("estacion", "Esta rama", here.length), tab("todo", "Todo el proyecto", v.counts.prs), tab("te-tocan", "Te tocan", v.counts.teToca)],
    };
  }
  if (selKey === TREN) {
    return {
      title: "Tren a staging",
      sub: "develop → staging · las abre el bot, no piden review",
      tabs: [tab("estacion", "Este tren", v.counts.train), tab("todo", "Todo el proyecto", v.counts.prs), tab("te-tocan", "Te tocan", v.counts.teToca)],
    };
  }
  const s = station;
  const sub = s
    ? [`${plural(s.issues, "issue con PRs abiertas", "issues con PRs abiertas")}`, prs(s.prs), s.blockers ? plural(s.blockers, "bloqueante tuyo", "bloqueantes tuyos") : null]
        .filter(Boolean)
        .join(" · ")
    : "";
  return {
    title: s?.name ?? "",
    sub,
    tabs: [tab("estacion", "Esta estación", s?.prs ?? 0), tab("todo", "Todo el proyecto", v.counts.prs), tab("te-tocan", "Te tocan", v.counts.teToca)],
  };
}

// ---------- the band ----------

const BAND_W = 1200;
const LINE0 = 84;
const LINE_STEP = 22;

function stationCount(s: StationView): string {
  if (s.prs > 0) return `${issues(s.issues)} · ${prs(s.prs)}`;
  return s.items > 0 ? `${issues(s.items)} · sin PRs` : "sin issues";
}

interface StopPlan {
  iv: IssueView;
  list: PrView[];
  w: number;
}

/** Ticks of one issue stop at `x`: one per PR on its repo's line, a ring + ink connector when it spans two repos. */
function stopAt(x: number, plan: StopPlan, ys: Map<string, number>, label: string): BandStop {
  const byRepo = new Map<string, PrView[]>();
  for (const p of plan.list) byRepo.set(p.repo.toLowerCase(), [...(byRepo.get(p.repo.toLowerCase()) ?? []), p]);
  const multi = byRepo.size > 1;
  const ticks: BandTick[] = [];
  for (const [repo, list] of byRepo) {
    list.forEach((p, k) => {
      ticks.push({ x: x + k * 16, y: ys.get(repo) ?? LINE0, you: p.teToca, draft: p.draft, blocker: p.blocker, ring: multi && k === 0, title: `${repo.split("/")[1]} #${p.number}` });
    });
  }
  const repoYs = [...byRepo.keys()].map((r) => ys.get(r) ?? LINE0);
  return { x, label, connector: multi ? { x, y1: Math.min(...repoYs), y2: Math.max(...repoYs) } : null, ticks };
}

const stopW = (list: PrView[]) => {
  const per = new Map<string, number>();
  for (const p of list) per.set(p.repo.toLowerCase(), (per.get(p.repo.toLowerCase()) ?? 0) + 1);
  return Math.max(1, ...per.values()) * 16 + 56;
};

function band(view: ProjectView, selKey: string, c: Ctx): BandModel {
  const repos = view.lines;
  const L = Math.max(96, ...repos.map((l) => textW(c.lines.get(l.repo.toLowerCase()) ?? l.label, 12.5) + 20));
  const ys = new Map(repos.map((l, i) => [l.repo.toLowerCase(), LINE0 + i * LINE_STEP]));
  const lastY = LINE0 + Math.max(0, repos.length - 1) * LINE_STEP;
  const capTop = LINE0 - 18;
  const capH = lastY - capTop + 18;
  const spurY = lastY + 68;
  const empty = view.counts.prs === 0;

  const shown = view.stations.filter((s) => s.kind !== "sin-issue");
  const plans = new Map<string, StopPlan[]>();
  for (const s of shown) {
    plans.set(
      s.key,
      view.issues
        .filter((iv) => iv.station === s.key)
        .map((iv) => {
          const list = iv.prs.map((k) => c.byKey.get(k)!).filter(Boolean);
          return { iv, list, w: stopW(list) };
        })
        .filter((x) => x.list.length),
    );
  }
  const minW = (s: StationView) => Math.max(textW(s.name, 15, true), textW(stationCount(s), 12.5)) + 26;
  const caps = new Map<string, number>(shown.map((s) => [s.key, plans.get(s.key)!.length]));
  const width = (s: StationView) => {
    const ps = plans.get(s.key)!.slice(0, caps.get(s.key));
    const hidden = plans.get(s.key)!.length - ps.length;
    if (!ps.length && !hidden) return minW(s);
    return Math.max(minW(s), 50 + ps.reduce((n, p) => n + p.w, 0) + (hidden ? 44 : 0) + 16);
  };
  const avail = BAND_W - L;
  const active = shown.filter((s) => s.prs > 0 || s.key === selKey);
  // Too many issues for the width: drop stops from the widest station until it fits ("+N" stands for them).
  for (let guard = 0; guard < 500 && active.reduce((n, s) => n + width(s), 0) > avail; guard++) {
    const widest = active.filter((s) => caps.get(s.key)! > 1).sort((a, b) => width(b) - width(a))[0];
    if (!widest) break;
    caps.set(widest.key, caps.get(widest.key)! - 1);
  }
  let used = active.reduce((n, s) => n + width(s), 0);
  // Quiet stations fill what is left: those with open issues first, then the nearest to a station with PRs.
  const idx = new Map(shown.map((s, i) => [s.key, i]));
  const activeIdx = active.map((s) => idx.get(s.key)!);
  const dist = (s: StationView) => (activeIdx.length ? Math.min(...activeIdx.map((i) => Math.abs(i - idx.get(s.key)!))) : idx.get(s.key)!);
  const visible = new Set(active.map((s) => s.key));
  const empty0 = (s: StationView) => (s.items > 0 ? 0 : 1);
  for (const s of shown.filter((x) => !visible.has(x.key)).sort((a, b) => empty0(a) - empty0(b) || dist(a) - dist(b) || idx.get(a.key)! - idx.get(b.key)!)) {
    if (used + width(s) > avail) continue;
    visible.add(s.key);
    used += width(s);
  }
  const order = shown.filter((s) => visible.has(s.key));
  const gap = order.length > 1 ? Math.min(Math.floor((avail - used) / order.length), 90) : 0;
  let x = L;
  const stations: BandStation[] = [];
  const stops: BandModel["stops"] = [];
  for (const s of order) {
    stations.push({
      key: s.key,
      name: s.name,
      count: stationCount(s),
      x,
      on: s.key === selKey,
      quiet: s.quiet,
      dashed: s.kind === "sin-estado",
      href: pjHref(c.q, { estacion: s.key, vista: "estacion", pr: null }),
    });
    const ps = plans.get(s.key)!;
    const shownPs = ps.slice(0, caps.get(s.key));
    if (ps.length) {
      let sx = x + 50;
      const list: BandStop[] = [];
      for (const p of shownPs) {
        list.push(stopAt(sx, p, ys, c.issueLabel(p.iv)));
        sx += p.w;
      }
      const hidden = ps.length - shownPs.length;
      stops.push({ station: s.key, dim: s.key !== selKey, stops: list, more: hidden ? { x: sx - 8, text: `+${hidden}` } : null });
    }
    x += width(s) + gap;
  }

  // The spur: PRs with no issue, off the lowest line.
  const loose = view.prs.filter((p) => p.station === SIN_ISSUE);
  let spur: BandModel["spur"] = null;
  let after = L;
  const dy = spurY - lastY;
  if (loose.length && !empty) {
    const x0 = L + 10;
    // What is his first, so a capped spur never hides a filled tick.
    const shownTicks = [...loose.filter((p) => p.teToca), ...loose.filter((p) => !p.teToca)].slice(0, SPUR_TICKS);
    const t0 = x0 + dy + 16;
    const ticks = shownTicks.map((p, k) => ({ x: t0 + k * 24, y: spurY, you: p.teToca, draft: p.draft, blocker: p.blocker, ring: false, title: `${p.repo.split("/")[1]} #${p.number}` }));
    const hidden = loose.length - shownTicks.length;
    const end = t0 + (shownTicks.length - 1) * 24 + 24;
    // "+N" past the line's end, never over it.
    const labelX = hidden ? end + 10 + textW(`+${hidden}`, 12, true) + 12 : end + 14;
    const you = loose.filter((p) => p.teToca).length;
    const note = `${prs(loose.length)}${you ? ` · ${you} te ${you === 1 ? "toca" : "tocan"}` : ""}`;
    spur = {
      d: `M${x0} ${lastY}l${dy} ${dy}H${end}`,
      on: selKey === SIN_ISSUE,
      ticks,
      more: hidden ? { x: end + 10, text: `+${hidden}` } : null,
      labelX,
      note,
      noteX: labelX + textW("Sin issue", 13, true) + 10,
      href: pjHref(c.q, { estacion: SIN_ISSUE, vista: "estacion", pr: null }),
    };
    after = spur.noteX + textW(note, 12.5) + 40;
  }
  // The release train: develop to staging, one dashed track.
  const tr = view.prs.filter((p) => p.station === TREN);
  let train: BandModel["train"] = null;
  if (tr.length && !empty) {
    const x0 = after;
    const ticks = tr.slice(0, 6).map((p, k) => ({ x: x0 + dy + 30 + k * 24, y: spurY, you: false, draft: p.draft, blocker: false, ring: false, title: `${p.repo.split("/")[1]} #${p.number}` }));
    const end = ticks[ticks.length - 1]!.x + 30;
    const note = `${prs(tr.length)} del bot, una por repo`;
    const labelX = end + 14;
    const noteX = labelX + textW("Tren a staging", 13, true) + 10;
    train = {
      d: `M${x0} ${lastY}l${dy} ${dy}H${end}`,
      on: selKey === TREN,
      ticks,
      labelX,
      note: noteX + textW(note, 12.5) <= BAND_W ? note : "",
      noteX,
      href: pjHref(c.q, { estacion: TREN, vista: "estacion", pr: null }),
    };
  }
  const H = spur || train ? spurY + 36 : lastY + 72;
  return {
    W: BAND_W,
    H,
    L,
    lines: repos.map((l) => ({ label: c.lines.get(l.repo.toLowerCase()) ?? l.label, y: ys.get(l.repo.toLowerCase())!, quiet: l.quiet })),
    dotted: c.limited,
    empty,
    capTop,
    capH,
    labelY: lastY + 30,
    stations,
    stops,
    spur,
    train,
    legend: !empty,
  };
}

/** The phone's band: the selected station's corridor, its neighbours named at the edges. */
function corridor(view: ProjectView, selKey: string, c: Ctx, phoneStations: StationView[]): CorridorModel | null {
  if (selKey === SIN_ISSUE || selKey === TREN) return null;
  const W = 390;
  const ys = new Map(view.lines.map((l, i) => [l.repo.toLowerCase(), 62 + i * 22]));
  const lastY = 62 + Math.max(0, view.lines.length - 1) * 22;
  const s = view.stations.find((x) => x.key === selKey);
  if (!s) return null;
  const at = phoneStations.findIndex((x) => x.key === selKey);
  const nb = (k: number) => {
    const x = phoneStations[k];
    return x && x.key !== SIN_ISSUE ? { name: x.name, href: pjHref(c.q, { estacion: x.key, vista: "estacion", pr: null }) } : null;
  };
  const plans = view.issues
    .filter((iv) => iv.station === selKey)
    .map((iv) => {
      const list = iv.prs.map((k) => c.byKey.get(k)!).filter(Boolean);
      return { iv, list, w: Math.max(stopW(list), 90) };
    })
    .filter((x) => x.list.length);
  const stops: BandStop[] = [];
  let x = 96;
  let n = 0;
  for (const p of plans) {
    if (x + p.w - 56 > W - 40) break;
    stops.push(stopAt(x, p, ys, c.issueLabel(p.iv)));
    x += p.w;
    n++;
  }
  const hidden = plans.length - n;
  return {
    W,
    H: lastY + 44,
    name: s.name,
    prev: at > 0 ? nb(at - 1) : null,
    next: at >= 0 ? nb(at + 1) : null,
    lines: view.lines.map((l) => ({ y: ys.get(l.repo.toLowerCase())!, quiet: l.quiet })),
    dotted: c.limited,
    cap: { x: 30, y: 44, h: lastY - 44 + 18 },
    labelY: lastY + 30,
    stops,
    more: hidden ? { x: W - 34, text: `+${hidden}` } : null,
  };
}

function ticketStatus(s: string): string {
  return s === "closed" ? "cerrado" : "abierto";
}

function detail(pr: PrView, rows: Row[], c: Ctx, backLabel: string, extras: ScreenExtras): Detail {
  const pos = rows.findIndex((r) => r.key === pr.key);
  const estado: Detail["estado"] = [];
  if (pr.you === "bloqueante" && pr.mesa)
    estado.push({
      icon: "stop",
      title: `${plural(pr.mesa.blockers, "bloqueante abierto", "bloqueantes abiertos")} en tu review`,
      text: pr.mesa.headMoved ? "El autor subió cambios desde tu review" : "Esperando al autor",
      quote: extras.blockerQuote ?? undefined,
    });
  else if (pr.you === "aprobaste") estado.push({ icon: "check", title: "Aprobaste", text: pr.mesa?.headMoved ? "Hay commits nuevos desde tu review" : "Sin merge todavía" });
  else if (pr.you === "en-revision") estado.push({ icon: "eye", title: "En revisión en Mesa", text: pr.mesa?.findings ? plural(pr.mesa.findings, "hallazgo abierto", "hallazgos abiertos") : "Sin hallazgos abiertos" });
  else if (pr.you === "sin-review") estado.push({ icon: "eye", title: "Sin tu review", text: "Te la pidieron en GitHub" });
  else if (pr.you === "tuya") estado.push({ icon: "mine", title: "Es tuya", text: pr.draft ? "En borrador" : "Esperando review" });
  const ck = checksCell(pr);
  const gh = githubCell(pr);
  const checksTitle = pr.checks ? `Checks ${pr.checks.state === "fail" ? "fallan" : ck.text}` : "Checks sin datos";
  estado.push({
    icon: pr.checks?.state === "fail" ? "ckbad" : pr.checks?.state === "pending" ? "ckrun" : pr.checks ? "ckok" : "ckrun",
    title: pr.checks ? `${checksTitle} · ${gh.text.toLowerCase()}` : checksTitle,
    text: [pr.checks?.state === "fail" ? `${pr.checks.failed} de ${pr.checks.total}` : null, pr.conflicts === true ? "con conflictos" : pr.conflicts === false ? "sin conflictos" : null, pr.draft ? "borrador" : null]
      .filter(Boolean)
      .join(" · "),
  });
  const iv = pr.issue ? c.view.issues.find((x) => x.key === pr.issue) : undefined;
  let issue: Detail["issue"] = null;
  if (iv) {
    const others = iv.prs.filter((k) => k !== pr.key).map((k) => c.byKey.get(k)!).filter(Boolean);
    issue = {
      label: c.issueLabel(iv),
      status: iv.station === SIN_ESTADO ? "Sin estado" : iv.station,
      statusNone: iv.station === SIN_ESTADO,
      interchange: iv.interchange,
      siblings: others.length ? `Va con ${andList(others.map((o) => `${c.lines.get(o.repo.toLowerCase())} #${o.number}`))}` : null,
      url: iv.url,
    };
  }
  return {
    back: { label: backLabel, href: pjHref(c.q, { pr: null }) },
    pos: pos >= 0 ? `${pos + 1} de ${rows.length}` : "",
    kind: `${pr.repo.split("/")[1]} · PR #${pr.number}`,
    title: pr.title,
    by: `${pr.author} · abierta ${daysAgo(pr.createdAt, c.now).long} · hacia ${pr.baseRef}`,
    url: pr.url,
    estado,
    issue,
    tickets: pr.tickets.map((t) => ({ ref: t.ref, href: ticketHref(t.ref), title: t.title, status: ticketStatus(t.status) })),
  };
}

/** Every row a list shows, in order, for "1 de 6". */
export const blockRows = (blocks: Block[]): Row[] => blocks.flatMap((b) => (b.kind === "train" ? [] : b.rows));

export function screenModel(payload: ProjectsPayload, q: PjQuery, now: Date, extras: ScreenExtras = {}): Screen {
  const v = payload.view;
  const tabs: TabLink[] = payload.projects.map((p) => ({ key: p.key, label: p.name, count: p.openPrs, href: pjHref({ proyecto: null, estacion: null, vista: "estacion", pr: null }, { proyecto: p.key }), on: p.key === v?.key }));
  if (!v) return { tabs, configError: payload.configError, project: null };

  const lines = lineLabels(v.lines.map((l) => l.repo));
  const limited = payload.health.state !== "ok";
  const readAt = v.readAt.prs;
  const prefix = extras.issuePrefix ?? "";
  const issueRepo = extras.issueRepo?.toLowerCase() ?? null;
  const c: Ctx = {
    view: v,
    q,
    now,
    lines,
    stale: limited && readAt ? `Dato de las ${clock(readAt)}` : null,
    byKey: new Map(v.prs.map((p) => [p.key, p])),
    limited,
    issueLabel: (iv) =>
      iv.type === "PullRequest"
        ? `${lines.get(iv.repo.toLowerCase()) ?? iv.repo.split("/")[1]} #${iv.number}`
        : issueRepo && iv.repo.toLowerCase() === issueRepo
          ? `${prefix || "#"}${iv.number}`
          : `${iv.repo.split("/")[1]}#${iv.number}`,
  };

  // The selected station: the URL's, else the default (where something is his, else the most PRs).
  const known = (k: string | null) => !!k && (k === TREN ? v.counts.train > 0 : v.stations.some((s) => s.key === k));
  const selKey = known(q.estacion) ? q.estacion! : (v.defaultStation ?? v.stations[0]?.key ?? SIN_ISSUE);
  const station = v.stations.find((s) => s.key === selKey) ?? null;

  const sync = limited
    ? (() => {
        const m = /límite de API · (\d\d:\d\d)/.exec(payload.health.note);
        const tail = readAt ? ` · lo que ves es de las ${clock(readAt)}` : "";
        return m ? { limited, lead: "GitHub en pausa hasta las ", strong: m[1]!, tail } : { limited, lead: "GitHub: ", strong: payload.health.note, tail };
      })()
    : readAt
      ? { limited, lead: "Leído de GitHub · ", strong: ago(readAt, now), tail: "" }
      : { limited, lead: "Sin leer de GitHub todavía", strong: "", tail: "" };

  const notes: string[] = [];
  if (v.partial.noBoard) notes.push("El board no se ha leído todavía: las PRs van a Sin issue hasta que llegue.");
  if (v.partial.unreadRepos.length) notes.push(`Sin leer todavía: ${andList(v.partial.unreadRepos.map((r) => r.split("/")[1] ?? r))}.`);
  if (v.partial.truncatedRepos.length) notes.push(`Solo las 100 PRs más recientes de ${andList(v.partial.truncatedRepos.map((r) => r.split("/")[1] ?? r))}.`);

  const blocks = listFor(station, selKey, c);
  const sel = selHeader(station, selKey, c);
  const otherProjects = payload.projects.filter((p) => p.key !== v.key);
  const empty =
    v.counts.prs === 0
      ? {
          title: `${v.name} no tiene PRs abiertas.`,
          text: (() => {
            const busy = v.stations
              .filter((s) => s.items > 0)
              .sort((a, b) => b.items - a.items)
              .slice(0, 2);
            return busy.length ? `El board sigue: ${andList(busy.map((s, i) => (i === 0 ? `${issues(s.items)} en ${s.name}` : `${s.items} en ${s.name}`)))}.` : "El board no tiene issues abiertas.";
          })(),
          actions: [
            { label: "Abrir el board en GitHub", href: v.boardUrl, external: true },
            ...otherProjects.map((p) => ({ label: `Ver ${p.name} · ${p.openPrs}`, href: pjHref({ proyecto: null, estacion: null, vista: "estacion", pr: null }, { proyecto: p.key }), external: false })),
          ],
        }
      : null;

  // Phone: the stations with PRs (and the selected one) as tabs, then Sin issue and the train.
  const phoneStations = v.stations.filter((s) => (s.prs > 0 || s.key === selKey) && s.kind !== "sin-issue");
  const sinIssue = v.stations.find((s) => s.kind === "sin-issue");
  const tabStations: TabLink[] = phoneStations.map((s) => ({ key: s.key, label: s.name, count: s.prs, href: pjHref(q, { estacion: s.key, vista: "estacion", pr: null }), on: s.key === selKey }));
  if (sinIssue && sinIssue.prs > 0) tabStations.push({ key: SIN_ISSUE, label: "Sin issue", count: sinIssue.prs, href: pjHref(q, { estacion: SIN_ISSUE, vista: "estacion", pr: null }), on: selKey === SIN_ISSUE });
  if (v.counts.train) tabStations.push({ key: TREN, label: "Tren a staging", count: v.counts.train, href: pjHref(q, { estacion: TREN, vista: "estacion", pr: null }), on: selKey === TREN });
  const selPr = q.pr ? c.byKey.get(q.pr) : undefined;
  const rows = blockRows(blocks);

  return {
    tabs,
    configError: payload.configError,
    project: {
      key: v.key,
      name: v.name,
      path: v.boardUrl.replace(/^https:\/\/github\.com\/(?:orgs|users)\/([^/]+)\/projects\/\d+$/, (_, o: string) => `${o} / ${v.boardTitle || v.name}`),
      boardUrl: v.boardUrl,
      sync,
      notes,
      band: band(v, selKey, c),
      sel: empty ? { title: "Nada abierto", sub: `0 PRs en ${andList(v.lines.map((l) => l.repo.split("/")[1] ?? l.repo))}`, tabs: [] } : sel,
      blocks: empty ? [] : blocks,
      capBlocks: CAP_BLOCKS,
      moreBlocks: `Ver ${plural(Math.max(0, blocks.length - CAP_BLOCKS), "grupo más", "grupos más")}`,
      empty,
      phone: {
        readAgo: readAt ? (limited ? `de las ${clock(readAt)}` : ago(readAt, now)) : "",
        stations: tabStations,
        corridor: empty ? null : corridor(v, selKey, c, phoneStations),
        detail: selPr ? detail(selPr, rows.length ? rows : [row(selPr, c)], c, selKey === SIN_ISSUE ? "Sin issue" : selKey === TREN ? "Tren a staging" : (station?.name ?? "Proyectos"), extras) : null,
      },
    },
  };
}
