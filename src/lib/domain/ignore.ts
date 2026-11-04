// Ignored projects: the project key per source and the match rule. Pure; the SQL side lives
// in db/migrations/0400_ignored_projects.sql (items.project_key) and src/lib/repo/ignored.ts.
import type { Source } from "./types";

export type IgnoreSource = Source | "*";
export const IGNORE_SOURCES = ["github", "slack", "basecamp", "claude", "*"] as const;

export interface IgnoredProject {
  id: string;
  source: IgnoreSource;
  /** The project key (see projectKey). */
  project: string;
  /** What the UI shows: "prospec-admin", "#deploys", "Freightmate". */
  label: string;
  createdAt: string;
}

/**
 * The most specific stable project id of an item, read from its dedupe key:
 *  - GitHub: owner/repo, from [prefix]pr:<owner>/<repo>#<n> (the project column is the bare repo name),
 *  - Slack: the channel id, from [prefix]<channelId>:<ts> (the segment before the last ':'),
 *  - Basecamp and Claude, or a key that cannot be read: the project column (Basecamp project name).
 * Mirrors the generated column items.project_key (db/migrations/0400_ignored_projects.sql).
 */
export function projectKey(i: { source: Source; externalId: string; project?: string | null }): string {
  const ext = i.externalId;
  const project = i.project ?? "";
  if (i.source === "github") {
    const at = ext.indexOf("pr:");
    if (at >= 0) {
      const rest = ext.slice(at + 3);
      const hash = rest.indexOf("#");
      if (hash > 0) return rest.slice(0, hash);
    }
  }
  if (i.source === "slack" && ext.includes(":")) {
    const parts = ext.split(":");
    return parts[parts.length - 2] || project;
  }
  return project;
}

/** True when a row ignores this (source, key, project). Same rule as the SQL in repo/ignored.ts. */
export function matchesIgnored(
  rows: readonly Pick<IgnoredProject, "source" | "project">[],
  e: { source: Source; key: string; project?: string | null },
): boolean {
  const names = new Set([e.key, e.project ?? ""].filter(Boolean));
  return rows.some((r) => (r.source === e.source || r.source === "*") && names.has(r.project));
}
