// Tokens spent (t45), pure. Claude Code writes every assistant message of a session, and of each subagent, to a
// JSONL transcript with its `message.usage`. This file turns those lines into per-day buckets by role and model and
// sums them for "today" and "this week" (Bogota). Reading the files lives in src/lib/integrations/transcripts.ts.
import { localDay, weekOf } from "./week";

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
  total: number;
}

export interface TokenSlice {
  use: TokenUse;
  total: number;
  /** Fixed role order, roles with no tokens left out. */
  byRole: TokenRow[];
  /** Biggest first. */
  byModel: TokenRow[];
}

export interface TokenSummary {
  /** Today's Bogota day and the Monday of this week (YYYY-MM-DD). */
  day: string;
  weekStart: string;
  today: TokenSlice;
  week: TokenSlice;
}

/** "claude-opus-5-5" -> "opus-5-5". */
export const modelLabel = (model: string): string => model.replace(/^claude-/, "");

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
  const row = (key: string, label: string, u: TokenUse): TokenRow => ({ key, label, use: u, total: totalOf(u) });
  return {
    use,
    total: totalOf(use),
    byRole: ROLES.filter((r) => roles.has(r)).map((r) => row(r, ROLE_LABEL[r], roles.get(r)!)),
    byModel: [...models].map(([m, u]) => row(m, modelLabel(m), u)).sort((a, c) => c.total - a.total),
  };
}

/** Today and this week (Monday to now, Bogota) out of the day buckets. */
export function summarize(b: Buckets, now: Date): TokenSummary {
  const day = localDay(now);
  const weekStart = weekOf(now).monday;
  return { day, weekStart, today: slice(b, day, day), week: slice(b, weekStart, day) };
}

/** 1 234 -> "1,2 k"; 4 200 000 -> "4,2 M"; 1 268 300 000 -> "1,3 G" (es decimal comma; a week of cache reads reaches G). */
export function compactTokens(n: number): string {
  const f = (v: number, unit: string) => `${(Math.round(v * 10) / 10).toString().replace(".", ",")} ${unit}`;
  if (n >= 1_000_000_000) return f(n / 1_000_000_000, "G");
  if (n >= 1_000_000) return f(n / 1_000_000, "M");
  if (n >= 1_000) return f(n / 1_000, "k");
  return String(n);
}
