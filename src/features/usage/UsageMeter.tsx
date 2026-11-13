// The plan meter: % USED as a thick round-capped line in ink on a rule track, filling left to right (the same way the
// /uso chart climbs), with a tick for the time already elapsed in the window. Presentational (no hooks), shared by the
// /uso page (lg, 10 px), the rail and the Ajustes block (sm, 6 px) and /kit.
// The tick sits at the share of the window already elapsed (pace x 100): a fill that ends short of it is spending slower
// than the clock, a fill that ends past it is spending faster. The tick is time, never a forecast.
// With no figure the meter is a dotted line, the out-of-service idiom.
import type { WindowView } from "@/lib/domain/usage";
import "./usage.css";

const pct = (n: number) => `${n}%`;

/** % used as shown (whole number), or null with no figure. The fill, the big figure and the labels all read this. */
export const usedPct = (w: WindowView): number | null => (w.used === null ? null : Math.round(w.used));

/** Where the time tick sits along the track, in % from the left (null with no pace): the share of the window already elapsed. */
export const tickPct = (w: WindowView): number | null => (w.pace === null ? null : Math.round(w.pace * 1000) / 10);

/** CSS `left` for a mark at `p` % of the track, kept 2 px inside the ends so a tick at the start or the end of the window stays visible. */
export const tickLeft = (p: number): string => `clamp(2px, ${p}%, calc(100% - 2px))`;

/** "5 h: 35% usado, tiempo 1 h 16 de 5 h, reinicia 14:30", or "5 h: sin dato". Also the meter's accessible name. */
export function meterLabel(w: WindowView): string {
  const used = usedPct(w);
  if (used === null) return `${w.label}: sin dato`;
  const time = w.elapsed ? `, tiempo ${w.elapsed}` : "";
  return `${w.label}: ${pct(used)} usado${time}, reinicia ${w.resets}`;
}

export function UsageMeter({ w, size = "sm", label = true }: { w: WindowView; size?: "sm" | "lg"; label?: boolean }) {
  const used = usedPct(w);
  const tick = tickPct(w);
  return (
    <div className={`us-meter ${size}${used === null ? " off" : ""}`} role={label ? "img" : undefined} aria-label={label ? meterLabel(w) : undefined} aria-hidden={label ? undefined : true}>
      {used === null ? null : (
        <>
          <span className="us-track">
            <i className="us-fill" style={{ width: pct(used) }} />
          </span>
          {tick === null ? null : <b className="us-tick" style={{ left: tickLeft(tick) }} />}
        </>
      )}
    </div>
  );
}
