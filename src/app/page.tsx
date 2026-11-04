// Hoy. Placeholder until lane A builds the line band, rows and detail pane.
import { ScreenFrame } from "@/components/shell/ScreenFrame";
import { StatusTag } from "@/components/ui/primitives";
import { STATION_LABEL, STATIONS } from "@/lib/domain/types";
import { repos } from "@/lib/repo";

export default function HoyPage() {
  const c = repos().counts();
  const today = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "short" }).format(new Date());
  return (
    <ScreenFrame title="Línea del día" meta={today}>
      <div className="tabs" aria-label="Estaciones">
        {STATIONS.map((s) => (
          <StatusTag key={s} tone={s === "inbox" && c.stations.inbox > 0 ? "you" : "plain"}>
            {STATION_LABEL[s]} {c.stations[s]}
          </StatusTag>
        ))}
      </div>
      <p>Aquí va la línea del día: las fuentes como líneas y las estaciones Inbox, Todo, En curso, Esperando y Hecho.</p>
    </ScreenFrame>
  );
}
