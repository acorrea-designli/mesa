// Small presentational pieces for Tickets A.
import type { Ticket } from "@/lib/domain/types";
import { StatusTag } from "@/components/ui/primitives";
import { IcCheck, LiveTrack } from "@/features/salidas/icons";

/** The asker's line runs into the receiver's ring (tickets.html, 34x12). */
export function DirLine({ direction }: { direction: Ticket["direction"] }) {
  const claude = direction === "claude_asks";
  return (
    <svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M2 6H24" fill="none" stroke={claude ? "var(--cl)" : "var(--ink)"} strokeWidth="4" strokeLinecap="round" />
      <circle cx="28" cy="6" r="4" fill="var(--gnd)" stroke={claude ? "var(--ink)" : "var(--cl)"} strokeWidth="2.4" />
    </svg>
  );
}

export const dirLabel = (d: Ticket["direction"]) => (d === "claude_asks" ? "Claude pregunta" : "Pediste");

export function Dir({ direction }: { direction: Ticket["direction"] }) {
  return (
    <span className="tk-dir">
      <DirLine direction={direction} />
      {dirLabel(direction)}
    </span>
  );
}

export const statusLabel = (s: Ticket["status"]) =>
  ({ waiting_andres: "Te espera", waiting_claude: "Espera a Claude", working: "Claude trabaja", closed: "Cerrado" })[s];

/** A ticket with something for Andrés reads "Te espera" whatever its stored status (ticket-needs.ts). The action's name goes in the excerpt, never in a second solid tag. */
export function TicketStatus({ t }: { t: Pick<Ticket, "status"> & { needs?: unknown[] } }) {
  if (t.needs?.length) return <StatusTag tone="you">Te espera</StatusTag>;
  switch (t.status) {
    case "waiting_andres":
      return <StatusTag tone="you">Te espera</StatusTag>;
    case "waiting_claude":
      return <StatusTag tone="cl">Espera a Claude</StatusTag>;
    case "working":
      return <StatusTag tone="cl">Claude trabaja</StatusTag>;
    case "closed":
      return (
        <StatusTag tone="ok" icon={<IcCheck width={12} height={12} />}>
          Cerrado
        </StatusTag>
      );
  }
}

/** "Claude escuchando · te despierta al responder" or the dashed "Nadie escucha". */
export function LivePill({ listening, compact }: { listening: boolean; compact?: boolean }) {
  return listening ? (
    <span className="live" role="status">
      <LiveTrack />
      Claude escuchando {compact ? null : <small>· te despierta al responder</small>}
    </span>
  ) : (
    <span className="live off" role="status">
      <LiveTrack off />
      <span>
        Nadie escucha {compact ? null : <small>· ninguna sesión atenta</small>}
      </span>
    </span>
  );
}

export const hm = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
