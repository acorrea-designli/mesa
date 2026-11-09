// The plan meter: % remaining as a thick round-capped line in ink on a rule track, with a pace tick. Presentational
// (no hooks), shared by the /uso page (lg, 10 px), the rail and the Ajustes block (sm, 6 px) and /kit.
// The tick sits where an even pace would leave the meter right now (100 - share of the window elapsed): a fill that
// ends past the tick is ahead of pace (spare), a fill that ends short of it is behind (burning faster than the clock).
// With no figure the meter is a dotted line, the out-of-service idiom.
import type { WindowView } from "@/lib/domain/usage";
import "./usage.css";

const pct = (n: number) => `${n}%`;

/** "5 h: 68% restante, reinicia 18:30, ritmo parejo 70%", or "5 h: sin dato". Also the meter's accessible name. */
export function meterLabel(w: WindowView): string {
  if (w.remaining === null) return `${w.label}: sin dato`;
  const even = w.pace === null ? "" : `, ritmo parejo ${Math.round((1 - w.pace) * 100)}%`;
  return `${w.label}: ${pct(w.remaining)} restante, reinicia ${w.resets}${even}`;
}

export function UsageMeter({ w, size = "sm", label = true }: { w: WindowView; size?: "sm" | "lg"; label?: boolean }) {
  const none = w.remaining === null;
  return (
    <div className={`us-meter ${size}${none ? " off" : ""}`} role={label ? "img" : undefined} aria-label={label ? meterLabel(w) : undefined} aria-hidden={label ? undefined : true}>
      {none ? null : (
        <>
          <span className="us-track">
            <i className="us-fill" style={{ width: pct(w.remaining ?? 0) }} />
          </span>
          {w.pace === null ? null : <b className="us-tick" style={{ left: pct(Math.round((1 - w.pace) * 1000) / 10) }} />}
        </>
      )}
    </div>
  );
}
