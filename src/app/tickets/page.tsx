// Tickets A (list + thread). Placeholder until lane B builds it.
import type { Metadata } from "next";
import { DirectionMarker } from "@/components/line/Line";
import { ScreenFrame } from "@/components/shell/ScreenFrame";
import { StatusTag } from "@/components/ui/primitives";
import { TICKET_STATUS_LABEL } from "@/lib/domain/ticket-machine";
import { repos } from "@/lib/repo";

export const metadata: Metadata = { title: "Tickets" };

export default function TicketsPage() {
  const tickets = repos().tickets.list({ open: true });
  return (
    <ScreenFrame title="Tickets" meta={`${tickets.length} abiertos`}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <DirectionMarker direction="claude_asks" />
        <DirectionMarker direction="andres_asks" />
      </div>
      {tickets.slice(0, 5).map((t) => (
        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <DirectionMarker direction={t.direction} label={t.ref} />
          <span style={{ flex: 1, fontWeight: 600 }}>{t.title}</span>
          <StatusTag tone={t.status === "waiting_andres" ? "you" : t.status === "working" ? "cl" : "plain"}>
            {TICKET_STATUS_LABEL[t.status]}
          </StatusTag>
        </div>
      ))}
      <p>Un solo flujo con Claude: la dirección es una marca en la fila, no un tablero aparte.</p>
    </ScreenFrame>
  );
}
