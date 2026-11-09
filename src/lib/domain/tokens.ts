// Tokens spent (t45), pure. Claude Code writes every assistant message of a session, and of each subagent, to a
// JSONL transcript with its `message.usage`. This file turns those lines into per-day buckets by role and model and
// sums them for "today" and "this week" (Bogota). Reading the files lives in src/lib/integrations/transcripts.ts.
import { addDays, localDay, weekOf } from "./week";

export const ROLES = ["lead", "sweeper", "tl", "dev", "reviewer", "writer", "other"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  lead: "Lead",
  sweeper: "Sweeper",
  tl: "Tech lead",
  dev: "Dev",
  reviewer: "Reviewer",
  writer: "Writer",
  other: "Otros",
};

export interface TokenUse {
  /** Fresh input tokens. */
  input: number;
  /** Tokens written to the prompt cache. */
  cacheWrite: number;
  /** Tokens read back from the prompt cache. */
  cacheRead: number;
  output: number;
}

export const emptyUse = (): TokenUse => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
export const totalOf = (u: TokenUse): number => u.input + u.cacheWrite + u.cacheRead + u.output;
/** "Tokens nuevos": what was actually processed or produced (input + cache writes + output), without cache reads. */
export const freshOf = (u: TokenUse): number => u.input + u.cacheWrite + u.output;

const addTo = (to: TokenUse, from: TokenUse) => {
  to.input += from.input;
  to.cacheWrite += from.cacheWrite;
  to.cacheRead += from.cacheRead;
  to.output += from.output;
};

/** day (YYYY-MM-DD, Bogota) -> "<role>|<model>" -> tokens. JSON-serializable: it is what Mesa persists. */
export type Buckets = Record<string, Record<string, TokenUse>>;

// ---------- reading one transcript ----------

const AGENT_ROLES = new Set<string>(["sweeper", "tl", "dev", "reviewer", "writer"]);

/**
 * The role of a transcript: the session's own file is the lead; a subagent's role is its `agentType` (the Mesa
 * agent files are named after the roles), else the name its description starts with ("dev-t22 ...", "Mesa sweeper-6 ...").
 */
export function classifyRole(src: { main: boolean; agentType?: string; description?: string }): Role {
  if (src.main) return "lead";
  const type = (src.agentType ?? "").trim().toLowerCase();
  if (AGENT_ROLES.has(type)) return type as Role;
  const m = /^(?:mesa\s+)?(sweeper|tl|dev|reviewer|writer)\b/i.exec((src.description ?? "").trim());
  return m ? (m[1]!.toLowerCase() as Role) : "other";
}

export interface UsageRecord {
  /** ISO timestamp of the message. */
  at: string;
  /** `message.id`: one API response is written once per content block with the same usage. */
  id: string;
  model: string;
  use: TokenUse;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** One JSONL line -> its usage, or null for anything that is not an assistant message with tokens. Never throws. */
export function parseUsageLine(line: string): UsageRecord | null {
  if (!line.includes('"usage"')) return null;
  let o: unknown;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  const rec = o as { type?: unknown; timestamp?: unknown; message?: { id?: unknown; model?: unknown; usage?: Record<string, unknown> } };
  const m = rec?.message;
  if (rec?.type !== "assistant" || !m?.usage || typeof rec.timestamp !== "string" || Number.isNaN(Date.parse(rec.timestamp))) return null;
  const model = typeof m.model === "string" ? m.model : "";
  if (!model || model.startsWith("<")) return null; // "<synthetic>": a local message, not an API call
  const use: TokenUse = {
    input: num(m.usage.input_tokens),
    cacheWrite: num(m.usage.cache_creation_input_tokens),
    cacheRead: num(m.usage.cache_read_input_tokens),
    output: num(m.usage.output_tokens),
  };
  if (totalOf(use) === 0) return null;
  return { at: rec.timestamp, id: typeof m.id === "string" ? m.id : "", model, use };
}

// ---------- buckets ----------

/** Adds one message to the buckets (mutates `b`). */
export function addUsage(b: Buckets, role: Role, rec: UsageRecord): void {
  const day = (b[localDay(new Date(rec.at))] ??= {});
  addTo((day[`${role}|${rec.model}`] ??= emptyUse()), rec.use);
}

/** Drops every day before `fromDay` (mutates `b`). */
export function pruneDays(b: Buckets, fromDay: string): void {
  for (const d of Object.keys(b)) if (d < fromDay) delete b[d];
}

export interface TokenRow {
  key: string;
  label: string;
  use: TokenUse;
  /** Everything, cache reads included. */
  total: number;
  /** Tokens nuevos: the figure the bars rank by. */
  fresh: number;
}

export interface TokenSlice {
  use: TokenUse;
  total: number;
  /** Tokens nuevos (input + cache write + output). */
  fresh: number;
  /** Biggest tokens nuevos first, roles with no tokens left out. */
  byRole: TokenRow[];
  /** Biggest tokens nuevos first. */
  byModel: TokenRow[];
}

/** One Monday-to-Sunday column of "Semana, por día". */
export interface DayBar {
  /** YYYY-MM-DD (Bogota). */
  day: string;
  /** "lun", "mar", ... */
  label: string;
  fresh: number;
  use: TokenUse;
  today: boolean;
  /** After today: nothing can have been spent yet. */
  future: boolean;
}

export interface TokenSummary {
  /** Today's Bogota day and the Monday of this week (YYYY-MM-DD). */
  day: string;
  weekStart: string;
  today: TokenSlice;
  week: TokenSlice;
  /** The seven days of this week, Monday first. */
  days: DayBar[];
}

/** "claude-opus-5-5" -> "opus-5-5". */
export const modelLabel = (model: string): string => model.replace(/^claude-/, "");

const FAMILY = /(opus|sonnet|haiku)/i;
/** "claude-opus-5-5" -> "Opus"; an id of an unknown family keeps its short id. */
export const modelFamily = (model: string): string => {
  const m = FAMILY.exec(model);
  return m ? m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase() : modelLabel(model);
};
/** "claude-opus-5-5" -> "5.5", "claude-3-5-sonnet-20241022" -> "3.5" (dates are not versions); "" when there is none. */
export const modelVersion = (model: string): string =>
  (modelLabel(model).match(/(?<![0-9])[0-9]{1,2}(?![0-9])/g) ?? []).join(".");

/** Family names for a set of model ids; two ids of one family ("Opus 5.5", "Opus 4.1") keep their version so rows stay distinct. */
function familyLabels(models: string[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const m of models) count.set(modelFamily(m), (count.get(modelFamily(m)) ?? 0) + 1);
  return new Map(
    models.map((m) => {
      const f = modelFamily(m);
      const v = modelVersion(m);
      return [m, (count.get(f) ?? 0) > 1 && v ? `${f} ${v}` : f];
    }),
  );
}
function slice(b: Buckets, from: string, to: string): TokenSlice {
  const use = emptyUse();
  const roles = new Map<string, TokenUse>();
  const models = new Map<string, TokenUse>();
  for (const [day, entries] of Object.entries(b)) {
    if (day < from || day > to) continue;
    for (const [key, u] of Object.entries(entries)) {
      const [role = "other", model = ""] = key.split("|");
      addTo(use, u);
      addTo(roles.get(role) ?? roles.set(role, emptyUse()).get(role)!, u);
      addTo(models.get(model) ?? models.set(model, emptyUse()).get(model)!, u);
    }
  }
  const row = (key: string, label: string, u: TokenUse): TokenRow => ({ key, label, use: u, total: totalOf(u), fresh: freshOf(u) });
  const names = familyLabels([...models.keys()]);
  const biggest = (a: TokenRow, c: TokenRow) => c.fresh - a.fresh;
  return {
    use,
    total: totalOf(use),
    fresh: freshOf(use),
    // Sort is stable: equal rows keep the fixed role order.
    byRole: ROLES.filter((r) => roles.has(r))
      .map((r) => row(r, ROLE_LABEL[r], roles.get(r)!))
      .sort(biggest),
    byModel: [...models].map(([m, u]) => row(m, names.get(m) ?? m, u)).sort(biggest),
  };
}

const DAY_LABEL = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;

/** Tokens nuevos per day for the Monday-to-Sunday week of `now` (Bogota); days after today are empty and flagged. */
export function weekDays(b: Buckets, now: Date): DayBar[] {
  const today = localDay(now);
  const monday = weekOf(now).monday;
  return DAY_LABEL.map((label, i) => {
    const day = addDays(monday, i);
    const use = emptyUse();
    for (const u of Object.values(b[day] ?? {})) addTo(use, u);
    return { day, label, fresh: freshOf(use), use, today: day === today, future: day > today };
  });
}

/** Today and this week (Monday to now, Bogota) out of the day buckets. */
export function summarize(b: Buckets, now: Date): TokenSummary {
  const day = localDay(now);
  const weekStart = weekOf(now).monday;
  return { day, weekStart, today: slice(b, day, day), week: slice(b, weekStart, day), days: weekDays(b, now) };
}

/** 1 234 567 -> "1.234.567" (es thousands dot): the exact figure for a title or an aria-label. */
export const exactTokens = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * 1 234 -> "1,2 k"; 4 200 000 -> "4,2 M"; 1 310 000 000 -> "1.310 M" (es decimal comma, thousands dot).
 * Never "G": a week of cache reads is a four-digit number of millions and that reads fine.
 */
export function compactTokens(n: number): string {
  const f = (v: number, unit: string) => {
    // From a thousand of a unit up the decimal is noise: "1.310 M", not "1.310,4 M".
    const [int = "0", frac] = (v >= 1000 ? Math.round(v) : Math.round(v * 10) / 10).toString().split(".");
    return `${exactTokens(Number(int))}${frac ? `,${frac}` : ""} ${unit}`;
  };
  if (n >= 1_000_000) return f(n / 1_000_000, "M");
  if (n >= 1_000) return f(n / 1_000, "k");
  return String(n);
}
