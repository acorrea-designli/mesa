// Links in ticket text: find the addresses and ticket refs in a piece of text, decide which ones are safe
// to open, and say what each one is (a PR, a CI run, a Slack thread, a Basecamp thread). Pure: the
// Thread renders the segments as React elements (never HTML) and related.ts matches resources by key.
import type { Source } from "./types";

export type LinkKind = "pr" | "issue" | "run" | "slack" | "basecamp" | "github" | "other";

export interface LinkInfo {
  /** Absolute http(s) address: the only thing a link may open. */
  href: string;
  kind: LinkKind;
  source?: Source;
  /** Short label of a known resource ("repo#12", "CI · repo", "Slack", "Basecamp"); null for any other address. */
  label: string | null;
  /** owner/repo (lower case) of a GitHub address. */
  repo?: string;
  /** PR, issue or run number of a GitHub address. */
  n?: number;
}

export type Segment =
  | { t: "text"; v: string }
  | { t: "link"; v: string; link: LinkInfo }
  | { t: "ticket"; v: string; ref: string };

const HOSTS = "github\\.com|slack\\.com|basecamp\\.com";
// A candidate starts after a non-word character, so "xgithub.com/..." and "a@github.com/..." are not links.
// "javascript:", "data:", "file:" and the like never match: only http(s):// or a known bare host starts one.
const URL_SRC = `(?:https?:\\/\\/|(?:[a-z0-9-]+\\.)*(?:${HOSTS})(?=\\/))[^\\s<>|]*`;
const TICKET_SRC = "(@?)t(\\d+)(?![\\w-])";
const BOUND = "(?<![\\w.@/:-])";

const count = (s: string, c: string) => s.split(c).length - 1;

/** Drop what belongs to the sentence, not to the address: trailing punctuation and an unbalanced ")" or "]". */
export function trimUrl(raw: string): string {
  let u = raw;
  for (;;) {
    const last = u[u.length - 1];
    if (last === undefined) return u;
    const unbalanced = (last === ")" && count(u, ")") > count(u, "(")) || (last === "]" && count(u, "]") > count(u, "["));
    if (/[.,;:!?'"*_~`>}]/.test(last) || unbalanced) u = u.slice(0, -1);
    else return u;
  }
}

function parse(raw: string): URL | null {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname.includes(".")) return null;
    return u;
  } catch {
    return null;
  }
}

/** The https/http address a piece of text stands for, or null when it must stay text (unsafe scheme, not an address). */
export function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t || /[\u0000-\u001f\u007f\s]/.test(t)) return null;
  // A bare address only counts for the known hosts; anything else needs its scheme.
  if (!/^https?:\/\//i.test(t) && !new RegExp(`^(?:[a-z0-9-]+\\.)*(?:${HOSTS})(?:/|$)`, "i").test(t)) return null;
  const u = parse(t);
  return u ? u.href : null;
}

const hostIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function classify(href: string): LinkInfo | null {
  const norm = normalizeUrl(href);
  if (!norm) return null;
  const u = new URL(norm);
  const host = u.hostname.toLowerCase();
  const base = { href: norm };
  if (hostIs(host, "slack.com")) return { ...base, kind: "slack", source: "slack", label: "Slack" };
  if (hostIs(host, "basecamp.com")) return { ...base, kind: "basecamp", source: "basecamp", label: "Basecamp" };
  if (host === "github.com" || host === "www.github.com") {
    const [owner, name, a, b, c] = u.pathname.split("/").filter(Boolean);
    if (owner && name) {
      const repo = `${owner}/${name}`.toLowerCase();
      const num = Number(b);
      const isNum = /^\d+$/.test(b ?? "");
      if (a === "pull" && isNum) return { ...base, kind: "pr", source: "github", label: `${name}#${num}`, repo, n: num };
      if (a === "issues" && isNum) return { ...base, kind: "issue", source: "github", label: `${name}#${num}`, repo, n: num };
      if (a === "actions" && b === "runs" && /^\d+$/.test(c ?? "")) return { ...base, kind: "run", source: "github", label: `CI · ${name}`, repo, n: Number(c) };
      return { ...base, kind: "github", source: "github", label: null, repo };
    }
    return { ...base, kind: "github", source: "github", label: null };
  }
  return { ...base, kind: "other", label: null };
}

/** The PR an address points at, in any of its URL forms (/pull/N, /files, /checks, bare host), as "owner/repo#n". */
export function prIdentity(url: string): string | null {
  const l = classify(url);
  return l?.kind === "pr" && l.repo && l.n !== undefined ? prKey(l.repo, l.n) : null;
}

export const prKey = (repo: string, n: number) => `${repo.toLowerCase()}#${n}`;

export const prUrl = (repo: string, n: number) => `https://github.com/${repo}/pull/${n}`;
export const checksUrl = (repo: string, n: number) => `https://github.com/${repo}/pull/${n}/checks`;

/**
 * What identifies the resource behind an address, so two addresses of the same thing are one: a PR (any
 * form), an issue, a CI run, a Slack message (host, path and thread) or a Basecamp page (no fragment or
 * query). Anything else has no key.
 */
export function resourceKey(url: string): string | null {
  const l = classify(url);
  if (!l) return null;
  const u = new URL(l.href);
  const path = u.pathname.replace(/\/+$/, "").toLowerCase();
  if (l.kind === "pr" && l.repo && l.n !== undefined) return `pr:${prKey(l.repo, l.n)}`;
  if (l.kind === "issue" && l.repo && l.n !== undefined) return `issue:${prKey(l.repo, l.n)}`;
  if (l.kind === "run" && l.repo && l.n !== undefined) return `run:${l.repo}#${l.n}`;
  if (l.kind === "slack") {
    const thread = u.searchParams.get("thread_ts");
    return `slack:${u.hostname.toLowerCase()}${path}${thread ? `?thread_ts=${thread}` : ""}`;
  }
  if (l.kind === "basecamp") return `basecamp:${u.hostname.toLowerCase()}${path}`;
  return null;
}

/** Same as resourceKey, falling back to the plain normalized address (so an item and a ref to one page still dedupe). */
export const linkKey = (url: string): string | null => resourceKey(url) ?? normalizeUrl(url)?.replace(/#.*$/, "").replace(/\/+$/, "") ?? null;

/** Every address in a text, normalized, in order, without duplicates. */
export function urlsIn(text: string): string[] {
  const out: string[] = [];
  for (const s of tokenize(text)) if (s.t === "link" && !out.includes(s.link.href)) out.push(s.link.href);
  return out;
}

/** Keep the ends of a long address and drop the middle: "https://github.com/o/r/…/files". */
export function middleTruncate(s: string, max = 48): string {
  if (s.length <= max) return s;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  return `${s.slice(0, head)}…${s.slice(s.length - (keep - head))}`;
}

/**
 * Split a text into plain text, links and ticket refs. Only http(s) addresses and the bare github, slack
 * and basecamp hosts become links; "@t49" and a word-bounded "t49" become ticket refs when that ticket is
 * in `tickets`. Concatenating every segment's `v` gives the original text back.
 */
export function tokenize(text: string, tickets: ReadonlySet<string> | readonly string[] = []): Segment[] {
  const known = tickets instanceof Set ? tickets : new Set(tickets);
  const re = new RegExp(`${BOUND}(?:(${URL_SRC})|${TICKET_SRC})`, "gi");
  const out: Segment[] = [];
  let at = 0;
  const push = (v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last?.t === "text") last.v += v;
    else out.push({ t: "text", v });
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let end = m.index + m[0].length;
    if (m[1] !== undefined) {
      const url = trimUrl(m[1]);
      const link = url ? classify(url) : null;
      if (!link || !url) {
        re.lastIndex = m.index + 1; // not an address after all: keep scanning inside it
        continue;
      }
      end = m.index + url.length;
      push(text.slice(at, m.index));
      out.push({ t: "link", v: url, link });
    } else {
      const ref = `t${m[3]}`;
      if (!known.has(ref)) continue;
      push(text.slice(at, m.index));
      out.push({ t: "ticket", v: m[0], ref });
    }
    re.lastIndex = end;
    at = end;
  }
  push(text.slice(at));
  return out;
}
