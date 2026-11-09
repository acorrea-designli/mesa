"use client";
// /uso: the Claude usage screen. Plan windows (% remaining as a meter with a pace tick, and the % used over time as
// a chart), then tokens for one period at a time (Hoy / Semana): tokens nuevos, who spent them, by model, by day, and
// the table view. The server renders the first frame; this polls GET /api/usage every 30 s so the figures stay live.
import { useEffect, useId, useState } from "react";
import { Tabs } from "@/components/ui/interactive";
import { compactTokens, exactTokens, type TokenSummary } from "@/lib/domain/tokens";
import { chartSeries, usoDate, type UsagePoint, type UsageView, type WindowView } from "@/lib/domain/usage";
import { HistoryChart } from "./HistoryChart";
import { DayColumns, RankedBars } from "./RankedBars";
import { TokenTable } from "./TokenTable";
import { UsageMeter } from "./UsageMeter";
import "./usage.css";

export interface UsoData {
  /** ISO instant the figures were read. */
  now: string;
  view: UsageView;
  /** Null when Mesa cannot find the Claude Code transcripts. */
  tokens: TokenSummary | null;
  history: UsagePoint[];
}

const POLL_MS = 30_000;
type Period = "hoy" | "semana";

function PlanWindow({ w, view, history }: { w: WindowView; view: UsageView; history: UsagePoint[] }) {
  const none = w.remaining === null;
  return (
    <article className={view.state === "stale" ? "us-panel stale" : "us-panel"} aria-label={w.label === "5 h" ? "Ventana de 5 horas" : "Ventana semanal"}>
      <div className="us-panel-top">
        <h3>
          {w.label} <small>restante</small>
        </h3>
        {none ? <span className="us-big none">sin dato</span> : <span className="us-big">{w.remaining}%</span>}
      </div>
      <UsageMeter w={w} size="lg" />
      <div className="us-panel-sub">
        <span>{none ? "Se llena con la próxima medición" : `reinicia ${w.resets}`}</span>
        {none ? null : (
          <span className="us-key">
            <i aria-hidden="true" /> ritmo parejo
          </span>
        )}
      </div>
      <HistoryChart title={w.key === "five_hour" ? "Últimas 5 h" : "Semana"} series={chartSeries(history, w, view.at)} />
    </article>
  );
}

export function UsoView({ initial, live = true }: { initial: UsoData; /** false in /kit: fixed sample data that never polls. */ live?: boolean }) {
  const [data, setData] = useState<UsoData>(initial);
  const [period, setPeriod] = useState<Period>("hoy");
  const uid = useId();

  useEffect(() => {
    if (!live) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/usage?tokens=1&history=1", { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as Partial<UsoData>;
        if (alive && body.view && body.now) setData((d) => ({ now: body.now!, view: body.view!, tokens: body.tokens ?? d.tokens, history: body.history ?? d.history }));
      } catch {
        // A failed poll keeps the last figures: the screen never turns into an error.
      }
    };
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [live]);

  const { view, tokens, history } = data;
  const slice = tokens ? (period === "hoy" ? tokens.today : tokens.week) : null;
  const none = view.state === "none" || view.windows.every((w) => w.remaining === null);

  return (
    <div className="us">
      <header className="us-head">
        <h1>
          Uso <span>{usoDate(new Date(data.now))}</span>
        </h1>
      </header>

      <section className="us-sec" aria-labelledby={`${uid}plan`}>
        <h2 id={`${uid}plan`} className="us-h">
          Plan de Claude
        </h2>
        <div className="us-wins">
          {view.windows.map((w) => (
            <PlanWindow key={w.key} w={w} view={view} history={history} />
          ))}
        </div>
        <p className={view.state === "stale" ? "us-meas stale" : "us-meas"}>{none ? "Sin medición del plan todavía." : `medido ${view.age}`}</p>
      </section>

      <section className="us-sec" aria-labelledby={`${uid}tok`}>
        <div className="us-sec-head">
          <h2 id={`${uid}tok`} className="us-h">
            Tokens
          </h2>
          <Tabs<Period>
            label="Periodo"
            value={period}
            onChange={setPeriod}
            items={[
              { key: "hoy", label: "Hoy" },
              { key: "semana", label: "Semana" },
            ]}
          />
        </div>

        {!tokens || !slice ? (
          <p className="us-empty">Sin dato: Mesa no encuentra las transcripciones de Claude Code.</p>
        ) : (
          <div className="us-period">
            <p className="us-hero-row" title={`${exactTokens(slice.fresh)} tokens nuevos`}>
              <b className="us-hero">{compactTokens(slice.fresh)}</b>
              <span className="us-hero-lbl">tokens nuevos</span>
            </p>
            <p className="us-cache">
              además {compactTokens(slice.use.cacheRead)} leídos de caché
            </p>
            {slice.fresh === 0 ? (
              <p className="us-empty">{period === "hoy" ? "Sin tokens hoy." : "Sin tokens esta semana."}</p>
            ) : (
              <div className="us-ranks">
                <RankedBars title="Quién gastó" rows={slice.byRole} total={slice.fresh} />
                <RankedBars title="Por modelo" rows={slice.byModel} total={slice.fresh} id />
              </div>
            )}
          </div>
        )}

        {tokens ? <DayColumns days={tokens.days} /> : null}
        {slice ? <TokenTable slice={slice} /> : null}
        <p className="us-note">Días y semana de Bogotá, de las sesiones de Mesa. Tokens nuevos = entrada + escritura de caché + salida.</p>
      </section>
    </div>
  );
}
