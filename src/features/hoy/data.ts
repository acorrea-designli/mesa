// Hoy read model (server only): everything the screen needs in one pass over the repositories.
import { mapHealth } from "@/components/shell/health";
import type { Source } from "@/lib/domain/types";
import { repos } from "@/lib/repo";
import { clock, isToday, longDay, shortDay, when } from "./format";
import { ignoreTarget } from "../ignore/model";
import { itemRow, kindLabel, openLabel, salidaRow, type HoyData, type HoyRow, type ItemDetail, type SetupRow } from "./model";

function setting(key: string): string | null {
  const row = repos().db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Ignored projects with what each hides right now (Hoy's "N ignorados" sheet). */
export function loadIgnored(): HoyData["ignored"] {
  const r = repos();
  const hidden = r.ignored.hiddenCounts();
  return r.ignored.list().map((p) => ({ id: p.id, source: p.source, project: p.project, label: p.label, hidden: (hidden[p.id]?.items ?? 0) + (hidden[p.id]?.tasks ?? 0) }));
}

export function loadHoy(now: Date = new Date()): HoyData {
  const r = repos();
  const counts = r.counts();

  const health: HoyData["health"] = {};
  for (const s of ["github", "slack", "basecamp"] as const) health[s] = mapHealth(r.sources.get(s));

  // Items of ignored projects stay in the DB but leave Hoy, the band and the counts.
  const all = r.items.list({ ignored: "exclude" });
  const items = all.filter((i) => i.station !== "done" || isToday(i.updatedAt, now));
  const rows: HoyRow[] = items.map((i) => ({ ...itemRow(i, when(i.receivedAt, now), i.source === "claude" ? undefined : health[i.source]), ignore: ignoreTarget(i) }));

  const details: Record<string, ItemDetail> = {};
  for (const i of items) {
    details[i.id] = {
      id: i.id,
      source: i.source,
      kindLabel: kindLabel(i.source, i.kind),
      title: i.title,
      excerpt: i.excerpt,
      project: i.project,
      url: i.url,
      linkLabel: openLabel(i.source),
      station: i.station,
      taskId: i.taskId,
      ticketRef: typeof i.meta.ticketRef === "string" ? i.meta.ticketRef : null,
      received: `${when(i.receivedAt, now)}${isToday(i.receivedAt, now) ? "" : ` ${clock(i.receivedAt)}`}`,
      isSample: i.isSample,
      ignore: ignoreTarget(i),
    };
  }

  const salidas = r.salidas.list({ status: ["pending"] });
  for (const s of salidas) {
    const d = r.salidas.detail(s.id);
    const v = d.versions[d.currentVersion - 1] ?? d.versions.at(-1);
    rows.push(salidaRow(s, v?.body ?? "", when(s.createdAt, now)));
  }

  const approvals = r.approvals.list({ status: "pending", hoy: true }, now).map((a) => ({ ...a, createdLabel: clock(a.createdAt) }));

  const leadFocus = r.focus.current(now);

  const done = all
    .filter((i) => i.station === "done" && isToday(i.updatedAt, now))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((i) => ({ id: i.id, source: i.source, title: i.source === "claude" ? i.title : `${i.project ? `${i.project} · ` : ""}${i.title}`, time: clock(i.updatedAt) }));

  const states = r.sources.list();
  const checked = states.map((s) => s.lastChecked).filter((x): x is string => Boolean(x)).sort().at(-1);
  const next = states
    .filter((s) => s.lastChecked && s.source !== "engram")
    .map((s) => Date.parse(s.lastChecked!) + s.cadenceS * 1000)
    .sort((a, b) => a - b)[0];

  const seen = (s: "github" | "slack" | "basecamp") => {
    const st = states.find((x) => x.source === s);
    return Boolean(st?.lastChecked) || all.some((i) => i.source === s);
  };
  const setup: SetupRow[] = [
    { key: "github", line: "github" as Source, name: "GitHub", detail: "acorrea-designli · PRs donde te piden review", connected: seen("github") },
    {
      key: "github_project",
      line: "github",
      name: "GitHub Project",
      detail: "Privado, de acorrea-designli. Aquí vive el tablero.",
      connected: Boolean(setting("gh_project.id")),
    },
    { key: "basecamp", line: "basecamp", name: "Basecamp", detail: "Cuenta Designli, a través de Claude", connected: seen("basecamp") },
    { key: "slack", line: "slack", name: "Slack", detail: "designli.slack.com, a través de Claude (MCP)", connected: seen("slack") },
  ];

  return {
    dayLong: `${longDay(now)} · ${clock(now)}`,
    dayShort: shortDay(now),
    stations: { ...counts.stations, done: counts.doneToday },
    rows,
    details,
    band: items.map((i) => ({ id: i.id, source: i.source, station: i.station, taskId: i.taskId })),
    approvals,
    leadFocus: leadFocus ? { ticketRef: leadFocus.ticketRef, title: leadFocus.title, until: clock(new Date(leadFocus.expiresAt)) } : null,
    health,
    done,
    doneToday: counts.doneToday,
    checkedAt: clock(checked ?? now),
    nextCheckAt: next ? clock(new Date(next)) : null,
    firstRun: all.length === 0 && r.tasks.list().length === 0 && !setup.every((s) => s.connected),
    setup,
    hasSample: all.some((i) => i.isSample) || salidas.some((s) => s.isSample),
    ignored: loadIgnored(),
  };
}
