"use client";
// The Stream Deck GitHub key's number in the rail foot and in the phone's Ajustes sheet: polls GET /api/deck (the deck's
// own file, no GitHub call) and opens the panel on click. A failed request or a missing file reads "sin dato".
import { useEffect, useState } from "react";
import { openDeckPanel } from "./panel";
import "./deck.css";

const POLL_MS = 30_000;

export interface DeckLineView {
  state: "none" | "fresh" | "stale";
  total: number | null;
  age: string;
}
export const NO_DECK: DeckLineView = { state: "none", total: null, age: "" };

/** Presentational (no hooks), so /kit can show every state. */
export function DeckBlock({ view, onOpen }: { view: DeckLineView; onOpen: () => void }) {
  const none = view.state === "none" || view.total === null;
  const name = none
    ? "PRs pendientes de review del deck: sin dato. Abrir el detalle"
    : `PRs pendientes de review del deck: ${view.total}${view.state === "stale" ? ", dato viejo" : ""}. Abrir el detalle`;
  return (
    <button type="button" className={view.state === "stale" ? "rl-deck stale" : "rl-deck"} aria-haspopup="dialog" aria-label={name} onClick={onOpen}>
      <span className="k">Deck</span>
      <span className="dk-row">
        <span>PRs por revisar</span>
        {none ? <small>sin dato</small> : <b>{view.total}</b>}
      </span>
      {none ? null : <small className="dk-age">{view.state === "stale" ? `stale · ${view.age}` : view.age}</small>}
    </button>
  );
}

export function DeckLine({ onOpen }: { onOpen?: () => void }) {
  const [view, setView] = useState<DeckLineView>(NO_DECK);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/deck", { cache: "no-store", signal: AbortSignal.timeout(6000) });
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as { view?: DeckLineView };
        if (alive && body.view) setView({ state: body.view.state, total: body.view.total, age: body.view.age });
      } catch {
        if (alive) setView(NO_DECK);
      }
    };
    const first = window.setTimeout(() => void load(), 0);
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  return <DeckBlock view={view} onOpen={onOpen ?? openDeckPanel} />;
}
