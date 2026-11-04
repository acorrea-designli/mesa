// Salidas B (one card at a time, free order, queue strip). Placeholder until lane B builds it.
import type { Metadata } from "next";
import { ScreenFrame } from "@/components/shell/ScreenFrame";
import { repos } from "@/lib/repo";

export const metadata: Metadata = { title: "Salidas" };

export default function SalidasPage() {
  const pending = repos().salidas.list({ status: ["pending", "scheduled"] });
  return (
    <ScreenFrame title="Salidas" meta="Nada sale sin tu firma">
      <p>
        {pending.length === 1 ? "1 pendiente" : `${pending.length} pendientes`}. Cada mensaje muestra su destino exacto y su texto exacto antes de
        que lo apruebes, con 20 s para deshacer.
      </p>
    </ScreenFrame>
  );
}
