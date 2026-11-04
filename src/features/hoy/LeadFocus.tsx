"use client";
// Hoy, Permisos: which ticket the lead's permission prompts are filed to ("mesa lead focus <ref>"), with a
// button to clear it. Prompts raised while a focus is set land in that ticket instead of here.
import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/components/ui/interactive";
import { call } from "@/features/salidas/api";
import type { HoyData } from "./model";

export function LeadFocus({ focus }: { focus: NonNullable<HoyData["leadFocus"]> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const clear = async () => {
    setBusy(true);
    try {
      await call("/api/lead/focus", { method: "DELETE" });
      toast({ text: "Los permisos del lead vuelven a caer aquí" });
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudo quitar" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="hy-focus" role="status">
      <span>
        Los permisos del lead caen en <Link href={`/tickets?t=${encodeURIComponent(focus.ticketRef)}`}>{focus.ticketRef}</Link>
        {focus.title ? ` · ${focus.title}` : ""} <small>hasta las {focus.until} si no lo renueva</small>
      </span>
      <button className="btn sm" type="button" disabled={busy} onClick={() => void clear()} aria-label={`Quitar el foco del lead en ${focus.ticketRef}`}>
        Quitar foco
      </button>
    </div>
  );
}
