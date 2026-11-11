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

export function mapHealth(s: SourceState): SourceHealth {
  const name = NAME[s.source];
  const last = s.lastNewAt ?? s.lastChecked;
  const since = last ? clock(last) : null;
  const source = (s.source === "engram" ? "claude" : s.source) as SourceHealth["source"];
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
    // "límite de API · 14:05" already names the reason and the time.
    const until = s.backoffUntil && !/límite de API/.test(s.note) ? clock(s.backoffUntil) : null;
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
  return { source, state: "ok", note: "al día", legend: name, rowNote: "", since };
}

/**
 * The rail block: only when some source is not ok (the calm rail stays quiet).
 * Lists GitHub, Slack, Basecamp, GitHub Project when it is the one failing, Calendario
 * once it has reported (a board without the feed never lists it), and Claude (listening or not).
 */
export function railHealth(states: SourceState[], claudeListening: boolean): (SourceHealth & { name: string })[] {
  const by = new Map(states.map((s) => [s.source, s]));
  const bad = states.some((s) => s.health !== "ok" && s.source !== "engram");
  if (!bad) return [];
  const rows: (SourceHealth & { name: string })[] = [];
  for (const src of RAIL) {
    const s = by.get(src);
    const h: SourceHealth = s ? mapHealth(s) : { source: src as Source, state: "ok", note: "al día", legend: NAME[src], rowNote: "", since: null };
    rows.push({ ...h, name: NAME[src] });
  }
  const gp = by.get("github_project");
  if (gp && gp.health !== "ok") rows.splice(1, 0, { ...mapHealth(gp), name: NAME.github_project });
  const cal = by.get("calendar");
  if (cal) rows.push({ ...mapHealth(cal), name: NAME.calendar });
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
