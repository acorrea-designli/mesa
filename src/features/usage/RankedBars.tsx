// Ranked horizontal bars (Quién gastó, Por modelo) and the Monday-to-Sunday columns (Semana, por día). Presentational
// (no hooks). One series, all of it Claude's: the bars are the Claude line ink, there is no legend. Each row, column
// and point is focusable and names its exact value: in the title (hover), the aria-label and, on hover or focus, in
// the visible value (compact "8,3 M" swaps to "8.312.450").
import { compactTokens, exactTokens, type DayBar, type TokenRow } from "@/lib/domain/tokens";
import "./usage.css";

export function RankedBars({ title, rows, total, id }: { title: string; rows: TokenRow[]; total: number; /** Full model id as the row's title. */ id?: boolean; }) {
  const ranked = rows.filter((r) => r.fresh > 0);
  const max = Math.max(1, ...ranked.map((r) => r.fresh));
  return (
    <section className="us-block" aria-label={title}>
      <h3 className="us-h">{title}</h3>
      {ranked.length === 0 ? (
        <p className="us-empty">Sin tokens nuevos.</p>
      ) : (
        <ol className="us-rank">
          {ranked.map((r) => {
            const share = total > 0 ? Math.round((r.fresh / total) * 100) : 0;
            const exact = `${exactTokens(r.fresh)} tokens nuevos`;
            const full = id ? `${r.key}: ${exact}` : `${r.label}: ${exact}`;
            return (
              <li key={r.key} tabIndex={0} title={full} aria-label={`${full}, ${share}%`}>
                <span className="us-rk-name">{r.label}</span>
                <span className="us-rk-track" aria-hidden="true">
                  <i style={{ width: `${Math.max(1, (r.fresh / max) * 100)}%` }} />
                </span>
                <span className="us-rk-val" aria-hidden="true">
                  <b className="cp">{compactTokens(r.fresh)}</b>
                  <b className="ex">{exactTokens(r.fresh)}</b>
                </span>
                <span className="us-rk-pct" aria-hidden="true">
                  {share}%
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

const dayNum = (d: DayBar) => `${d.label} ${Number(d.day.slice(8))}`;

export function DayColumns({ days }: { days: DayBar[] }) {
  const max = Math.max(1, ...days.map((d) => d.fresh));
  return (
    <section className="us-block" aria-label="Semana, por día">
      <h3 className="us-h">Semana, por día</h3>
      <ol className="us-days">
        {days.map((d) => {
          const full = `${dayNum(d)}: ${d.future ? "aún sin tokens" : `${exactTokens(d.fresh)} tokens nuevos`}`;
          return (
            <li key={d.day} className={d.today ? "today" : undefined} tabIndex={0} title={full} aria-label={full} aria-current={d.today ? "date" : undefined}>
              <span className="us-day-plot" aria-hidden="true">
                {d.fresh > 0 ? (
                  <>
                    <span className="us-day-val">{compactTokens(d.fresh)}</span>
                    <i style={{ height: `${Math.max(3, (d.fresh / max) * 100)}%` }} />
                  </>
                ) : (
                  <em className="us-dots" />
                )}
                <span className="us-tip">
                  {dayNum(d)} · {d.future ? "aún nada" : exactTokens(d.fresh)}
                </span>
              </span>
              <span className="us-day-lbl" aria-hidden="true">
                {d.label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
