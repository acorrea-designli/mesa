// Semáforo marks: a per-character model over the exact text. Every character holds
// at most one kind, so overlapping selections split or replace cleanly, and the
// <mark> runs are always rebuilt from the model (never nested).
import type { Mark, MarkKind } from "@/lib/domain/types";

export type CharKinds = (MarkKind | null)[];

export const MARK_KINDS: MarkKind[] = ["keep", "redo", "drop"];
export const MARK_LABEL: Record<MarkKind, string> = { keep: "Mantener", redo: "Reformular", drop: "Quitar" };
export const MARK_COUNT_LABEL: Record<MarkKind, string> = { keep: "mantener", redo: "reformular", drop: "quitar" };

const WORD = /[\p{L}\p{N}_'’-]/u;

export const emptyModel = (text: string): CharKinds => Array.from({ length: text.length }, () => null);

/** Build the model from stored marks (out-of-range parts are ignored; later marks win). */
export function fromMarks(text: string, marks: Mark[]): CharKinds {
  const m = emptyModel(text);
  for (const k of marks) {
    const a = Math.max(0, Math.min(k.start, text.length));
    const z = Math.max(a, Math.min(k.end, text.length));
    for (let i = a; i < z; i++) m[i] = k.kind;
  }
  return m;
}

/** Merge runs of the same kind into marks, with the text they cover. */
export function toMarks(text: string, m: CharKinds): Mark[] {
  const out: Mark[] = [];
  let i = 0;
  while (i < m.length) {
    const k = m[i];
    if (!k) {
      i++;
      continue;
    }
    const start = i;
    while (i < m.length && m[i] === k) i++;
    out.push({ start, end: i, kind: k, text: text.slice(start, i) });
  }
  return out;
}

/** Expand a raw selection to whole words, then trim surrounding whitespace. Null if empty. */
export function snapToWords(text: string, a: number, z: number): [number, number] | null {
  let s = Math.max(0, Math.min(a, z));
  let e = Math.min(text.length, Math.max(a, z));
  while (s > 0 && WORD.test(text[s - 1] ?? "")) s--;
  while (e < text.length && WORD.test(text[e] ?? "")) e++;
  while (s < e && /\s/.test(text[s] ?? "")) s++;
  while (e > s && /\s/.test(text[e - 1] ?? "")) e--;
  return s < e ? [s, e] : null;
}

/** Paint [a, z) with a kind. Whatever was there is replaced; neighbouring runs are split. */
export function paint(m: CharKinds, a: number, z: number, kind: MarkKind): CharKinds {
  const next = m.slice();
  for (let i = Math.max(0, a); i < Math.min(z, next.length); i++) next[i] = kind;
  return next;
}

/** Limpiar: unwrap every mark run the range touches (whole runs, not just the overlap). */
export function clearTouched(m: CharKinds, a: number, z: number): CharKinds {
  const next = m.slice();
  for (let j = Math.max(0, a); j < Math.min(z, next.length); j++) {
    const k = next[j];
    if (!k) continue;
    let l = j;
    let r = j;
    while (l > 0 && next[l - 1] === k) l--;
    while (r < next.length && next[r] === k) r++;
    for (let x = l; x < r; x++) next[x] = null;
  }
  return next;
}

/** The single kind covering the whole range, if any (drives aria-pressed on the toolbar). */
export function kindOf(m: CharKinds, a: number, z: number): MarkKind | null {
  const ks = new Set(m.slice(a, z));
  if (ks.size !== 1) return null;
  const [k] = [...ks];
  return k ?? null;
}

export function countMarks(marks: Mark[]): Record<MarkKind, number> {
  const c: Record<MarkKind, number> = { keep: 0, redo: 0, drop: 0 };
  for (const m of marks) c[m.kind]++;
  return c;
}

export interface Segment {
  text: string;
  kind: MarkKind | null;
  hit: boolean;
  start: number;
}

/** Render runs: split by mark kind and by an optional highlighted range (memory "aplica"). */
export function segments(text: string, m: CharKinds, hl?: [number, number] | null): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  const hitAt = (x: number) => Boolean(hl && x >= hl[0] && x < hl[1]);
  while (i < text.length) {
    const k = m[i] ?? null;
    const h = hitAt(i);
    const start = i;
    while (i < text.length && (m[i] ?? null) === k && hitAt(i) === h) i++;
    out.push({ text: text.slice(start, i), kind: k, hit: h, start });
  }
  return out;
}

/** Keep marks carry to the next version on identical text (first unused occurrence). */
export function carryKeeps(prevMarks: Mark[], nextText: string): Mark[] {
  const out: Mark[] = [];
  let from = 0;
  for (const k of prevMarks) {
    if (k.kind !== "keep" || !k.text) continue;
    let at = nextText.indexOf(k.text, from);
    if (at < 0) at = nextText.indexOf(k.text);
    if (at < 0) continue;
    if (out.some((o) => at < o.end && at + k.text.length > o.start)) continue;
    out.push({ start: at, end: at + k.text.length, kind: "keep", text: k.text });
    from = at + k.text.length;
  }
  return out.sort((a, b) => a.start - b.start);
}

/** What happened to each mark of a turn in the version that answered it. */
export function markOutcome(turnMarks: Mark[], nextText: string) {
  const kept = turnMarks.filter((m) => m.kind === "keep");
  const redo = turnMarks.filter((m) => m.kind === "redo");
  const drop = turnMarks.filter((m) => m.kind === "drop");
  return {
    keep: { total: kept.length, held: kept.filter((m) => nextText.includes(m.text)).length },
    redo: { total: redo.length, changed: redo.filter((m) => !nextText.includes(m.text)).map((m) => m.text) },
    drop: { total: drop.length, gone: drop.filter((m) => !nextText.includes(m.text)).map((m) => m.text) },
  };
}
