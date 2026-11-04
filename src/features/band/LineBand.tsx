"use client";
// The line band (signature): four source lines through five station capsules,
// items as ticks, interchange rings for items linked to two sources.
// Motion: lines draw in, ticks roll in, rings pop (useLayLines); when an item
// changes station its tick travels along its line (jumps under reduced motion).
import { animate } from "motion";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { STATION_LABEL, STATIONS, type Source, type Station } from "@/lib/domain/types";
import { EASE, prefersReducedMotion, useLayLines } from "@/lib/motion";
import { BAND_H, BAND_W, CAP_H, CAP_TOP, CAP_W, layoutBand, linePath, RING_R, solidEnd, TICK_R, type BandItem } from "./layout";

export const SV: Record<Source, string> = { github: "gh", slack: "sl", claude: "cl", basecamp: "bc" };

export interface LineBandProps {
  items: BandItem[];
  counts: Record<Station, number>;
  station: Station;
  source: Source | "all";
  /** Sources whose line is out of service (dotted). */
  down?: Source[];
  onStation: (s: Station) => void;
  /** Greyscale, read only (phone offline). */
  stale?: boolean;
}

/** Width of the element, observed; the mock's 1256 until measured. */
function useWidth<T extends Element>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(720, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Remember where each tick was; when it lands somewhere else, travel there along its line. */
function useTravel(svg: React.RefObject<SVGSVGElement | null>, positions: Map<string, { x: number; y: number }>) {
  const prev = useRef<Map<string, { x: number; y: number }> | null>(null);
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = positions;
    if (!before || !svg.current || prefersReducedMotion()) return;
    for (const [id, p] of positions) {
      const o = before.get(id);
      if (!o || (o.x === p.x && o.y === p.y)) continue;
      const el = svg.current.querySelector<SVGElement>(`[data-tick="${CSS.escape(id)}"]`);
      if (!el) continue;
      el.style.transformBox = "fill-box";
      animate(el, { transform: [`translate(${o.x - p.x}px, ${o.y - p.y}px)`, "translate(0px, 0px)"] }, { duration: 0.8, ease: EASE });
    }
  }, [positions, svg]);
}

export function LineBand({ items, counts, station, source, down = [], onStation, stale }: LineBandProps) {
  const [wrap, width] = useWidth<HTMLDivElement>(BAND_W);
  const svg = useLayLines<SVGSVGElement>();
  const layout = useMemo(() => layoutBand(items, width), [items, width]);
  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const t of layout.ticks) m.set(t.id, { x: t.x, y: t.y });
    for (const r of layout.rings) {
      m.set(r.ids[0], { x: r.upper.x, y: r.upper.y });
      m.set(r.ids[1], { x: r.lower.x, y: r.lower.y });
    }
    return m;
  }, [layout]);
  useTravel(svg, positions);

  const sel = STATIONS.indexOf(station);
  const end = solidEnd(station, width);
  const filtered = source !== "all";
  const lineOpacity = (s: Source) => (filtered && s !== source ? 0.14 : 1);
  const markOpacity = (s: Source) => (filtered && s !== source ? 0.28 : down.includes(s) ? 0.35 : 1);
  const dash = (s: Source) => (down.includes(s) ? " sv-dash" : "");

  const onKey = (s: Station) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onStation(s);
    }
  };

  const label = STATIONS.map((s) => `${STATION_LABEL[s]} ${counts[s]}`).join(", ");

  return (
    <div ref={wrap} className={stale ? "bd-wrap is-stale" : "bd-wrap"}>
      <svg
        ref={svg}
        className="bd-net"
        width={width}
        height={BAND_H}
        viewBox={`0 0 ${width} ${BAND_H}`}
        role="group"
        aria-label={`Línea del día: ${label}`}
      >
        <g className="bd-ln" opacity={0.38}>
          {layout.lines.map((l) => (
            <path key={l.source} d={l.d} className={`s-${SV[l.source]}${dash(l.source)}`} opacity={lineOpacity(l.source)} />
          ))}
        </g>
        <g className="bd-ln">
          {layout.lines.map((l) => (
            <path
              key={l.source}
              d={filtered && l.source === source ? l.d : linePath(l.source, width, end)}
              className={`s-${SV[l.source]}${dash(l.source)}`}
              opacity={filtered && l.source !== source ? 0 : down.includes(l.source) ? 0.9 : 1}
            />
          ))}
        </g>

        {layout.caps.map((c, i) => (
          <rect
            key={c.station}
            x={c.x - CAP_W / 2}
            y={CAP_TOP}
            width={CAP_W}
            height={CAP_H}
            rx={CAP_W / 2}
            className={i === sel ? "sv-cap on" : "sv-cap"}
            opacity={i === sel ? 1 : 0.85}
          />
        ))}

        <g className="sv-tick">
          {layout.ticks.map((t) => (
            <circle key={t.id} data-tick={t.id} cx={t.x} cy={t.y} r={TICK_R} className={`f-${SV[t.source]}`} opacity={markOpacity(t.source)} />
          ))}
        </g>

        {layout.rings.map((r) => {
          const on = STATIONS.indexOf(r.station) <= sel;
          const op = Math.min(markOpacity(r.upper.source), markOpacity(r.lower.source)) === 1 ? 1 : 0.35;
          return (
            <g key={r.ids.join("+")} opacity={op}>
              <path d={`M${r.upper.x} ${r.upper.y}L${r.lower.x} ${r.lower.y}`} className="s-ink" strokeWidth={2} fill="none" />
              <circle data-tick={r.ids[0]} cx={r.upper.x} cy={r.upper.y} r={RING_R} className={on ? "sv-ring on" : "sv-ring"} />
              <circle data-tick={r.ids[1]} cx={r.lower.x} cy={r.lower.y} r={RING_R} className={on ? "sv-ring on" : "sv-ring"} />
            </g>
          );
        })}

        {layout.more.map((m) => (
          <text
            key={`${m.station}-${m.source}`}
            x={m.x}
            y={m.y + 4}
            textAnchor="middle"
            className="bd-more"
            opacity={markOpacity(m.source)}
          >
            +{m.n}
          </text>
        ))}

        {layout.caps.map((c, i) => (
          <g
            key={c.station}
            className="bd-st"
            role="button"
            tabIndex={0}
            aria-pressed={i === sel}
            aria-label={`${STATION_LABEL[c.station]}, ${counts[c.station]}`}
            onClick={() => onStation(c.station)}
            onKeyDown={onKey(c.station)}
          >
            <rect x={c.x - 46} y={26} width={92} height={BAND_H - 26} rx={8} className="bd-hit" />
            <text x={c.x} y={48} textAnchor="middle" className="bd-name" opacity={i === sel ? 1 : 0.85}>
              {STATION_LABEL[c.station]}
            </text>
            <text x={c.x} y={232} textAnchor="middle" className={i === sel ? "bd-count on" : "bd-count"}>
              {counts[c.station]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
