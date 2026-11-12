// Source health for the rail notice (Estados B) and the Hoy states. Pure: maps the
// source_state rows (repos().sources) to what the rail and the band show.
// getSourceHealth() in src/lib/integrations/health.ts reads the rows and calls these.
// Server notes win when they say more than the generic text: the GitHub worker writes
// "límite de API · 14:05" and "sin permiso", the sweeper writes its own outage notes.
import type { HealthSource, Source, SourceState } from "@/lib/domain/types";
import { clock } from "@/features/hoy/format";

export type HealthLevel = "ok" | "degraded" | "down";

export interface SourceHealth {
  source: Source | "github_project" | "calendar";
  state: HealthLevel;
  /** Short rail note: "al día", "sin conexión", "pausa 11:05". */
  note: string;
  /** Legend text when the line is out of service: "Slack · sin conexión". */
  legend: string;
  /** Row excerpt for affected items: "Último dato 10:20 · Slack no responde". */
  rowNote: string;
  /** Since when (clock) the source has not answered, if known. */
  since: string | null;
}

const NAME: Record<HealthSource | "claude", string> = {
  github: "GitHub",
  github_project: "GitHub Project",
  slack: "Slack",
  basecamp: "Basecamp",
  engram: "engram",
  calendar: "Calendario",
  claude: "Claude",
};

/** Sources the rail lists, in the mock's order. */
const RAIL: HealthSource[] = ["github", "slack", "basecamp"];

/** What the clock says about the rows: `now`, and whether the sweeper session is listening. */
export interface HealthContext {
  now: Date;
  sweeperListening: boolean;
}

/** A source row older than this many cadences counts as not checked (with a floor of 10 minutes). */
const STALE_CADENCES = 3;
const STALE_FLOOR_MS = 10 * 60_000;
/** Sources only the sweeper session probes (through MCP): no sweeper, no checks. */
const SWEPT: HealthSource[] = ["slack", "basecamp"];

/**
 * The clock of the last check when the row cannot be trusted as current: its lastChecked is older than
 * 3 x cadenceS (at least 10 min), or it is a swept source and the sweeper is not listening.
 * Null when it is fresh, and when it never reported (the default row keeps its default).
 */
export function staleSince(s: SourceState, ctx: HealthContext): string | null {
  if (!s.lastChecked) return null;
  const limit = Math.max(STALE_CADENCES * s.cadenceS * 1000, STALE_FLOOR_MS);
  const old = ctx.now.getTime() - Date.parse(s.lastChecked) > limit;
  const unswept = SWEPT.includes(s.source) && !ctx.sweeperListening;
  return old || unswept ? clock(s.lastChecked) : null;
}

export function mapHealth(s: SourceState, ctx: HealthContext): SourceHealth {
  const name = NAME[s.source];
  const last = s.lastNewAt ?? s.lastChecked;
  const since = last ? clock(last) : null;
  const source = (s.source === "engram" ? "claude" : s.source) as SourceHealth["source"];
  const stale = staleSince(s, ctx);
  const staleNote = stale ? `sin revisar desde ${stale}` : null;
  const staleRow = (): SourceHealth => ({
    source,
    state: "degraded",
    note: staleNote!,
    legend: `${name} · ${staleNote}`,
    rowNote: [since ? `Dato de las ${since}` : null, `${name} ${staleNote}`].filter(Boolean).join(" · "),
    since,
  });
  if (s.health === "down") {
    const note = s.note || "sin conexión";
    return {
      source,
      state: "down",
      note,
      legend: `${name} · ${note}`,
      rowNote: since ? `Último dato ${since} · ${name} no responde` : `${name} no responde`,
      since,
    };
  }
  if (s.health === "degraded") {
    // A pause that already ended is not shown: the row falls back to its note, or to "sin revisar" when stale.
    const live = s.backoffUntil !== null && Date.parse(s.backoffUntil) > ctx.now.getTime();
    if (s.backoffUntil && !live && stale) return staleRow();
    // "límite de API · 14:05" already names the reason and the time.
    const until = s.backoffUntil && live && !/límite de API/.test(s.note) ? clock(s.backoffUntil) : null;
    return {
      source,
      state: "degraded",
      note: until ? `pausa ${until}` : s.note || "con demoras",
      legend: until ? `${name} · en pausa hasta ${until}` : `${name} · ${s.note || "con demoras"}`,
      rowNote: [since ? `Dato de las ${since}` : null, until ? `${name} en pausa hasta ${until}` : s.note || `${name} con demoras`]
        .filter(Boolean)
        .join(" · "),
      since,
    };
  }
  if (stale) return staleRow();
  return { source, state: "ok", note: "al día", legend: name, rowNote: "", since };
}

/**
 * The rail block: only when some source is not ok (the calm rail stays quiet).
 * Lists GitHub, Slack, Basecamp, GitHub Project when it is the one failing, Calendario
 * once it has reported (a board without the feed never lists it), and Claude (listening or not).
 */
export function railHealth(states: SourceState[], claudeListening: boolean, ctx: HealthContext): (SourceHealth & { name: string })[] {
  const by = new Map(states.map((s) => [s.source, s]));
  // A stale "ok" is not ok: the block shows even when every row says so.
  const mapped = new Map(states.map((s) => [s.source, mapHealth(s, ctx)]));
  const bad = states.some((s) => s.source !== "engram" && mapped.get(s.source)?.state !== "ok");
  if (!bad) return [];
  const rows: (SourceHealth & { name: string })[] = [];
  for (const src of RAIL) {
    const h: SourceHealth = mapped.get(src) ?? { source: src as Source, state: "ok", note: "al día", legend: NAME[src], rowNote: "", since: null };
    rows.push({ ...h, name: NAME[src] });
  }
  const gp = mapped.get("github_project");
  if (gp && by.get("github_project") && gp.state !== "ok") rows.splice(1, 0, { ...gp, name: NAME.github_project });
  const cal = mapped.get("calendar");
  if (cal) rows.push({ ...cal, name: NAME.calendar });
  rows.push({
    source: "claude",
    state: "ok",
    note: claudeListening ? "escucha" : "sin sesión",
    legend: NAME.claude,
    rowNote: "",
    since: null,
    name: NAME.claude,
  });
  return rows;
}
