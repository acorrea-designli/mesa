"use client";
// Hoy, Recordatorios (t191): the open standalone reminders (`mesa remind <when> <text>`). A pending one shows when it will
// ring and can be dropped; one that already rang stays until Andrés marks it "Hecho". A timed pause is not listed here:
// the ticket itself comes back to Claude.
import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/components/ui/interactive";
import { call } from "@/features/salidas/api";
import type { HoyData } from "./model";

export function Reminders({ rows, disabled }: { rows: HoyData["reminders"]; disabled?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (r: HoyData["reminders"][number], what: "cancel" | "done") => {
    setBusy(r.id);
    try {
      await call(`/api/reminders/${encodeURIComponent(r.id)}/${what}`, { method: "POST" });
      toast({ text: what === "done" ? "Recordatorio hecho" : "Recordatorio quitado" });
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudo actualizar" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="hy-rem" aria-label="Recordatorios">
      <div className="grp">Recordatorios</div>
      <fieldset className="hy-fs" disabled={disabled}>
        {rows.map((r) => (
          <div key={r.id} className={r.fired ? "hy-rem-row fired" : "hy-rem-row"}>
            <span className="when">{r.fired ? `Sonó ${r.when}` : r.when}</span>
            <span className="what">
              {r.text}
              {r.ticketRef ? (
                <>
                  {" "}
                  <Link href={`/tickets?t=${encodeURIComponent(r.ticketRef)}`}>{r.ticketRef}</Link>
                </>
              ) : null}
            </span>
            <button className="btn sm" type="button" disabled={busy === r.id} onClick={() => void act(r, r.fired ? "done" : "cancel")} aria-label={`${r.fired ? "Marcar hecho" : "Quitar"}: ${r.text}`}>
              {r.fired ? "Hecho" : "Quitar"}
            </button>
          </div>
        ))}
      </fieldset>
    </section>
  );
}
