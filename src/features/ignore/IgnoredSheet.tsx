"use client";
// "N ignorados": the quiet link on Hoy's source tabs and the sheet that lists ignored
// projects with "Dejar de ignorar".
import { useState } from "react";
import { SourceDot } from "@/components/line/Line";
import { Btn } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/interactive";
import { ignoredCountLabel, ignoredDetail, type IgnoredRow } from "./model";
import { useIgnore } from "./useIgnore";
import "./ignore.css";

export function IgnoredLink({ rows, className }: { rows: IgnoredRow[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const { unignore } = useIgnore();
  const [busy, setBusy] = useState<string | null>(null);
  if (!rows.length && !open) return null;
  return (
    <>
      <button type="button" className={className ? `ig-link ${className}` : "ig-link"} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {ignoredCountLabel(rows.length)}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Proyectos ignorados">
        <p className="ig-note">No entran a Hoy ni al tablero, y Claude no los barre. Lo que ya estaba sigue guardado y vuelve al dejar de ignorarlo.</p>
        {rows.length ? (
          <ul className="ig-list">
            {rows.map((r) => (
              <li key={r.id}>
                {r.source === "*" ? <span className="ig-all" aria-hidden="true" /> : <SourceDot source={r.source} />}
                <span className="ig-name">
                  <b>{r.label}</b>
                  <small>{ignoredDetail(r)}</small>
                </span>
                <Btn
                  size="sm"
                  disabled={busy === r.id}
                  onClick={() => {
                    setBusy(r.id);
                    void unignore(r).finally(() => setBusy(null));
                  }}
                >
                  Dejar de ignorar
                </Btn>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ig-empty">No ignoras ningún proyecto.</p>
        )}
      </Sheet>
    </>
  );
}
