// Tablero <-> the private GitHub Project "Mesa" (owner acorrea-designli).
// - ensureProject: find the Project by title, create it only if missing, make sure its
//   Status field has the five station options, and record the ids in settings.
// - push: every task with sync_state pending becomes (or updates) a Project item and gets
//   its Status; the write is acked with markSync(synced) and the card loses "Sin sincronizar".
// - pull: Status changes made in GitHub move the task in Mesa, unless a local move is still
//   pending (a pending local move wins until acked). Items added in GitHub become tasks.
// Drafts only, never linked content: every item Mesa creates is a draft (`gh project item-create`,
// title + a plain-text body); a PR or issue URL goes in the body as text, never as the item's content.
// Linking a PR or issue (`item-add`, addProjectV2ItemById) writes an event to that PR's timeline on
// every card move, and the PRs are clients'. guardProjectGh refuses those calls before gh runs, and
// pull imports only DraftIssue items; PR/issue items added by hand in GitHub are left alone.
// Only Project field writes happen here; Mesa never writes reviews or comments.
import type { Db } from "../db/sqlite";
import type { Repos } from "../repo";
import type { Station, Task } from "../domain/types";
import { nowIso } from "../db/util";
import { GhError, ghGraphql, ghJson, type GhRunner } from "./gh";
import { publishChange } from "../live/bus";

export const PROJECT_TITLE = process.env.MESA_GH_PROJECT_TITLE ?? "Mesa";

// ---------- guard ----------

const LINKING_MUTATION = /addProjectV2ItemById|linkProjectV2/i;

const FIELD_FLAGS = new Set(["-f", "-F", "--raw-field", "--field"]);

/** The `query=` values of a `gh api graphql` call's field arguments (-f/-F/--raw-field/--field, spaced or attached). */
function queryFieldArgs(args: string[]): string[] {
  const out: string[] = [];
  const take = (field: string) => {
    if (field.startsWith("query=")) out.push(field.slice("query=".length));
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (FIELD_FLAGS.has(a)) take(args[++i] ?? "");
    else if (a.startsWith("--raw-field=") || a.startsWith("--field=")) take(a.slice(a.indexOf("=") + 1));
    else if (/^-[fF]./.test(a)) take(a.slice(2));
  }
  return out;
}

/** The GraphQL documents in a JSON stdin body ({query, variables} or a batch of them); the whole text when it is not JSON of that shape (fail safe). */
function stdinDocuments(input: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return [input];
  }
  const bodies = Array.isArray(parsed) ? parsed : [parsed];
  const docs: string[] = [];
  for (const b of bodies) {
    if (!b || typeof b !== "object" || Array.isArray(b)) return [input];
    const q = (b as { query?: unknown }).query;
    if (typeof q === "string") docs.push(q);
  }
  return docs;
}

/**
 * The runner every Project call goes through: refuses `gh project item-add` and any GraphQL document
 * (the `query` of the JSON on stdin, or a `query=` field of `gh api graphql`) that names
 * addProjectV2ItemById or linkProjectV2*, with a thrown error before gh runs. Drafts are the only way
 * an item gets into the Project. Only the document is scanned: a draft's --title and --body, GraphQL
 * variables and other arguments are free text and may name those mutations. Stdin that is not JSON is
 * scanned whole.
 */
export function guardProjectGh(gh: GhRunner): GhRunner {
  return async (args, opts) => {
    if (args[0] === "project" && args[1] === "item-add") {
      throw new GhError("other", "Mesa never links content to the Project: `gh project item-add` is refused (drafts only)");
    }
    const docs = [...(args[0] === "api" && args.includes("graphql") ? queryFieldArgs(args) : []), ...(opts?.input === undefined ? [] : stdinDocuments(opts.input))];
    for (const doc of docs) {
      const hit = LINKING_MUTATION.exec(doc);
      if (hit) throw new GhError("other", `Mesa never links content to the Project: ${hit[0]} is refused (drafts only)`);
    }
    return gh(args, opts);
  };
}

// ---------- mapping ----------

export const STATION_STATUS: Record<Station, string> = {
  inbox: "Inbox",
  todo: "Todo",
  doing: "In Progress",
  waiting: "Waiting",
  done: "Done",
};
export const STATUS_ORDER = ["Inbox", "Todo", "In Progress", "Waiting", "Done"] as const;

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, " ");
const STATUS_STATION = new Map<string, Station>([
  ...Object.entries(STATION_STATUS).map(([st, name]) => [norm(name), st as Station] as const),
  ["backlog", "inbox"],
  ["doing", "doing"],
  ["blocked", "waiting"],
  ["closed", "done"],
]);

export const stationToStatus = (s: Station) => STATION_STATUS[s];
/** Project Status name -> station; null for an unknown or empty status. */
export const statusToStation = (status: string | null | undefined): Station | null =>
  status ? (STATUS_STATION.get(norm(status)) ?? null) : null;

const OPTION_COLOR: Record<string, string> = { Inbox: "GRAY", Todo: "BLUE", "In Progress": "YELLOW", Waiting: "ORANGE", Done: "GREEN" };
const OPTION_HINT: Record<string, string> = {
  Inbox: "Mesa · Inbox",
  Todo: "Mesa · Todo",
  "In Progress": "Mesa · En curso",
  Waiting: "Mesa · Esperando",
  Done: "Mesa · Hecho",
};

// ---------- settings ----------

export interface ProjectSettings {
  id: string;
  number: number;
  url: string;
  owner: string;
  statusFieldId: string;
  statusOptions: Record<string, string>; // Status name -> option id
}

const K = {
  id: "gh_project.id",
  number: "gh_project.number",
  url: "gh_project.url",
  owner: "gh_project.owner",
  statusFieldId: "gh_project.status_field_id",
  statusOptions: "gh_project.status_options",
  lastPullAt: "gh_project.last_pull_at",
  knownItems: "gh_project.known_items",
};

const getSetting = (db: Db, key: string) =>
  (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
const setSetting = (db: Db, key: string, value: string) =>
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);

export function readProjectSettings(db: Db): ProjectSettings | null {
  const id = getSetting(db, K.id);
  const fid = getSetting(db, K.statusFieldId);
  if (!id || !fid) return null;
  return {
    id,
    number: Number(getSetting(db, K.number)),
    url: getSetting(db, K.url) ?? "",
    owner: getSetting(db, K.owner) ?? "",
    statusFieldId: fid,
    statusOptions: JSON.parse(getSetting(db, K.statusOptions) ?? "{}") as Record<string, string>,
  };
}

export function writeProjectSettings(db: Db, p: ProjectSettings): void {
  setSetting(db, K.id, p.id);
  setSetting(db, K.number, String(p.number));
  setSetting(db, K.url, p.url);
  setSetting(db, K.owner, p.owner);
  setSetting(db, K.statusFieldId, p.statusFieldId);
  setSetting(db, K.statusOptions, JSON.stringify(p.statusOptions));
}

// ---------- ensure ----------

interface GhProject {
  id: string;
  number: number;
  title: string;
  url: string;
  closed?: boolean;
}
interface GhField {
  id: string;
  name: string;
  type: string;
  options?: { id: string; name: string }[];
}

const UPDATE_FIELD = `mutation($fieldId: ID!, $opts: [ProjectV2SingleSelectFieldOptionInput!]) {
  updateProjectV2Field(input: { fieldId: $fieldId, singleSelectOptions: $opts }) {
    projectV2Field { ... on ProjectV2SingleSelectField { id options { id name } } }
  }
}`;

/**
 * Find the Project by title (create it only when missing), make sure the Status field has
 * Inbox, Todo, In Progress, Waiting, Done (existing options keep their ids), and record the
 * ids in settings. Returns the settings and whether the Project was created.
 */
export async function ensureProject(db: Db, runner: GhRunner, owner: string): Promise<{ project: ProjectSettings; created: boolean }> {
  const gh = guardProjectGh(runner);
  const list = await ghJson<{ projects: GhProject[] }>(gh, ["project", "list", "--owner", owner, "--format", "json", "--limit", "100"]);
  let p = list.projects.find((x) => x.title === PROJECT_TITLE && !x.closed);
  let created = false;
  if (!p) {
    p = await ghJson<GhProject>(gh, ["project", "create", "--owner", owner, "--title", PROJECT_TITLE, "--format", "json"]);
    created = true;
  }
  const fields = await ghJson<{ fields: GhField[] }>(gh, ["project", "field-list", String(p.number), "--owner", owner, "--format", "json"]);
  const status = fields.fields.find((f) => f.name === "Status" && f.type === "ProjectV2SingleSelectField");
  if (!status) throw new GhError("other", `Project "${PROJECT_TITLE}" has no Status field`);
  let options = status.options ?? [];
  const missing = STATUS_ORDER.filter((name) => !options.some((o) => norm(o.name) === norm(name)));
  if (missing.length) {
    // Wanted options first in station order (reusing ids), then any extra option Andrés added.
    const opts = [
      ...STATUS_ORDER.map((name) => {
        const have = options.find((o) => norm(o.name) === norm(name));
        return { ...(have ? { id: have.id } : {}), name, color: OPTION_COLOR[name] ?? "GRAY", description: OPTION_HINT[name] ?? "" };
      }),
      ...options
        .filter((o) => !STATUS_ORDER.some((n) => norm(n) === norm(o.name)))
        .map((o) => ({ id: o.id, name: o.name, color: "GRAY", description: "" })),
    ];
    const r = await ghGraphql<{ updateProjectV2Field: { projectV2Field: { options: { id: string; name: string }[] } } }>(gh, UPDATE_FIELD, {
      fieldId: status.id,
      opts,
    });
    options = r.updateProjectV2Field.projectV2Field.options;
  }
  const statusOptions: Record<string, string> = {};
  for (const name of STATUS_ORDER) {
    const o = options.find((x) => norm(x.name) === norm(name));
    if (o) statusOptions[name] = o.id;
  }
  const project: ProjectSettings = { id: p.id, number: p.number, url: p.url, owner, statusFieldId: status.id, statusOptions };
  writeProjectSettings(db, project);
  return { project, created };
}

// ---------- push ----------

export interface PushResult {
  pushed: number;
  failed: number;
  errors: string[];
}

/** The GitHub PR or issue a task links, shown as plain text in the draft body. */
const linkedUrl = (t: Task) => t.items?.find((i) => i.source === "github" && /\/(pull|issues)\/\d+/.test(i.url ?? ""))?.url ?? null;

/** Body of a draft item: excerpt, project, the linked PR/issue URL as text, and the task id. */
export const draftBody = (t: Task): string =>
  [t.excerpt, t.project ? `Proyecto: ${t.project}` : "", linkedUrl(t) ? `GitHub: ${linkedUrl(t)}` : "", `Mesa: ${t.id}`].filter(Boolean).join("\n\n");

/** Push every pending task (sample tasks never leave Mesa). Every new item is a draft. */
export async function pushPending(r: Repos, runner: GhRunner, p: ProjectSettings, now = () => new Date()): Promise<PushResult> {
  const gh = guardProjectGh(runner);
  const out: PushResult = { pushed: 0, failed: 0, errors: [] };
  for (const pending of r.tasks.pendingSync()) {
    if (pending.isSample) continue;
    const before = r.tasks.get(pending.id);
    try {
      // A task still holding a content-linked item (gh_content_url set, from before drafts only) never
      // edits it: it gets a fresh draft instead. The 0320 migration clears these rows; this is the backstop.
      let itemId = before.ghContentUrl ? null : before.ghItemId;
      if (!itemId) {
        const made = await ghJson<{ id: string }>(gh, [
          "project",
          "item-create",
          String(p.number),
          "--owner",
          p.owner,
          "--title",
          before.title,
          "--body",
          draftBody(before),
          "--format",
          "json",
        ]);
        itemId = made.id;
      }
      const option = p.statusOptions[stationToStatus(before.station)];
      if (!option) throw new GhError("other", `Status option "${stationToStatus(before.station)}" is missing`);
      await ghJson(gh, [
        "project",
        "item-edit",
        "--id",
        itemId,
        "--project-id",
        p.id,
        "--field-id",
        p.statusFieldId,
        "--single-select-option-id",
        option,
        "--format",
        "json",
      ]);
      const after = r.tasks.get(pending.id);
      if (after.updatedAt === before.updatedAt && after.station === before.station) {
        r.tasks.markSync(pending.id, { syncState: "synced", ghItemId: itemId, ghContentUrl: null }, now());
      } else {
        // Moved again while the write was in flight: keep it pending, remember the item.
        r.db.prepare("UPDATE tasks SET gh_item_id = ?, gh_content_url = NULL WHERE id = ?").run(itemId, pending.id);
      }
      out.pushed++;
      publishChange({ entityType: "task", entityId: pending.id, kind: "sync" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof GhError && (err.kind === "scope" || err.kind === "auth" || err.kind === "rate_limit" || err.kind === "missing")) {
        // Not this task's fault: leave it pending and stop this round.
        out.errors.push(msg);
        throw err;
      }
      r.tasks.markSync(pending.id, { syncState: "error", syncError: msg }, now());
      out.failed++;
      out.errors.push(msg);
      publishChange({ entityType: "task", entityId: pending.id, kind: "sync" });
    }
  }
  return out;
}

// ---------- pull ----------

export interface GhProjectItem {
  id: string;
  title?: string;
  status?: string;
  content?: { type?: string; url?: string; title?: string; body?: string; repository?: string; number?: number };
}

export interface PullResult {
  moved: number;
  imported: number;
  kept: number; // remote change ignored: a local move is pending
  skipped: number; // PR/issue items added by hand in GitHub: never imported nor edited
}

/** Only items that live in the Project itself (drafts) are Mesa's to import. */
const isDraft = (it: GhProjectItem) => it.content?.type === "DraftIssue";

/** Apply a GitHub-side Status change to a synced task without marking it pending. */
function applyRemoteStation(db: Db, taskId: string, station: Station, ts: string): void {
  db.prepare("UPDATE tasks SET station = ?, updated_at = ?, synced_at = ? WHERE id = ? AND sync_state = 'synced'").run(station, ts, ts, taskId);
  db.prepare("UPDATE items SET station = ?, skipped_at = CASE WHEN ? = 'done' THEN skipped_at ELSE NULL END, updated_at = ? WHERE task_id = ?").run(station, station, ts, taskId);
}

/** Pure reconciliation: what to do with each remote item given the local tasks. */
export function planPull(
  items: GhProjectItem[],
  tasks: Pick<Task, "id" | "ghItemId" | "station" | "syncState" | "isSample">[],
  known: ReadonlySet<string> = new Set(),
) {
  const byItem = new Map(tasks.filter((t) => t.ghItemId).map((t) => [t.ghItemId!, t]));
  const moves: { taskId: string; station: Station }[] = [];
  const imports: { item: GhProjectItem; station: Station }[] = [];
  const skipped: string[] = [];
  let kept = 0;
  for (const it of items) {
    const station = statusToStation(it.status) ?? "inbox";
    const t = byItem.get(it.id);
    if (!t) {
      // Items seen before belong to tasks deleted in Mesa (or were already skipped): never retry them.
      if (known.has(it.id)) continue;
      if (isDraft(it)) imports.push({ item: it, station });
      else skipped.push(it.id); // a PR or issue linked by hand: not imported, never edited
      continue;
    }
    if (t.isSample || t.station === station) continue;
    if (t.syncState === "synced") moves.push({ taskId: t.id, station });
    else kept++;
  }
  return { moves, imports, kept, skipped };
}

export async function pullProject(r: Repos, runner: GhRunner, p: ProjectSettings, now = () => new Date()): Promise<PullResult> {
  const gh = guardProjectGh(runner);
  const list = await ghJson<{ items: GhProjectItem[] }>(gh, ["project", "item-list", String(p.number), "--owner", p.owner, "--format", "json", "--limit", "1000"]);
  const all = r.db.prepare("SELECT id, gh_item_id AS ghItemId, station, sync_state AS syncState, is_sample AS isSample FROM tasks").all() as unknown as Pick<
    Task,
    "id" | "ghItemId" | "station" | "syncState" | "isSample"
  >[];
  const known = new Set(JSON.parse(getSetting(r.db, K.knownItems) ?? "[]") as string[]);
  for (const t of all) if (t.ghItemId) known.add(t.ghItemId);
  const plan = planPull(list.items, all.map((t) => ({ ...t, isSample: Boolean(t.isSample) })), known);
  const ts = nowIso(now());
  for (const m of plan.moves) {
    applyRemoteStation(r.db, m.taskId, m.station, ts);
    publishChange({ entityType: "task", entityId: m.taskId, kind: "move" });
  }
  for (const { item, station } of plan.imports) {
    const c = item.content ?? {};
    const t = r.tasks.create({
      title: item.title ?? c.title ?? "Sin título",
      excerpt: (c.body ?? "").split(/\r?\n/)[0]?.slice(0, 200) ?? "",
      source: "github",
      station,
    });
    r.tasks.markSync(t.id, { syncState: "synced", ghItemId: item.id, ghContentUrl: null }, now());
    publishChange({ entityType: "task", entityId: t.id, kind: "created" });
  }
  for (const it of list.items) known.add(it.id);
  setSetting(r.db, K.knownItems, JSON.stringify([...known]));
  setSetting(r.db, K.lastPullAt, ts);
  return { moved: plan.moves.length, imported: plan.imports.length, kept: plan.kept, skipped: plan.skipped.length };
}
