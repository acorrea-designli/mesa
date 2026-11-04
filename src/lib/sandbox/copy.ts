// The `sandbox.copy` settings row: what the sandbox board's data is a copy of (written by
// `pnpm sandbox:reset`, shown in the SANDBOX band). Read-only helpers, safe to import from the app.
import type { Db } from "../db/sqlite";

export type SandboxFrom = "live" | "seed";

export const SANDBOX_COPY_KEY = "sandbox.copy";

export interface SandboxCopy {
  from: SandboxFrom;
  /** The live DB path for `live`. */
  source: string | null;
  copiedAt: string;
  /** Rows per table in the copy, after the scrub. */
  rows: Record<string, number>;
  scrubbed: ScrubReport;
}

export interface ScrubReport {
  wakeEvents: number;
  sessions: number;
  agentsRetired: number;
  salidasToPending: number;
  approvalsExpired: number;
  tasksUnlinked: number;
  githubSettings: number;
  samplesUnflagged: number;
}

export function readSandboxCopy(db: Db): SandboxCopy | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(SANDBOX_COPY_KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SandboxCopy;
  } catch {
    return null;
  }
}
