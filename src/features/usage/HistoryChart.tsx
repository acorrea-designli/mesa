"use client";
// The % used over a plan window (Semana = 7 days, 5 h = 5 hours): a 2 px ink line from the history points, a dashed
// straight pace line from 0 at the window start to 100 at the reset, and a crosshair that reads the exact time and %
// of the nearest point (pointer, or the arrow keys when the plot has focus). No history yet draws the axes with a
// dotted line, the out-of-service idiom, and one short line of copy: never an error.
// The curve is an SVG stretched over the plot with non-scaling strokes; the axes, dots and labels are HTML so text and
// circles never distort.
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { stampLabel, type ChartSeries } from "@/lib/domain/usage";
import { Tip } from "./Tip";
import "./usage.css";

/** The window's start or end as "jue 12 · 13:30"; a window inside one day (5 h) drops the repeated day: "13:30". */
function edge(start: number, end: number, which: 0 | 1): string {
  const [a = "", at = ""] = stampLabel(start).split(" · ");
  const [b = "", bt = ""] = stampLabel(end).split(" · ");
  return a === b ? (which === 0 ? at : bt) : stampLabel(which === 0 ? start : end);
}

// What each mark means. The chart is % USED, the same reading as the plan bar above (it fills left to right as the plan is spent), so the line climbs.
const TIP_LINE = "Lo que has usado de verdad, medición a medición. La gráfica muestra % usado: sube igual que se llena la barra de arriba.";
const TIP_EVEN = "Gastar parejo: 0% al empezar la ventana y 100% al reiniciar. Por encima de esta línea gastas más rápido que el reloj.";
const TIP_DOT = "Última medición. Con el cursor, el dedo o las flechas sobre la gráfica se mueve a la que elijas; el texto de arriba la lee.";

const fmtPct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1).replace(".", ",")}%`;

export function HistoryChart({ title, series }: { title: string; series: ChartSeries | null }) {
  const pts = series?.points ?? [];
  const [active, setActive] = useState<number | null>(null);
  const last = pts.length - 1;
  const at = active !== null && active <= last ? active : last;
  const cur = at >= 0 ? pts[at] : undefined;

  const nearest = (x: number) => {
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i]!.x - x) < Math.abs(pts[best]!.x - x)) best = i;
    return best;
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (pts.length === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    setActive(nearest(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (pts.length === 0) return;
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "Home" ? -Infinity : e.key === "End" ? Infinity : 0;
    if (step === 0) return;
    e.preventDefault();
    setActive(Math.min(last, Math.max(0, step === -Infinity ? 0 : step === Infinity ? last : at + step)));
  };

  const line = pts.map((p) => `${(p.x * 100).toFixed(3)},${(100 - p.used).toFixed(2)}`).join(" ");
  const readout = cur ? `${stampLabel(cur.t)} · ${fmtPct(cur.used)} usado` : "";

  return (
    <figure className="us-chart">
      <figcaption className="us-chart-head">
        <h3 className="us-h">
          {title} <small>% usado</small>
        </h3>
        <span className="us-read" aria-live="off">
          {readout}
        </span>
      </figcaption>
      <div className="us-yax" aria-hidden="true">
        <span style={{ bottom: "100%" }}>100%</span>
        <span style={{ bottom: "50%" }}>50%</span>
        <span style={{ bottom: "0%" }}>0</span>
      </div>
      <div
        className="us-plot"
        tabIndex={pts.length ? 0 : undefined}
        role="group"
        aria-label={`${title}: % usado en la ventana${pts.length ? `. ${pts.length} mediciones; flechas para recorrerlas. ${readout}` : ", sin mediciones"}`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        <span className="us-grid" style={{ bottom: "0%" }} />
        <span className="us-grid" style={{ bottom: "50%" }} />
        <span className="us-grid" style={{ bottom: "100%" }} />
        {pts.length === 0 ? (
          <span className="us-dotline" />
        ) : (
          <>
            <svg className="us-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <line className="us-pace" x1="0" y1="100" x2="100" y2="0" />
              {pts.length > 1 ? <polyline className="us-curve" points={line} /> : null}
            </svg>
            {cur ? (
              <>
                {active !== null ? <span className="us-xhair" style={{ left: `${cur.x * 100}%` }} /> : null}
                <span className="us-dot" style={{ left: `${cur.x * 100}%`, bottom: `${cur.used}%` }} />
              </>
            ) : null}
          </>
        )}
      </div>
      <div className="us-xax" aria-hidden="true">
        {series ? (
          <>
            <span>{edge(series.start, series.end, 0)}</span>
            <span>{edge(series.start, series.end, 1)}</span>
          </>
        ) : null}
      </div>
      {pts.length === 0 ? null : (
        <div className="us-ckeys">
          {pts.length > 1 ? (
            <Tip tip={TIP_LINE} btnClass="us-tip-txt">
              <i className="us-g-line" aria-hidden="true" /> uso
            </Tip>
          ) : null}
          <Tip tip={TIP_EVEN} btnClass="us-tip-txt">
            <i className="us-g-even" aria-hidden="true" /> ritmo parejo
          </Tip>
          <Tip tip={TIP_DOT} btnClass="us-tip-txt">
            <i className="us-g-dot" aria-hidden="true" /> medición
          </Tip>
        </div>
      )}
      {pts.length === 0 ? <p className="us-chart-empty">Sin historial todavía: la curva se dibuja con cada medición.</p> : null}
    </figure>
  );
}
