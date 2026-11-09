// A Claude reply on a ticket with a review card that repeats the card's findings (a list with path:line, written
// before hook G12 kept reviewer replies to one line). The thread folds it: first line plus "Ver texto completo".
// Pure: no I/O, no React.

/** `path/file.ext:NN`, the same shape hook G12 refuses in a reviewer reply. */
const PATH_LINE = /[\w./\x5c-]*\w\.[A-Za-z][A-Za-z0-9]{0,5}:\d+\b/;

const nonEmptyLines = (s: string) => s.split(/\r?\n/).filter((l) => l.trim());

/** The file of a finding anchor: "src/a.ts:42" and "src/a.ts:42-50" give "src/a.ts"; "" when there is none. */
function findingPath(at: string): string {
  const m = /^(.+?):\d+(?:-\d+)?$/.exec(at.trim());
  return (m ? m[1]! : at).trim();
}

export interface RepeatMessage {
  author: string;
  body: string;
  options?: unknown[] | null;
}

/**
 * True when the message is a Claude reply that repeats the review card: more than 2 non-empty lines and either a
 * `path/file.ext:NN` reference or the file path of one of the ticket's findings. Needs a review on the ticket;
 * Andrés's messages and messages that carry options (a question he must answer) are never folded.
 */
export function repeatsReviewCard(m: RepeatMessage, findings: { at: string }[], hasReview: boolean): boolean {
  if (!hasReview || m.author !== "claude" || m.options?.length) return false;
  if (nonEmptyLines(m.body).length <= 2) return false;
  if (PATH_LINE.test(m.body)) return true;
  return findings.some((f) => {
    const p = findingPath(f.at);
    return p.length > 0 && /[./\x5c]/.test(p) && m.body.includes(p);
  });
}

/** The first non-empty line, trimmed: what stays visible when the message is folded. */
export const firstLine = (body: string): string => nonEmptyLines(body)[0]?.trim() ?? "";
