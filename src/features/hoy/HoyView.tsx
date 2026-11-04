"use client";
// Hoy: the line band, source tabs, the rows of the selected station, and the detail pane.
// Phone (<= 720px): corridor band, scrolling station tabs, 66px rows, full-screen detail.
import Link from "next/link";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { BrandMark, BrokenLine, SourceDot } from "@/components/line/Line";
import { Btn } from "@/components/ui/primitives";
import { Tabs, useToast } from "@/components/ui/interactive";
import { STATION_LABEL, STATIONS, type Source, type Station } from "@/lib/domain/types";
import { useArrive, usePress } from "@/lib/motion";
import { Corridor } from "../band/Corridor";
import { LineBand } from "../band/LineBand";
import { DonePane, FirstRunPane, ItemDetailPane, SetupList } from "./HoyDetail";
import { isCalm, sourceCounts, visibleRows, type HoyData, type HoyRow } from "./model";
import { ApprovalCard } from "./stubs/ApprovalCard";
import { SalidaApproval } from "./stubs/SalidaApproval";
import { clock } from "./format";
import { useLive } from "./useLive";
import "../band/band.css";
import "./hoy.css";

const LEGEND: Source[] = ["github", "slack", "claude", "basecamp"];
const TAB_ORDER: Source[] = ["github", "basecamp", "slack", "claude"];
const NAME: Record<Source, string> = { github: "GitHub", slack: "Slack", basecamp: "Basecamp", claude: "Claude" };

function SweepButton({ compact }: { compact?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const sweep = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/sweep", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error();
      toast({ text: "Claude está barriendo Slack y Basecamp" });
    } catch {
      toast({ text: "No se pudo pedir el barrido" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Btn size="sm" className={compact ? "hy-sweep compact" : "hy-sweep"} disabled={busy} onClick={() => void sweep()} aria-label="Barrer ahora">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13.5 8A5.5 5.5 0 113 5" />
        <path d="M3 1.8V5h3.2" />
      </svg>
      {compact ? null : "Barrer ahora"}
    </Btn>
  );
}

function Row({ r, selected, onPick }: { r: HoyRow; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      className={["hy-row", selected && "sel", r.stale && "stale", `src-${r.source}`].filter(Boolean).join(" ")}
      aria-current={selected ? "true" : undefined}
      data-row={r.key}
      onClick={onPick}
    >
      <span className="t">{r.time}</span>
      <span className="src">
        <SourceDot source={r.source} />
        <span className="src-name">{NAME[r.source]}</span>
      </span>
      <span className="subj">
        {r.subject}
        <small>{r.excerpt}</small>
      </span>
      <span className="need">{r.need}</span>
      <span className={`st ${r.tag.tone === "plain" ? "" : r.tag.tone} desk-only`}>{r.tag.label}</span>
      <span className={`st ${r.phoneTag.tone === "plain" ? "" : r.phoneTag.tone} phone-only`}>{r.phoneTag.label}</span>
    </button>
  );
}

export function HoyView({ data }: { data: HoyData }) {
  const live = useLive();
  const [station, setStation] = useState<Station>("inbox");
  const [source, setSource] = useState<Source | "all">("all");
  const [selKey, setSelKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const { items, salidas } = useMemo(() => visibleRows(data.rows, station, source), [data.rows, station, source]);
  const counts = useMemo(() => sourceCounts(data.rows, station), [data.rows, station]);
  const all = useMemo(() => [...items, ...salidas], [items, salidas]);
  const selected = all.find((r) => r.key === selKey) ?? salidas[0] ?? items[0] ?? null;
  const waiting = data.rows.filter((r) => r.station === station && r.waitsOnYou).length;
  const down = LEGEND.filter((s) => data.health[s] && data.health[s]!.state !== "ok");
  const calm = station === "inbox" && isCalm(data);
  const listRef = useArrive<HTMLDivElement>(".hy-row", `${station}:${source}`);
  const pressRef = usePress<HTMLDivElement>(".hy-row", true);

  // Close the phone detail if its row went away (sent, moved).
  useEffect(() => {
    if (open && !selected) {
      const id = window.setTimeout(() => setOpen(false), 0);
      return () => window.clearTimeout(id);
    }
  }, [open, selected]);

  const pick = (r: HoyRow) => {
    setSelKey(r.key);
    setOpen(true);
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".hy-row")];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      next.focus();
      setSelKey(next.dataset.row ?? null);
    }
  };

  const tabs = [
    { key: "all" as const, label: "Todo", count: counts.all },
    ...TAB_ORDER.map((s) => ({ key: s, label: NAME[s], count: counts[s], source: s })),
  ];
  const stationTabs = STATIONS.map((s) => ({ key: s, label: STATION_LABEL[s], count: data.stations[s] }));

  const offlineNote = live.offline ? (
    <div className="alert hy-off" role="alert">
      <div className="hy-off-row">
        <svg width="32" height="14" viewBox="0 0 32 14" aria-hidden="true" style={{ flex: "none" }}>
          <path d="M2 7H11M21 7H30" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M13 11L19 3" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <p>
          <b>Sin conexión con tu PC.</b> El túnel no responde{live.downSince ? ` desde las ${clock(live.downSince)}` : ""}.
          {live.lastOk ? ` Ves lo último que llegó, de las ${clock(live.lastOk)}.` : " Ves lo último que llegó."}
        </p>
      </div>
      <Btn variant="primary" onClick={live.retry}>
        Reintentar
      </Btn>
    </div>
  ) : null;

  let detail: React.ReactNode;
  if (data.firstRun) detail = <FirstRunPane />;
  else if (calm || !selected) detail = <DonePane done={data.done} nextCheckAt={data.nextCheckAt} sample={data.hasSample} />;
  else if (selected.kind === "salida") detail = <SalidaApproval key={selected.id} salidaId={selected.id} compact />;
  else {
    const d = data.details[selected.id];
    detail = d ? <ItemDetailPane key={d.id} d={d} health={d.source === "claude" ? undefined : data.health[d.source]} /> : null;
  }

  return (
    <div className={["hy", open && selected ? "is-open" : "", live.offline ? "is-offline" : ""].join(" ")}>
      <section className="hy-band" aria-label="Línea del día">
        <div className="hy-bandhead">
          <h1>
            Línea del día<span>{data.dayLong}</span>
          </h1>
          <SweepButton />
          <div className="hy-legend">
            {LEGEND.map((s) => {
              const h = data.health[s];
              return h && h.state !== "ok" ? (
                <span key={s} className="down">
                  <BrokenLine source={s} width={26} title={h.legend} />
                  {h.legend}
                </span>
              ) : (
                <span key={s}>
                  <i style={{ background: `var(--${{ github: "gh", slack: "sl", claude: "cl", basecamp: "bc" }[s]})` }} />
                  {NAME[s]}
                </span>
              );
            })}
          </div>
        </div>
        <LineBand items={data.band} counts={data.stations} station={station} source={source} down={down} onStation={setStation} stale={live.offline} />
      </section>

      <header className="hy-ph-top">
        <BrandMark size={24} />
        <h1>
          Hoy<span>{data.dayShort}</span>
        </h1>
        <SweepButton compact />
      </header>
      {offlineNote ? <div className="hy-ph-off">{offlineNote}</div> : null}

      <div className={live.offline ? "hy-body is-offline" : "hy-body"}>
        <Corridor items={data.band} counts={data.stations} station={station} waitingOnYou={waiting} down={down} stale={live.offline} />
        <div className="hy-phsts">
          <Tabs items={stationTabs} value={station} onChange={setStation} label="Estaciones" />
        </div>

        <div className="hy-main" ref={pressRef}>
          {offlineNote ? <div className="hy-desk-off">{offlineNote}</div> : null}
          {data.approvals.length ? (
            <section id="permisos" className="hy-perm" aria-label="Permisos">
              <div className="grp">Permisos · esperan tu decisión</div>
              <fieldset className="hy-fs" disabled={live.offline}>
                {data.approvals.map((a) => (
                  <ApprovalCard key={a.id} approval={a} />
                ))}
              </fieldset>
            </section>
          ) : null}

          <div className="hy-tabs">
            <Tabs items={tabs} value={source} onChange={setSource} label="Fuentes" trailing={<span className="sort">Estación: {STATION_LABEL[station]} · por hora</span>} />
          </div>

          {data.firstRun ? (
            <div className="hy-calm wide">
              <h2>Conecta tus fuentes</h2>
              <p>Mesa lee GitHub, Basecamp y Slack, y guarda el tablero en un GitHub Project privado. Cuando todo esté conectado, la línea se llena.</p>
              <SetupList rows={data.setup} />
            </div>
          ) : calm ? (
            <div className="hy-calm">
              <h2>Nada te espera</h2>
              <p>
                Revisado a las {data.checkedAt}: {down.length ? `${down.map((s) => NAME[s]).join(" y ")} sin conexión` : "GitHub, Basecamp y Slack al día"}, y Claude no tiene preguntas. Lo que entre aparece en Inbox.
              </p>
              <div className="hy-acts">
                <Link className="btn" href="/tablero">
                  Ver el tablero
                </Link>
                <Link className="btn" href="/tickets?new=1">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M7 2v10M2 7h10" />
                  </svg>
                  Pedirle algo a Claude
                </Link>
              </div>
            </div>
          ) : (
            <div className="hy-list" ref={listRef} onKeyDown={onListKey}>
              <div className="hy-cols" aria-hidden="true">
                <span>Hora</span>
                <span>Origen</span>
                <span>Asunto</span>
                <span>Necesita</span>
                <span>Estado</span>
              </div>
              {items.map((r) => (
                <Row key={r.key} r={r} selected={selected?.key === r.key} onPick={() => pick(r)} />
              ))}
              {!items.length && !salidas.length ? (
                <p className="hy-empty">
                  Nada en {STATION_LABEL[station]}
                  {source !== "all" ? ` de ${NAME[source]}` : ""}.
                </p>
              ) : null}
              {salidas.length ? <div className="grp">Salidas · esperan tu firma</div> : null}
              {salidas.map((r) => (
                <Row key={r.key} r={r} selected={selected?.key === r.key} onPick={() => pick(r)} />
              ))}
              {live.offline ? <p className="hy-ro">Firmar y responder vuelven con la conexión: nada sale sin la PC.</p> : null}
            </div>
          )}
        </div>
      </div>

      <aside className="hy-detail" aria-label="Detalle">
        <div className="hy-ph-back">
          <button type="button" className="hy-back" onClick={() => setOpen(false)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 3L5 8l5 5" />
            </svg>
            Hoy
          </button>
          <span>{selected?.kind === "salida" ? `${salidas.findIndex((s) => s.key === selected.key) + 1} de ${salidas.length}` : ""}</span>
        </div>
        <fieldset className="hy-fs" disabled={live.offline}>
          {detail}
        </fieldset>
      </aside>
    </div>
  );
}
