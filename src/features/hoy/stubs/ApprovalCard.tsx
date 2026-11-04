"use client";
// Stand-in for lane B's <ApprovalCard approval /> (src/features/approvals/ApprovalCard.tsx):
// a permission request from an agent with no ticket. Same props and routes; swap the
// import in HoyView.tsx when lane B lands.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Btn, Label } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/interactive";
import type { Approval } from "@/lib/domain/types";

function left(expiresAt: string, now: number): string {
  const s = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ApprovalCard({ approval: a }: { approval: Approval }) {
  const router = useRouter();
  const toast = useToast();
  const [now, setNow] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    const t = () => setNow(Date.now());
    const first = window.setTimeout(t, 0);
    const id = window.setInterval(t, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  const expired = a.status === "expired" || (now !== null && Date.parse(a.expiresAt) <= now);

  const decide = async (path: "approve" | "read-config" | "deny", label: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/approvals/${a.id}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(path === "deny" && note.trim() ? { note: note.trim() } : {}),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(e?.error?.message ?? `HTTP ${res.status}`);
      }
      toast({ text: label });
      router.refresh();
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudo" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (expired) {
    return (
      <article className="ap-card is-expired" aria-label={`Permiso para ${a.tool}, caducado`}>
        <p>
          <b>Caducó</b> · {a.agent} pedía {a.tool}. El agente preguntará por ticket.
        </p>
      </article>
    );
  }

  return (
    <article className="ap-card" aria-label={`Permiso para ${a.tool}`}>
      <div className="ap-top">
        <span className="ap-ring" aria-hidden="true" />
        <span className="ap-who">
          {a.agent} · <b>{a.tool}</b>
        </span>
        <time className="ap-left" aria-label="Tiempo restante">
          {now === null ? "" : `caduca en ${left(a.expiresAt, now)}`}
        </time>
      </div>
      <h3 className="ap-sum">{a.summary}</h3>
      {a.detail ? <pre className="ap-detail">{a.detail}</pre> : null}
      {a.cwd ? <div className="ap-cwd">{a.cwd}</div> : null}
      {a.hints.length ? (
        <>
          <Label>Reglas parecidas que ya tienes</Label>
          <ul className="ap-hints">
            {a.hints.slice(0, 3).map((h) => (
              <li key={h}>
                <code>{h}</code>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {noting ? (
        <label className="ap-note">
          <span className="sr-only">Nota para el agente</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota para el agente (opcional)" maxLength={2000} autoFocus />
        </label>
      ) : null}
      <div className="hy-acts">
        <Btn variant="primary" size="sm" disabled={busy} onClick={() => void decide("approve", "Permiso dado para esta llamada")}>
          Dar permiso
        </Btn>
        <Btn size="sm" disabled={busy} onClick={() => void decide("read-config", "Le pediste que lea tus configuraciones")}>
          Lee tus configuraciones
        </Btn>
        <Btn
          size="sm"
          disabled={busy}
          onClick={() => (noting ? void decide("deny", "Permiso denegado") : setNoting(true))}
        >
          {noting ? "Denegar con nota" : "Denegar"}
        </Btn>
      </div>
    </article>
  );
}
