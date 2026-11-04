// One-way, read-only import of pr-monitor's review state into Mesa reviews, so findings
// that pr-monitor tracks are not lost when the mesa-review skill takes over. The file is
// owned by pr-monitor: Mesa only reads it and never writes, moves or disables anything.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Repos } from "../repo";
import type { Finding, FindingState } from "../domain/types";

export const PR_MONITOR_STATE = process.env.MESA_PR_MONITOR_STATE ?? join(homedir(), ".claude-work", "pr-monitor-state.json");

interface MonitorFinding {
  id?: number;
  label?: string;
  at?: string;
  anchor?: string;
  summary?: string;
  explanation?: string;
  state?: string;
  sha?: string;
  ghCommentId?: number | string | null;
}
interface MonitorPr {
  head?: string;
  findings?: MonitorFinding[];
}

const LABELS = new Set<Finding["label"]>(["blocker", "nit", "comment"]);
const STATES = new Set<FindingState>(["open", "fixed", "waived", "dismissed"]);

export interface ImportResult {
  prs: number;
  findings: number;
  skipped: number;
}

/** Import findings of every PR in the state (keyed "owner/repo#n"). Findings already in Mesa are left alone. */
export function importPrMonitorState(r: Repos, state: unknown, now = new Date()): ImportResult {
  const prs = (state as { prs?: Record<string, MonitorPr | string> } | null)?.prs ?? {};
  const out: ImportResult = { prs: 0, findings: 0, skipped: 0 };
  for (const [key, raw] of Object.entries(prs)) {
    const m = /^([^/\s]+\/[^#\s]+)#(\d+)$/.exec(key);
    if (!m || typeof raw !== "object" || !raw.findings?.length) continue;
    const repo = m[1]!;
    const pr = Number(m[2]);
    let any = false;
    for (const [i, f] of raw.findings.entries()) {
      const n = f.id ?? i + 1;
      const exists = r.db
        .prepare("SELECT 1 FROM review_findings f JOIN reviews v ON v.id = f.review_id WHERE v.repo = ? AND v.pr = ? AND f.n = ?")
        .get(repo, pr, n);
      if (exists || !f.summary) {
        out.skipped++;
        continue;
      }
      r.reviews.upsertFinding(
        null,
        {
          repo,
          pr,
          n,
          label: LABELS.has(f.label as Finding["label"]) ? (f.label as Finding["label"]) : "comment",
          at: f.at,
          anchor: f.anchor,
          summary: f.summary,
          explanation: f.explanation,
          state: STATES.has(f.state as FindingState) ? (f.state as FindingState) : "open",
          sha: f.sha ?? raw.head,
          ghCommentId: f.ghCommentId == null ? null : String(f.ghCommentId),
        },
        now,
      );
      out.findings++;
      any = true;
    }
    if (any) out.prs++;
  }
  return out;
}

export function readPrMonitorState(path = PR_MONITOR_STATE): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}
