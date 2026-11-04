"use client";
// "Texto que se enviará" with semáforo marks. Select words (drag, double-click,
// touch, or the keyboard: arrows pick a word, Shift+arrows extend) and the fixed
// toolbar offers Mantener / Reformular / Quitar / Limpiar (K/R/Q/Esc). Marks are
// rebuilt from the per-character model in ./marks, so overlaps split cleanly.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Mark, MarkKind, Source } from "@/lib/domain/types";
import { paintMarks, rise } from "@/lib/motion";
import { clearTouched, fromMarks, kindOf, paint, segments, snapToWords, toMarks } from "./marks";
import { SwClear, SwDrop, SwKeep, SwRedo } from "./icons";

const KEYS: Record<string, MarkKind> = { k: "keep", r: "redo", q: "drop" };

function offsetIn(root: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

function words(text: string): [number, number][] {
  return [...text.matchAll(/[\p{L}\p{N}_'’-]+/gu)].map((m) => [m.index, m.index + m[0].length]);
}

export interface SemaforoProps {
  text: string;
  source: Source;
  marks: Mark[];
  onMarks?: (m: Mark[]) => void;
  /** Locked (sending, scheduled, sent, rewrite pending): no selection, no toolbar. */
  locked?: boolean;
  /** Phrase outlined from the memory panel ("aplica a este mensaje"). */
  highlight?: string | null;
  className?: string;
  label?: string;
}

export function SemaforoText({ text, source, marks, onMarks, locked, highlight, className, label = "Texto que se enviará" }: SemaforoProps) {
  const ref = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ a: number; z: number; x: number; y: number; kb?: boolean } | null>(null);
  const [kbWord, setKbWord] = useState<{ a: number; z: number } | null>(null);
  const painted = useRef<[number, number] | null>(null);
  const model = useMemo(() => fromMarks(text, marks), [text, marks]);
  const hl = useMemo<[number, number] | null>(() => {
    if (!highlight) return null;
    const i = text.toLowerCase().indexOf(highlight.toLowerCase());
    return i < 0 ? null : [i, i + highlight.length];
  }, [text, highlight]);
  const segs = useMemo(() => segments(text, model, kbWord ? [kbWord.a, kbWord.z] : hl), [text, model, kbWord, hl]);
  const editable = Boolean(onMarks) && !locked;

  const hide = useCallback(() => setSel(null), []);

  const place = useCallback((a: number, z: number, kb = false) => {
    const root = ref.current;
    if (!root) return;
    let rect: DOMRect | null = null;
    if (kb) {
      const el = root.querySelector<HTMLElement>(`[data-s="${a}"]`) ?? root;
      rect = el.getBoundingClientRect();
    } else {
      const s = window.getSelection();
      if (s?.rangeCount) rect = s.getRangeAt(0).getBoundingClientRect();
    }
    if (!rect) return;
    setSel({ a, z, x: rect.left + rect.width / 2, y: rect.top, kb });
  }, []);

  const readSelection = useCallback(() => {
    const root = ref.current;
    const s = window.getSelection();
    if (!root || !s || !s.rangeCount || s.isCollapsed) return;
    const r = s.getRangeAt(0);
    if (!root.contains(r.commonAncestorContainer)) return;
    const snapped = snapToWords(text, offsetIn(root, r.startContainer, r.startOffset), offsetIn(root, r.endContainer, r.endOffset));
    if (!snapped) return hide();
    setKbWord(null);
    place(snapped[0], snapped[1]);
  }, [text, place, hide]);

  const apply = useCallback(
    (k: MarkKind | null) => {
      if (!sel || !onMarks) return;
      const next = k ? paint(model, sel.a, sel.z, k) : clearTouched(model, sel.a, sel.z);
      painted.current = k ? [sel.a, sel.z] : null;
      onMarks(toMarks(text, next));
      window.getSelection()?.removeAllRanges();
      setSel(null);
      if (!sel.kb) setKbWord(null);
    },
    [sel, model, onMarks, text],
  );

  // Paint new marks in like a highlighter.
  useEffect(() => {
    const p = painted.current;
    const root = ref.current;
    if (!p || !root) return;
    painted.current = null;
    paintMarks([...root.querySelectorAll<HTMLElement>("mark[data-s]")].filter((m) => Number(m.dataset.s) >= p[0] && Number(m.dataset.s) < p[1]));
  }, [marks]);

  useEffect(() => {
    if (sel && barRef.current) rise(barRef.current);
  }, [sel?.a, sel?.z, sel]);

  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = KEYS[e.key.toLowerCase()];
      if (k) {
        e.preventDefault();
        e.stopPropagation();
        apply(k);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSel(null);
        setKbWord(null);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (barRef.current?.contains(e.target as Node) || ref.current?.contains(e.target as Node)) return;
      setSel(null);
    };
    const onScroll = () => setSel(null);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [sel, apply]);

  // Keyboard selection by words.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!editable) return;
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const ws = words(text);
    if (!ws.length) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const cur = kbWord;
    let next: { a: number; z: number };
    if (!cur) next = { a: ws[0]![0], z: ws[0]![1] };
    else if (e.shiftKey) {
      const endIdx = ws.findIndex((w) => w[1] === cur.z);
      const ni = Math.max(0, Math.min(ws.length - 1, endIdx + dir));
      const z = ws[ni]![1];
      next = z <= cur.a ? { a: cur.a, z: ws[ws.findIndex((w) => w[0] === cur.a)]![1] } : { a: cur.a, z };
    } else {
      const i = ws.findIndex((w) => w[0] === cur.a);
      const ni = Math.max(0, Math.min(ws.length - 1, i + dir));
      next = { a: ws[ni]![0], z: ws[ni]![1] };
    }
    setKbWord(next);
    requestAnimationFrame(() => place(next.a, next.z, true));
  };

  const counts = { keep: 0, redo: 0, drop: 0 };
  for (const m of marks) counts[m.kind]++;
  const pressed = sel ? kindOf(model, sel.a, sel.z) : null;

  return (
    <>
      <div
        ref={ref}
        className={["msg", `src-${source}`, className].filter(Boolean).join(" ")}
        data-sema={editable ? "" : undefined}
        tabIndex={editable ? 0 : undefined}
        role={editable ? "textbox" : undefined}
        aria-readonly={editable ? true : undefined}
        aria-label={editable ? `${label}. Selecciona palabras para marcarlas: flechas eligen una palabra, Mayúsculas y flechas extienden, K mantener, R reformular, Q quitar.` : label}
        aria-describedby={undefined}
        onMouseUp={editable ? () => setTimeout(readSelection, 0) : undefined}
        onTouchEnd={editable ? () => setTimeout(readSelection, 0) : undefined}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!sel?.kb) setKbWord(null);
        }}
      >
        {segs.map((s) => {
          const cls = s.hit ? (kbWord ? "sm-sel" : "mem-hit") : undefined;
          if (s.kind)
            return (
              <mark key={s.start} data-s={s.start} className={[`m-${s.kind}`, cls].filter(Boolean).join(" ")}>
                {s.text}
              </mark>
            );
          return cls ? (
            <span key={s.start} data-s={s.start} className={cls}>
              {s.text}
            </span>
          ) : (
            <span key={s.start} data-s={s.start}>
              {s.text}
            </span>
          );
        })}
        {editable && (counts.keep || counts.redo || counts.drop) ? (
          <span className="sr-only">
            {` Marcas: ${counts.keep} mantener, ${counts.redo} reformular, ${counts.drop} quitar.`}
          </span>
        ) : null}
      </div>
      {sel && editable
        ? createPortal(
            <div
              ref={barRef}
              className="sm-bar sm-float"
              role="toolbar"
              aria-label="Marcar con semáforo"
              style={{ left: Math.max(8, Math.min(window.innerWidth - 380, sel.x - 180)), top: Math.max(8, sel.y - 50) }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <button type="button" aria-pressed={pressed === "keep"} onClick={() => apply("keep")}>
                <SwKeep />
                Mantener<kbd>K</kbd>
              </button>
              <button type="button" aria-pressed={pressed === "redo"} onClick={() => apply("redo")}>
                <SwRedo />
                Reformular<kbd>R</kbd>
              </button>
              <button type="button" aria-pressed={pressed === "drop"} onClick={() => apply("drop")}>
                <SwDrop />
                Quitar<kbd>Q</kbd>
              </button>
              <span className="sep" />
              <button type="button" onClick={() => apply(null)}>
                <SwClear />
                Limpiar<kbd>Esc</kbd>
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** "Con marcas: 3 mantener · 2 reformular · 1 quitar ×" above the refine input. */
export function MarksChip({ marks, onClear }: { marks: Mark[]; onClear: () => void }) {
  const c = { keep: 0, redo: 0, drop: 0 };
  for (const m of marks) c[m.kind]++;
  if (!marks.length) return null;
  return (
    <div className="sm-att">
      <span>Con marcas:</span>
      {c.keep ? (
        <>
          <SwKeep />
          <b>{c.keep}</b> mantener
        </>
      ) : null}
      {c.keep && (c.redo || c.drop) ? " ·" : null}
      {c.redo ? (
        <>
          <SwRedo />
          <b>{c.redo}</b> reformular
        </>
      ) : null}
      {c.redo && c.drop ? " ·" : null}
      {c.drop ? (
        <>
          <SwDrop />
          <b>{c.drop}</b> quitar
        </>
      ) : null}
      <button type="button" aria-label="Quitar las marcas" onClick={onClear}>
        <SwClear />
      </button>
    </div>
  );
}
