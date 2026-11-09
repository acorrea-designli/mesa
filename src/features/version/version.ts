// Version check rules, pure so they are unit tested (the polling is VersionWatch.tsx). The server's version is the
// pair { sha, startedAt } from GET /api/health: it changes on every merge and on every restart.

export interface Version {
  sha: string;
  startedAt: string;
}

/** Reads `version` out of a /api/health body; null when absent or malformed. */
export function parseVersion(body: unknown): Version | null {
  const v = (body as { version?: { sha?: unknown; startedAt?: unknown } } | null)?.version;
  if (!v || typeof v.sha !== "string" || typeof v.startedAt !== "string" || !v.sha || !v.startedAt) return null;
  return { sha: v.sha, startedAt: v.startedAt };
}

/**
 * "same": nothing to do. "changed": the server runs another build or was restarted since this page loaded.
 * "unknown": one side is missing (first load, a failed ping): never a reason to show anything.
 */
export function compareVersion(loaded: Version | null, current: Version | null): "same" | "changed" | "unknown" {
  if (!loaded || !current) return "unknown";
  return loaded.sha === current.sha && loaded.startedAt === current.startedAt ? "same" : "changed";
}

/** "abc1234 · 9 nov, 12:48" (Spanish, the reader's time zone). */
export function formatVersion(v: Version, locale = "es"): string {
  const d = new Date(v.startedAt);
  if (!Number.isFinite(d.getTime())) return v.sha;
  return `${v.sha} · ${d.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}
