"use client";
// <ApprovalCard approval /> : a blocked tool call waiting for Andrés. Shows the agent,
// the tool, the exact command or diff, the cwd, the closest allow rule and the time
// left. Dar permiso allows this one call; Lee tus configuraciones and Denegar deny.
// Expired or decided cards collapse to one line and can never be decided again.
import { useEffect, useRef, useState } from "react";
import type { Approval, ApprovalDecision } from "@/lib/domain/types";
import { useToast } from "@/components/ui/interactive";
import { rise, usePress } from "@/lib/motion";
import { call } from "@/features/salidas/api";
import "./approvals.css";

const PATH: Record<ApprovalDecision, string> = { allow: "approve", read_config: "read-config", deny: "deny" };
const DONE: Record<ApprovalDecision, string> = {
  allow: "Diste permiso para esta llamada",
  read_config: "Le pediste que lea tus configuraciones",
  deny: "Denegaste",
};

function left(expiresAt: string, now: number): string {
  const s = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
const hm = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function ApprovalCard({ approval, onDecided, showTicket }: { approval: Approval; onDecided?: (a: Approval) => void; showTicket?: boolean }) {
  const toast = useToast();
  const [a, setA] = useState(approval);
  const [now, setNow] = useState(() => Date.parse(approval.createdAt));
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = usePress<HTMLDivElement>(".btn");
  const noteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (approval.status !== a.status || approval.decidedAt !== a.decidedAt) setA(approval);
  }, [approval, a.status, a.decidedAt]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    if (a.status !== "pending") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [a.status]);
  useEffect(() => {
    if (noting && noteRef.current) {
      noteRef.current.focus();
      rise(noteRef.current.parentElement!);
    }
  }, [noting]);

  const expired = a.status === "expired" || (a.status === "pending" && Date.parse(a.expiresAt) <= now);
  const decide = async (d: ApprovalDecision) => {
    setBusy(true);
    try {
      const res = await call<{ approval: Approval }>(`/api/approvals/${a.id}/${PATH[d]}`, { body: d === "deny" && note.trim() ? { note: note.trim() } : {} });
      setA(res.approval);
      onDecided?.(res.approval);
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudo decidir" });
    } finally {
      setBusy(false);
    }
  };

  if (expired)
    return (
      <div className="ap-card off" role="status">
        <span className="ap-line" aria-hidden="true" />
        <span>
          <b>Caducó</b> · el agente preguntará por ticket · {a.tool} de {a.agent}
        </span>
      </div>
    );
  if (a.status === "decided" && a.decision)
    return (
      <div className="ap-card done" role="status">
        <span className="ap-line" aria-hidden="true" />
        <span>
          <b>{DONE[a.decision]}</b> · {a.tool} de {a.agent} · {hm(a.decidedAt)}
          {a.note ? ` · «${a.note}»` : ""}
        </span>
      </div>
    );

  const isDiff = /^(@@|[+-]\s|diff --git)/m.test(a.detail);
  return (
    <div className="ap-card" ref={ref} role="group" aria-label={`Permiso pedido por ${a.agent}`}>
      <div className="ap-h">
        <span className="ap-line" aria-hidden="true" />
        <b>Permiso</b>
        <span className="ap-agent">{a.agent}</span>
        {showTicket && a.ticketRef ? <span className="ap-agent">· ticket {a.ticketRef}</span> : null}
        <span className="ap-left">caduca en {left(a.expiresAt, now)}</span>
      </div>
      <div className="ap-tool">
        <span className="ap-tag">{a.tool}</span>
        <span>{a.summary}</span>
      </div>
      {a.detail ? (
        <pre className={isDiff ? "ap-detail diff" : "ap-detail"} aria-label={isDiff ? "Cambio" : "Comando exacto"}>
          {isDiff
            ? a.detail.split("\n").map((l, i) => (
                <span key={i} className={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hunk" : undefined}>
                  {l}
                  {"\n"}
                </span>
              ))
            : a.detail}
        </pre>
      ) : null}
      <div className="ap-facts">
        {a.cwd ? <span>en {a.cwd}</span> : null}
        <span>
          {a.hints.length ? (
            <>
              Regla más cercana: <code>{a.hints[0]}</code>
            </>
          ) : (
            "Ninguna regla tuya se parece"
          )}
        </span>
      </div>
      {noting ? (
        <div className="ap-note">
          <input
            ref={noteRef}
            value={note}
            placeholder="Nota para el agente (opcional)"
            aria-label="Nota para el agente"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void decide("deny");
              if (e.key === "Escape") setNoting(false);
            }}
          />
          <button className="btn sm p" type="button" disabled={busy} onClick={() => decide("deny")}>
            Denegar
          </button>
          <button className="btn sm" type="button" onClick={() => setNoting(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <div className="ap-acts">
          <button className="btn sm p" type="button" disabled={busy} onClick={() => decide("allow")}>
            Dar permiso
          </button>
          <button className="btn sm" type="button" disabled={busy} onClick={() => decide("read_config")} title={a.hints[0] ? `Le dice que reintente con la forma de ${a.hints[0]}` : undefined}>
            Lee tus configuraciones
          </button>
          <button className="btn sm" type="button" disabled={busy} onClick={() => setNoting(true)}>
            Denegar
          </button>
        </div>
      )}
      <p className="ap-why">Dar permiso vale solo para esta llamada; no crea ninguna regla.</p>
    </div>
  );
}
