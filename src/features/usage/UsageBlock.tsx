// "Uso": Claude plan usage as % remaining per window, the reset time and the age of the figure. Presentational
// (no hooks), so /kit shows it in every state. The rail (desktop) and the Ajustes sheet (phone) mount UsageLine.
import Link from "next/link";
import type { MouseEvent } from "react";
import type { UsageView } from "@/lib/domain/usage";
import "./usage.css";

export const DETAIL_HREF = "/semana#uso";

export function UsageBlock({ view, onDetail }: { view: UsageView; onDetail?: (href: string) => void }) {
  const none = view.state === "none" || view.windows.every((w) => w.remaining === null);
  const go = onDetail
    ? (e: MouseEvent) => {
        e.preventDefault();
        onDetail(DETAIL_HREF);
      }
    : undefined;
  return (
    <div className={view.state === "stale" ? "rl-usage stale" : "rl-usage"} role="status" aria-label="Uso">
      <div className="k">Uso</div>
      {none ? (
        <div className="us-none">sin dato</div>
      ) : (
        view.windows.map((w) => (
          <div key={w.key} className="us-win">
            <div className="us-top">
              <span>{w.label}</span>
              {w.remaining === null ? <small>sin dato</small> : <b>{w.remaining}% restante</b>}
            </div>
            {w.remaining === null ? null : (
              <>
                <div className="us-meter" aria-hidden="true">
                  <i style={{ width: `${w.remaining}%` }} />
                </div>
                <small className="us-reset">reinicia {w.resets}</small>
              </>
            )}
          </div>
        ))
      )}
      <div className="us-foot">
        <small>{none ? "Se llena con el status line" : view.age}</small>
        <Link href={DETAIL_HREF} className="lk" onClick={go}>
          Tokens
        </Link>
      </div>
    </div>
  );
}
