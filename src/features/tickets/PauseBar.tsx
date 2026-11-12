"use client";
// "En pausa" / "En proceso" controls in the thread header (t126). A paused or ongoing ticket shows its reason, the ticket
// it waits for (a link) and "Reanudar"; any other open ticket offers "Pausar" (a reason and, optionally, a ticket ref).
// "En proceso" is Claude's to set (mesa ticket ongoing): the UI only pauses and resumes.
import Link from "next/link";
import { useState } from "react";
import type { PickTicket } from "./read";
import type { TicketDetail } from "@/lib/domain/types";
import { useToast } from "@/components/ui/interactive";
import { ticketApi } from "./api";
import { statusLabel } from "./bits";

interface Props {
  t: Pick<TicketDetail, "id" | "ref" | "status" | "pauseReason" | "pausedUntil">;
  pick: PickTicket[];
  listening: boolean;
  onChanged: () => void;
}

export function PauseBar({ t, pick, listening, onChanged }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  if (t.status === "closed") return null;

  const run = async (fn: () => Promise<unknown>, ok: string, done?: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast({ text: ok });
      done?.();
      onChanged();
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudo completar" });
    } finally {
      setBusy(false);
    }
  };

  if (t.status === "paused" || t.status === "ongoing") {
    return (
      <div className="tk-pause" role="group" aria-label={statusLabel(t.status)}>
        <span className="st">{statusLabel(t.status)}</span>
        <span className="tk-pause-why">
          {t.pauseReason}
          {t.pausedUntil ? (
            <>
              {" "}
              · hasta{" "}
              <Link href={`/tickets?t=${encodeURIComponent(t.pausedUntil)}`} className="tk-pause-dep">
                {t.pausedUntil}
              </Link>
            </>
          ) : null}
        </span>
        <button
          className="btn sm"
          type="button"
          disabled={busy}
          onClick={() => void run(() => ticketApi.resume(t.id), listening ? "Reanudado · Claude despierta" : "Reanudado · lo lee la próxima sesión")}
        >
          Reanudar
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="tk-pause idle">
        <button className="btn sm" type="button" onClick={() => setOpen(true)}>
          Pausar
        </button>
      </div>
    );
  }

  const candidates = pick.filter((p) => p.status !== "closed" && p.ref !== t.ref);
  const submit = () => {
    if (!reason.trim() || busy) return;
    void run(
      () => ticketApi.pause(t.id, reason.trim(), until.trim()),
      "Ticket en pausa",
      () => {
        setOpen(false);
        setReason("");
        setUntil("");
      },
    );
  };
  return (
    <form
      className="tk-pause form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input className="tk-field" aria-label="Motivo de la pausa" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (obligatorio)" autoFocus />
      <input
        className="tk-field"
        aria-label="Ticket del que depende"
        list={`tk-until-${t.id}`}
        value={until}
        onChange={(e) => setUntil(e.target.value)}
        placeholder="Hasta que se cierre… (tN, opcional)"
      />
      <datalist id={`tk-until-${t.id}`}>
        {candidates.map((p) => (
          <option key={p.ref} value={p.ref}>
            {p.title}
          </option>
        ))}
      </datalist>
      <span className="tk-pause-acts">
        <button className="btn sm p" type="submit" disabled={busy || !reason.trim()}>
          Pausar
        </button>
        <button className="btn sm" type="button" disabled={busy} onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </span>
    </form>
  );
}
