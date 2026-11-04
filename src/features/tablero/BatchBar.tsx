"use client";
// The batch bar: docked at the bottom while cards are selected. "N seleccionadas", Mover a ▾
// (the five stations), Dárselas a Claude, Ignorar proyecto, Cancelar. It rises from the bottom
// edge (src/lib/motion riseBar; a fade under reduced motion).
import { useEffect, useRef } from "react";
import { STATION_LABEL, STATIONS, type Station } from "@/lib/domain/types";
import { riseBar } from "@/lib/motion";
import type { MenuAction } from "../ignore/ActionMenu";

export interface BatchBarProps {
  count: number;
  busy: boolean;
  /** Stations the selection could move to, with how many selected cards are already there. */
  here: Record<Station, number>;
  openMenu: (el: HTMLElement, label: string, actions: MenuAction[], align?: "start" | "end") => void;
  onMove: (station: Station) => void;
  /** Null when no selected card can be handed to Claude (all samples or already with Claude). */
  onDispatch: (() => void) | null;
  ignoreLabel: string | null;
  onIgnore: () => void;
  onCancel: () => void;
}

export function BatchBar(p: BatchBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) riseBar(ref.current);
  }, []);
  const label = `${p.count} ${p.count === 1 ? "seleccionada" : "seleccionadas"}`;
  const stations: MenuAction[] = STATIONS.map((st) => ({
    label: STATION_LABEL[st],
    detail: p.here[st] === p.count ? "ya están aquí" : p.here[st] ? `${p.here[st]} ya aquí` : undefined,
    onSelect: () => p.onMove(st),
  }));
  return (
    <div ref={ref} className="tb-batch" role="toolbar" aria-label={`Acciones en lote · ${label}`}>
      <span className="tb-batch-n" aria-live="polite">
        {label}
      </span>
      <div className="tb-batch-acts">
        <button
          type="button"
          className="btn sm"
          aria-haspopup="menu"
          disabled={p.busy}
          onClick={(e) => p.openMenu(e.currentTarget, "Mover a", stations, "start")}
        >
          Mover a
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 4.5l3 3 3-3" />
          </svg>
        </button>
        <button type="button" className="btn sm" disabled={p.busy || !p.onDispatch} onClick={() => p.onDispatch?.()}>
          Dárselas a Claude
        </button>
        <button type="button" className="btn sm" disabled={p.busy || !p.ignoreLabel} aria-label={p.ignoreLabel ?? "Ignorar proyecto"} onClick={p.onIgnore}>
          <span className="tb-batch-full">{p.ignoreLabel ?? "Ignorar proyecto"}</span>
          <span className="tb-batch-short" aria-hidden="true">
            Ignorar
          </span>
        </button>
      </div>
      <button type="button" className="btn sm tb-batch-x" onClick={p.onCancel}>
        Cancelar
      </button>
    </div>
  );
}
