// "Uso": Claude plan usage as two meters (5 h, semana) with % remaining and a pace tick. Presentational (no hooks),
// so /kit shows it in every state. The rail (desktop) and the Ajustes sheet (phone) mount UsageLine. The whole block
// is one link to /uso; in Ajustes `onDetail` closes the sheet first and routes there.
import Link from "next/link";
import type { MouseEvent } from "react";
import type { UsageView } from "@/lib/domain/usage";
import { meterLabel, UsageMeter } from "./UsageMeter";
import "./usage.css";

export const DETAIL_HREF = "/uso";

export function UsageBlock({ view, onDetail, current }: { view: UsageView; onDetail?: (href: string) => void; current?: boolean }) {
  const none = view.state === "none" || view.windows.every((w) => w.remaining === null);
  const go = onDetail
    ? (e: MouseEvent) => {
        e.preventDefault();
        onDetail(DETAIL_HREF);
      }
    : undefined;
  const name = `Uso del plan. ${view.windows.map(meterLabel).join("; ")}. Abrir el detalle`;
  return (
    <Link href={DETAIL_HREF} className={view.state === "stale" ? "rl-usage stale" : "rl-usage"} aria-label={name} aria-current={current ? "page" : undefined} onClick={go}>
      <span className="k">Uso</span>
      {view.windows.map((w) => (
        <span key={w.key} className="us-win">
          <span className="us-top">
            <span>{w.label}</span>
            {w.remaining === null ? (
              <small>sin dato</small>
            ) : (
              <b>
                {w.remaining}%<small> restante</small>
              </b>
            )}
          </span>
          <UsageMeter w={w} label={false} />
        </span>
      ))}
      {none ? null : <small className="us-age">{view.age}</small>}
    </Link>
  );
}
