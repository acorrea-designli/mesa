"use client";
// t204: the Historial of Salidas, the ones the queue strip no longer shows (failed and draft_created from earlier days,
// decided ones from earlier days). Paged, grouped by day, newest first. A row carries only what the list shows; the card
// (with its ticket history) is fetched when a row opens.
import { useEffect, useRef, useState } from "react";
import { HISTORY_PAGE, type SalidaHistoryRow } from "@/lib/domain/salida-queue";
import { salidaApi } from "./api";
import { dayLabel, destShort, groupByDay, hhmm, rowLine, sourceLabel, sourceVar, stripStatus } from "./model";

export function Historial({ refreshKey, now, hidden, onOpen }: { refreshKey: string; now: number; hidden: boolean; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<SalidaHistoryRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [more, setMore] = useState(false);
  const [tries, setTries] = useState(0);
  const shown = useRef(0);

  // First page on mount; again whenever the board changes, re-reading as many rows as are already shown.
  useEffect(() => {
    let live = true;
    salidaApi
      .history(null, Math.max(HISTORY_PAGE, shown.current))
      .then((p) => {
        if (!live) return;
        shown.current = p.rows.length;
        setRows(p.rows);
        setNext(p.next);
        setState("ready");
      })
      .catch(() => live && setState((s) => (s === "ready" ? s : "error")));
    return () => {
      live = false;
    };
  }, [refreshKey, tries]);

  const loadMore = async () => {
    if (!next || more) return;
    setMore(true);
    try {
      const p = await salidaApi.history(next);
      const seen = new Set(rows.map((r) => r.id));
      const all = [...rows, ...p.rows.filter((r) => !seen.has(r.id))];
      shown.current = all.length;
      setRows(all);
      setNext(p.next);
    } catch {
      setState("error");
    } finally {
      setMore(false);
    }
  };

  const nowDate = new Date(now);
  return (
    <section className="sa-hist" hidden={hidden} aria-label="Historial de salidas">
      <div className="sa-hist-h">
        <b>Historial</b>
        <span>Lo de días anteriores que ya no está en la cola. Ábrela para reintentar, confirmar o eliminar.</span>
      </div>
      {state === "loading" ? <p className="sa-hist-note">Cargando el historial…</p> : null}
      {state === "error" ? (
        <p className="sa-hist-note" role="alert">
          No se pudo cargar el historial.{" "}
          <button type="button" className="btn sm" onClick={() => setTries((n) => n + 1)}>
            Reintentar
          </button>
        </p>
      ) : null}
      {state === "ready" && !rows.length ? <p className="sa-hist-note">Todavía no hay salidas en el historial.</p> : null}
      {groupByDay(rows).map((g) => (
        <div className="sa-hg" key={g.day}>
          <h3>{dayLabel(g.at, nowDate)}</h3>
          <div role="list">
            {g.rows.map((r) => (
              <HistoryRow key={r.id} r={r} now={now} onOpen={() => onOpen(r.id)} />
            ))}
          </div>
        </div>
      ))}
      {next ? (
        <div className="sa-hist-more">
          <button type="button" className="btn" disabled={more} onClick={loadMore}>
            {more ? "Cargando…" : "Ver más"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function HistoryRow({ r, now, onOpen }: { r: SalidaHistoryRow; now: number; onOpen: () => void }) {
  const time = hhmm(r.updatedAt);
  const status = stripStatus(r, now);
  return (
    <button type="button" role="listitem" className="sa-hr" style={{ ["--c" as string]: sourceVar(r.source) }} onClick={onOpen}>
      <i aria-hidden="true" title={sourceLabel(r.source)} />
      <span className="m">
        <span className="d">{destShort(r.destination)}</span>
        <span className="x">{rowLine(r.source, r.destination, r.body)}</span>
      </span>
      <span className="s">
        <b>{status}</b>
        <span>
          {status.includes(time) ? "" : time}
          {r.ticketRef ? <em>{r.ticketRef}</em> : null}
        </span>
      </span>
    </button>
  );
}
