"use client";
// The PDF side of the review view (t125): pdf.js renders every page to a canvas with a selectable text layer, and
// the marks sit on top of each page in page units (the page's viewport at scale 1), so they line up at any zoom.
// pdf.js is loaded on the client only (it touches DOM globals at import time).
import type { PDFDocumentLoadingTask, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { Annotation, AnnotationGeometry, AnnotationKind } from "@/lib/domain/types";
import { arrowBarbs, clampPt, DRAG_MIN_PX, hitTest, mergeLineRects, r2, rectFromDrag, toPage, type Pt } from "./geometry";

type Pdfjs = typeof import("pdfjs-dist");

export type Tool = "highlight" | "note" | "rect" | "ellipse" | "arrow";

export interface DraftMark {
  page: number;
  kind: AnnotationKind;
  geometry: AnnotationGeometry;
  quote?: string;
}

const PAD = 20; // px around a page in the scroll area
const MIN_SCALE = 0.4;
const MAX_SCALE = 4;
const PIN_PX = 11; // pin radius on screen
const GRAB_PX = 6; // how near a click must be to a stroke to select it

export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

let pdfjsPromise: Promise<Pdfjs> | null = null;
function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import("pdfjs-dist").then((lib) => {
    // The worker comes from a route over the installed package (see src/app/api/pdf-worker/route.ts).
    lib.GlobalWorkerOptions.workerSrc ||= `/api/pdf-worker?v=${encodeURIComponent(lib.version)}`;
    return lib;
  });
  return pdfjsPromise;
}

interface PageInfo {
  proxy: PDFPageProxy;
  w: number;
  h: number;
}

interface Props {
  url: string;
  zoom: "fit" | number;
  onScale: (s: number) => void;
  tool: Tool;
  readOnly: boolean;
  marks: Annotation[];
  /** 1-based reading number of each mark, as the panel shows it. */
  order: Map<string, number>;
  selectedId: string | null;
  flash: { id: string; n: number } | null;
  /** Scroll to this mark (a click on its card). */
  focus: { id: string; n: number } | null;
  onSelect: (id: string | null) => void;
  onCreate: (m: DraftMark) => void;
  onPages: (n: number) => void;
}

export function PdfViewer({ url, zoom, onScale, tool, readOnly, marks, order, selectedId, flash, focus, onSelect, onCreate, onPages }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [lib, setLib] = useState<Pdfjs | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [boxW, setBoxW] = useState(0);

  // Load the document and every page's size (the shells need them to lay out before anything renders).
  useEffect(() => {
    let dead = false;
    let task: PDFDocumentLoadingTask | null = null;
    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        task = pdfjs.getDocument({ url });
        const doc = await task.promise;
        const proxies = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
        if (dead) return;
        setLib(pdfjs);
        setPages(proxies.map((proxy) => ({ proxy, w: proxy.getViewport({ scale: 1 }).width, h: proxy.getViewport({ scale: 1 }).height })));
        setState("ready");
      } catch {
        if (!dead) setState("error");
      }
    })();
    return () => {
      dead = true;
      void task?.destroy();
    };
  }, [url]);

  useEffect(() => onPages(pages.length), [pages.length, onPages]);

  // A drag that ends outside the text layer it started in (another page, the panel) must still end the selection.
  useEffect(() => {
    const done = () => document.querySelectorAll(".pr-text.selecting").forEach((el) => el.classList.remove("selecting"));
    document.addEventListener("pointerup", done);
    document.addEventListener("pointercancel", done);
    return () => {
      document.removeEventListener("pointerup", done);
      document.removeEventListener("pointercancel", done);
    };
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const maxW = useMemo(() => pages.reduce((m, p) => Math.max(m, p.w), 0), [pages]);
  const scale = zoom === "fit" ? (maxW && boxW ? clampScale((boxW - 2 * PAD) / maxW) : 1) : zoom;
  useEffect(() => onScale(scale), [scale, onScale]);

  // Scroll to the mark of a clicked card.
  useEffect(() => {
    if (!focus) return;
    const m = marks.find((x) => x.id === focus.id);
    const box = scroller.current;
    const pageEl = box?.querySelector<HTMLElement>(`[data-page="${m?.page}"]`);
    if (!m || !box || !pageEl) return;
    const top = pageEl.offsetTop + m.rect.y * scale - box.clientHeight / 3;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
    // Only a new request scrolls; the marks changing under it must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Subrayar: a text selection made in the page becomes one highlight per page it touches.
  const captureSelection = useCallback(() => {
    if (readOnly || tool !== "highlight") return;
    const sel = window.getSelection();
    const box = scroller.current;
    if (!sel || sel.isCollapsed || !sel.rangeCount || !box) return;
    const range = sel.getRangeAt(0);
    if (!box.contains(range.commonAncestorContainer)) return;
    const made: DraftMark[] = [];
    for (const pageEl of box.querySelectorAll<HTMLElement>("[data-page]")) {
      const layer = pageEl.querySelector<HTMLElement>(".pr-text");
      if (!layer || !range.intersectsNode(layer)) continue;
      // Only the text spans count: .pr-end (the box that keeps a selection from jumping) covers the whole page.
      const texts = [...layer.children].filter((c) => !c.classList.contains("pr-end"));
      const first = texts[0];
      const last = texts.at(-1);
      if (!first || !last) continue;
      const sub = range.cloneRange();
      if (!layer.contains(range.startContainer) || range.startContainer === layer) sub.setStartBefore(first);
      if (!layer.contains(range.endContainer) || range.endContainer === layer) sub.setEndAfter(last);
      const quote = sub.toString().replace(/\s+/g, " ").trim();
      if (!quote) continue;
      const at = pageEl.getBoundingClientRect();
      const lines = [...sub.getClientRects()].filter((c) => !(c.width >= at.width * 0.95 && c.height >= at.height * 0.5)); // never a whole-page box
      const rects = mergeLineRects(lines.map((c) => ({ x: (c.left - at.left) / scale, y: (c.top - at.top) / scale, w: c.width / scale, h: c.height / scale })));
      if (rects.length) made.push({ page: Number(pageEl.dataset.page), kind: "highlight", geometry: { rects }, quote });
    }
    sel.removeAllRanges();
    for (const m of made) onCreate(m);
  }, [readOnly, tool, scale, onCreate]);

  const inkOn = !readOnly && tool !== "highlight";
  return (
    <div className="pr-scroll" ref={scroller} onPointerUp={() => window.setTimeout(captureSelection, 0)}>
      {state === "loading" ? <p className="pr-note">Cargando el PDF…</p> : null}
      {state === "error" ? <p className="pr-note">No se pudo abrir el PDF. Descárgalo desde el ticket.</p> : null}
      <div className="pr-pages">
        {lib
          ? pages.map((p, i) => (
              <PageView
                key={i}
                lib={lib}
                info={p}
                num={i + 1}
                scale={scale}
                ink={inkOn ? tool : null}
                marks={marks.filter((m) => m.page === i + 1)}
                order={order}
                selectedId={selectedId}
                flash={flash}
                onSelect={onSelect}
                onCreate={onCreate}
              />
            ))
          : null}
      </div>
    </div>
  );
}

interface PageProps {
  lib: Pdfjs;
  info: PageInfo;
  num: number;
  scale: number;
  /** The drawing tool whose layer takes the pointer, or null (text selection and clicks on marks). */
  ink: Exclude<Tool, "highlight"> | null;
  marks: Annotation[];
  order: Map<string, number>;
  selectedId: string | null;
  flash: { id: string; n: number } | null;
  onSelect: (id: string | null) => void;
  onCreate: (m: DraftMark) => void;
}

function PageView({ lib, info, num, scale, ink, marks, order, selectedId, flash, onSelect, onCreate }: PageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [renderScale, setRenderScale] = useState(scale);
  const [draft, setDraft] = useState<{ kind: AnnotationKind; a: Pt; b: Pt } | null>(null);
  const drag = useRef<{ a: Pt; x: number; y: number } | null>(null);
  const W = info.w * scale;
  const H = info.h * scale;

  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(Boolean(e?.isIntersecting)), { rootMargin: "1400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The canvas re-renders once the zoom settles; until then the old bitmap is stretched.
  useEffect(() => {
    const t = window.setTimeout(() => setRenderScale(scale), 140);
    return () => window.clearTimeout(t);
  }, [scale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = info.proxy.getViewport({ scale: renderScale * dpr });
    const buffer = document.createElement("canvas"); // drawn off screen, swapped in whole: no blank flash on zoom
    buffer.width = Math.floor(viewport.width);
    buffer.height = Math.floor(viewport.height);
    const task: RenderTask = info.proxy.render({ canvas: buffer, viewport });
    let dead = false;
    task.promise.then(
      () => {
        if (dead) return;
        canvas.width = buffer.width;
        canvas.height = buffer.height;
        canvas.getContext("2d")?.drawImage(buffer, 0, 0);
      },
      () => undefined, // a cancelled render
    );
    return () => {
      dead = true;
      task.cancel();
    };
  }, [near, renderScale, info.proxy]);

  // The text layer is scale independent (its sizes follow --total-scale-factor), so it renders once per visit.
  useEffect(() => {
    const layer = textRef.current;
    if (!near || !layer) return;
    layer.replaceChildren();
    const textLayer = new lib.TextLayer({ textContentSource: info.proxy.streamTextContent(), container: layer, viewport: info.proxy.getViewport({ scale: 1 }) });
    let dead = false;
    textLayer.render().then(
      () => {
        if (dead) return;
        const end = document.createElement("div"); // keeps a selection from jumping across the gaps between lines
        end.className = "pr-end";
        layer.append(end);
      },
      () => undefined,
    );
    return () => {
      dead = true;
      textLayer.cancel();
      layer.replaceChildren();
    };
  }, [near, lib, info.proxy]);

  // Far from view the bitmap is released: a long PDF at 2x would hold gigabytes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near && canvas) canvas.width = 0;
  }, [near]);

  const pt = (e: { clientX: number; clientY: number }): Pt => {
    const box = pageRef.current!.getBoundingClientRect();
    return clampPt(toPage(e.clientX, e.clientY, box, scale), info.w, info.h);
  };
  const pick = (p: Pt) => hitTest(marks, num, p, GRAB_PX / scale, PIN_PX / scale);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !ink) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const a = pt(e);
    drag.current = { a, x: e.clientX, y: e.clientY };
    setDraft(ink === "note" ? null : { kind: ink, a, b: a });
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d && ink && ink !== "note") setDraft({ kind: ink, a: d.a, b: pt(e) });
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setDraft(null);
    if (!d || !ink) return;
    const b = pt(e);
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) >= DRAG_MIN_PX;
    if (!moved) {
      const hit = pick(b);
      if (hit) onSelect(hit.id);
      else if (ink === "note") onCreate({ page: num, kind: "note", geometry: { x: r2(b.x), y: r2(b.y) } });
      else onSelect(null);
      return;
    }
    if (ink === "arrow") onCreate({ page: num, kind: "arrow", geometry: { x1: r2(d.a.x), y1: r2(d.a.y), x2: r2(b.x), y2: r2(b.y) } });
    else if (ink === "rect" || ink === "ellipse") {
      const r = rectFromDrag(d.a, b);
      onCreate({ page: num, kind: ink, geometry: { x: r2(r.x), y: r2(r.y), w: r2(r.w), h: r2(r.h) } });
    }
  };

  // Text layer: a plain click (no selection made) picks the mark under it.
  const clickText = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const hit = pick(pt(e));
    onSelect(hit?.id ?? null);
  };

  const flashing = (id: string) => (flash?.id === id ? `flash-${flash.n % 2}` : "");
  const pins = marks.filter((m) => m.kind === "note");
  const cls = (m: Annotation) => ["pr-m", m.author === "claude" ? "claude" : "", m.state === "resolved" ? "done" : "", selectedId === m.id ? "on" : "", flashing(m.id)].filter(Boolean).join(" ");

  return (
    <div className="pr-page" data-page={num} ref={pageRef} style={{ width: W, height: H, "--total-scale-factor": scale } as CSSProperties}>
      <canvas ref={canvasRef} className="pr-canvas" style={{ width: W, height: H }} />
      <svg className="pr-svg" viewBox={`0 0 ${info.w} ${info.h}`} width={W} height={H} aria-hidden="true">
        {marks.map((m) => {
          const g = m.geometry;
          if (m.kind === "highlight" && "rects" in g) {
            return (
              <g key={m.id} className={cls(m)}>
                {g.rects.map((r, i) => (
                  <rect key={i} className="pr-hl" x={r.x} y={r.y} width={r.w} height={r.h} />
                ))}
              </g>
            );
          }
          if (m.kind === "rect" && "w" in g) return <rect key={m.id} className={cls(m) + " pr-shape"} x={g.x} y={g.y} width={g.w} height={g.h} />;
          if (m.kind === "ellipse" && "w" in g) return <ellipse key={m.id} className={cls(m) + " pr-shape"} cx={g.x + g.w / 2} cy={g.y + g.h / 2} rx={g.w / 2} ry={g.h / 2} />;
          if (m.kind === "arrow" && "x1" in g) return <Arrow key={m.id} className={cls(m) + " pr-shape"} a={{ x: g.x1, y: g.y1 }} b={{ x: g.x2, y: g.y2 }} scale={scale} />;
          return null;
        })}
        {draft ? <Draft draft={draft} scale={scale} /> : null}
      </svg>
      <div ref={textRef} className="pr-text" onClick={clickText} onPointerDown={(e) => e.currentTarget.classList.add("selecting")} onPointerUp={(e) => e.currentTarget.classList.remove("selecting")} />
      <div className={"pr-ink" + (ink ? ` on ${ink}` : "")} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => ((drag.current = null), setDraft(null))} />
      {pins.map((m) => (
        <button
          key={m.id}
          type="button"
          className={cls(m) + " pr-pin"}
          style={{ left: (m.geometry as { x: number }).x * scale, top: (m.geometry as { y: number }).y * scale }}
          aria-label={`Comentario ${order.get(m.id) ?? ""}`}
          aria-pressed={selectedId === m.id}
          onClick={() => onSelect(m.id)}
        >
          {order.get(m.id)}
        </button>
      ))}
    </div>
  );
}

function Arrow({ a, b, scale, className }: { a: Pt; b: Pt; scale: number; className: string }) {
  const [p, q] = arrowBarbs(a, b, 12 / scale);
  return (
    <g className={className}>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <polyline points={`${p.x},${p.y} ${b.x},${b.y} ${q.x},${q.y}`} />
    </g>
  );
}

function Draft({ draft, scale }: { draft: { kind: AnnotationKind; a: Pt; b: Pt }; scale: number }) {
  const { kind, a, b } = draft;
  if (kind === "arrow") return <Arrow className="pr-m pr-shape draft" a={a} b={b} scale={scale} />;
  const r = rectFromDrag(a, b);
  if (kind === "ellipse") return <ellipse className="pr-m pr-shape draft" cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} />;
  return <rect className="pr-m pr-shape draft" x={r.x} y={r.y} width={r.w} height={r.h} />;
}
