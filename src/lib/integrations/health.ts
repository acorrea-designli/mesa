// getSourceHealth(): the rail notice (Estados B) and the Hoy states, read from source_state
// (github and github_project are written by the GitHub worker, slack and basecamp by the
// sweeper) plus whether a Claude session is listening. Server only.
import { mapHealth, railHealth, type SourceHealth } from "@/components/shell/health";
import type { HealthSource } from "@/lib/domain/types";
import { repos, type Repos } from "@/lib/repo";

export type RailHealth = SourceHealth & { name: string };

/** Rail rows: empty while every source is ok (the calm rail stays quiet). */
export function getSourceHealth(r: Repos = repos(), now = new Date()): RailHealth[] {
  const listening = r.sessions.list().some((s) => r.sessions.isListening(s, now));
  return railHealth(r.sources.list(), listening);
}

/** One source, mapped (defaults when it never reported). */
export function sourceHealthOf(source: HealthSource, r: Repos = repos()): SourceHealth {
  return mapHealth(r.sources.get(source));
}
