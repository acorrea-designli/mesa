"use client";
// The Hoy batch bar: docked at the bottom while item rows are selected. "N seleccionados", "Abrir tarea y pasar a
// Claude", "Cancelar". Same look and riseBar motion as Tablero's bar (shared CSS: src/styles/batch-bar.css).
import { useEffect, useRef } from "react";
import { riseBar } from "@/lib/motion";
import { selectedLabel } from "./model";

export function BatchBar({ count, busy, onDispatch, onCancel }: { count: number; busy: boolean; onDispatch: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) riseBar(ref.current);
  }, []);
  const label = selectedLabel(count);
  return (
    <div ref={ref} className="tb-batch solo hy-batch" role="toolbar" aria-label={`Acciones en lote · ${label}`}>
      <span className="tb-batch-n" aria-live="polite">
        {label}
      </span>
      <div className="tb-batch-acts">
        <button type="button" className="btn sm p" disabled={busy} onClick={onDispatch}>
          Abrir tarea y pasar a Claude
        </button>
      </div>
      <button type="button" className="btn sm tb-batch-x" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}
