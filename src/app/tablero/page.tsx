// Tablero B (lanes by source). Placeholder until lane A builds it.
import type { Metadata } from "next";
import { LineStub } from "@/components/line/Line";
import { ScreenFrame } from "@/components/shell/ScreenFrame";
import { SOURCE_LABEL, SOURCES } from "@/lib/domain/types";
import { repos } from "@/lib/repo";

export const metadata: Metadata = { title: "Tablero" };

export default function TableroPage() {
  const tasks = repos().tasks.list();
  return (
    <ScreenFrame title="Tablero" meta="Sincronizado con tu GitHub Project">
      {SOURCES.map((s) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600 }}>
          <LineStub source={s} width={40} />
          {SOURCE_LABEL[s]}
          <span style={{ color: "var(--mute)" }}>{tasks.filter((t) => t.source === s).length}</span>
        </div>
      ))}
      <p>Un carril por fuente y cinco estaciones. Mover una tarjeta actualiza el Status en el GitHub Project.</p>
    </ScreenFrame>
  );
}
