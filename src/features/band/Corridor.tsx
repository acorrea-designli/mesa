"use client";
// Phone band (telefono.html frame 1, variant A "Corredor"): the selected station's
// corridor. Lines run solid into the station and dim after it; the next station
// is named at the right edge.
import { useMemo } from "react";
import { STATION_LABEL, STATIONS, type Source, type Station } from "@/lib/domain/types";
import { useLayLines } from "@/lib/motion";
import { CORR_CAP_W, CORR_CAP_X, CORR_H, CORR_W, CORR_Y, layoutCorridor, type BandItem } from "./layout";
import { SV } from "./LineBand";

const ORDER: Source[] = ["github", "slack", "claude", "basecamp"];
const CAP_TOP = 28;
const CAP_H = 84;

export function Corridor({
  items,
  counts,
  station,
  waitingOnYou,
  down = [],
  stale,
}: {
  items: BandItem[];
  counts: Record<Station, number>;
  station: Station;
  waitingOnYou: number;
  down?: Source[];
  stale?: boolean;
}) {
  const svg = useLayLines<SVGSVGElement>();
  const here = useMemo(() => items.filter((i) => i.station === station), [items, station]);
  const l = useMemo(() => layoutCorridor(here), [here]);
  const next = STATIONS[STATIONS.indexOf(station) + 1];
  const right = CORR_CAP_X + CORR_CAP_W;
  const dash = (s: Source) => (down.includes(s) ? " sv-dash" : "");
  const bySource = ORDER.map((s) => `${here.filter((i) => i.source === s).length} ${s === "github" ? "GitHub" : s === "slack" ? "Slack" : s === "claude" ? "Claude" : "Basecamp"}`);

  return (
    <div className={stale ? "bd-corr is-stale" : "bd-corr"}>
      <svg
        ref={svg}
        width="100%"
        height={CORR_H}
        viewBox={`0 0 ${CORR_W} ${CORR_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Corredor de ${STATION_LABEL[station]}: ${bySource.join(", ")}`}
      >
        {next ? (
          <g className="bd-ln" style={{ strokeWidth: 5 }} opacity={0.35}>
            {ORDER.map((s) => (
              <path
                key={s}
                d={s === "basecamp" ? `M${right} ${CORR_Y[s]}H330l16 16H${CORR_W}` : `M${right} ${CORR_Y[s]}H${CORR_W}`}
                className={`s-${SV[s]}${dash(s)}`}
              />
            ))}
          </g>
        ) : null}
        <g className="bd-ln" style={{ strokeWidth: 5 }}>
          {ORDER.map((s) => (
            <path key={s} d={`M14 ${CORR_Y[s]}H${CORR_CAP_X}`} className={`s-${SV[s]}${dash(s)}`} />
          ))}
        </g>
        <rect x={CORR_CAP_X} y={CAP_TOP} width={CORR_CAP_W} height={CAP_H} rx={CORR_CAP_W / 2} className="sv-cap on" />
        <g className="sv-tick">
          {l.ticks.map((t) => (
            <circle key={t.id} cx={t.x} cy={t.y} r={5} className={`f-${SV[t.source]}`} opacity={down.includes(t.source) ? 0.35 : 1} />
          ))}
        </g>
        {l.rings.map((r) => (
          <g key={r.ids.join("+")}>
            <path d={`M${r.upper.x} ${r.upper.y}L${r.lower.x} ${r.lower.y}`} className="s-ink" strokeWidth={2} fill="none" />
            <circle cx={r.upper.x} cy={r.upper.y} r={7.5} className="sv-ring on" />
            <circle cx={r.lower.x} cy={r.lower.y} r={7.5} className="sv-ring on" />
          </g>
        ))}
        {l.more.map((m) => (
          <text key={m.source} x={m.x} y={m.y + 4} textAnchor="middle" className="bd-more">
            +{m.n}
          </text>
        ))}
        <text x={CORR_CAP_X + CORR_CAP_W / 2} y={18} textAnchor="middle" className="bd-corr-name">
          {STATION_LABEL[station]} {counts[station]}
        </text>
        {next ? (
          <>
            <text x={366} y={18} textAnchor="end" className="bd-corr-next">
              {STATION_LABEL[next]} {counts[next]}
            </text>
            <path d="M372 9l4.5 4.5L372 18" fill="none" style={{ stroke: "var(--mute)" }} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : null}
        <text x={CORR_CAP_X + CORR_CAP_W / 2} y={130} textAnchor="middle" className="bd-corr-sub">
          {station === "done" ? `${counts.done} hoy` : waitingOnYou === 1 ? "1 te espera" : `${waitingOnYou} te esperan`}
        </text>
      </svg>
    </div>
  );
}
