"use client";
// Review card inside a ticket: the reviewer's findings with Approve, Approve anyway
// (waives open findings), and per finding Post, Dismiss, Explain more. Every GitHub
// write is a salida: the press approves the exact text shown, then 20 s to undo.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Finding, Review, ReviewAction, SalidaDetail } from "@/lib/domain/types";
import { useIdentity } from "@/components/identity";
import { useToast } from "@/components/ui/interactive";
import { usePress } from "@/lib/motion";
import { call, salidaApi } from "@/features/salidas/api";
import { secondsLeft, undoOpen } from "@/features/salidas/model";
import { postable, takesActions } from "./model";
import "./reviews.css";

const LABEL: Record<Finding["label"], string> = { blocker: "bloqueante", nit: "detalle", comment: "comentario" };
const STATE: Record<Finding["state"], string> = { open: "abierto", fixed: "corregido", waived: "aceptado sin cambio", dismissed: "descartado" };
const body = (f: Finding) => (f.explanation ? `${f.summary}\n\n${f.explanation}` : f.summary);

export function ReviewCard({ review, onChange }: { review: Review; onChange?: () => void }) {
  const toast = useToast();
  const { ghUser } = useIdentity();
  const [r, setR] = useState(review);
  const [picked, setPicked] = useState<number[]>([]);
  const [preview, setPreview] = useState<number[] | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = usePress<HTMLDivElement>(".btn");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (review.updatedAt !== r.updatedAt || review.findings.length !== r.findings.length) setR(review);
  }, [review, r.updatedAt, r.findings.length]);

  const open = r.findings.filter((f) => f.state === "open");
  const blockers = open.filter((f) => f.label === "blocker");
  const live = takesActions(r);
  const canPost = (f: Finding) => postable(r, f);

  const act = async (action: ReviewAction, findingNs?: number[]) => {
    setBusy(true);
    try {
      const res = await call<{ review: Review; salidaIds: string[] }>(`/api/reviews/${r.id}/actions`, { body: { action, findingNs } });
      setR(res.review);
      setSent((s) => [...res.salidaIds, ...s]);
      setPicked([]);
      setPreview(null);
      if (action === "dismiss") toast({ text: "Descartado" });
      if (action === "explain") toast({ text: "Le pediste más detalle al revisor" });
      onChange?.();
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudo completar" });
    } finally {
      setBusy(false);
    }
  };

  const previewList = preview ? r.findings.filter((f) => preview.includes(f.n)) : [];
  // Same rule as the server: a blocker among the posted findings makes the GitHub review request changes.
  const requestsChanges = previewList.some((f) => f.label === "blocker");

  return (
    <div className="rv-card" ref={ref} aria-label={`Revisión de ${r.repo}#${r.pr}`}>
      <div className="rv-h">
        <span className="ln src-github" style={{ background: "var(--c)" }} aria-hidden="true" />
        <b>
          Revisión · {r.repo}#{r.pr}
        </b>
        {r.headSha ? <code>{r.headSha.slice(0, 7)}</code> : null}
        <span className="rv-st">
          {r.state === "closed"
            ? `Cerrada · ${r.closeReason ?? ""}`
            : r.state === "approved"
              ? "Aprobado"
              : r.state === "approving"
                ? "Aprobando · en Salidas"
                : `${open.length} abiertos`}
        </span>
      </div>
      {r.findings.length === 0 ? (
        <p className="rv-empty">{r.state === "open" ? "Sin hallazgos · listo para aprobar" : "Sin hallazgos"}</p>
      ) : null}
      <ul className="rv-list">
        {r.findings.map((f) => (
          <li key={f.id} className={f.state === "open" ? "rv-f" : "rv-f off"}>
            <label className="rv-pick">
              <input
                type="checkbox"
                hidden={!canPost(f)}
                disabled={!canPost(f)}
                checked={picked.includes(f.n)}
                onChange={() => setPicked((p) => (p.includes(f.n) ? p.filter((x) => x !== f.n) : [...p, f.n]))}
                aria-label={`Elegir hallazgo ${f.n}`}
              />
            </label>
            <div className="rv-main">
              <div className="rv-top">
                <span className={`rv-tag ${f.label}`}>{LABEL[f.label]}</span>
                {f.at ? <code>{f.at}</code> : null}
                <span className="rv-state">{f.salidaId || f.ghCommentId ? "publicado" : STATE[f.state]}</span>
              </div>
              <p className="rv-sum">{f.summary}</p>
              {f.explanation ? <p className="rv-exp">{f.explanation}</p> : null}
              {live && f.state === "open" ? (
                <div className="rv-acts">
                  {canPost(f) ? (
                    <button className="btn sm" type="button" disabled={busy} onClick={() => setPreview([f.n])}>
                      Post
                    </button>
                  ) : null}
                  <button className="btn sm" type="button" disabled={busy} onClick={() => act("dismiss", [f.n])}>
                    Dismiss
                  </button>
                  <button className="btn sm" type="button" disabled={busy} onClick={() => act("explain", [f.n])}>
                    Explain more
                  </button>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {preview ? (
        <div className="rv-preview" role="dialog" aria-label="Lo que se publicará">
          <div className="k">
            {requestsChanges
              ? `Se publica como una revisión que pide cambios en ${r.repo}#${r.pr} · como ${ghUser}`
              : `Se publica como una revisión en ${r.repo}#${r.pr} · como ${ghUser}`}
          </div>
          {previewList.map((f) => (
            <div key={f.n} className="msg src-github rv-msg">
              <span className="sa-ghat">{f.at || "Conversación del PR"}</span>
              {body(f)}
            </div>
          ))}
          <div className="rv-acts">
            <button className="btn sm p" type="button" disabled={busy} onClick={() => act("post", preview)}>
              {requestsChanges ? "Pedir cambios" : "Publicar"} {previewList.length === 1 ? "el comentario" : `${previewList.length} comentarios`} · 20 s para deshacer
            </button>
            <button className="btn sm" type="button" onClick={() => setPreview(null)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {r.state === "open" ? (
        <div className="rv-bar">
          <button className="btn sm p" type="button" disabled={busy || blockers.length > 0} onClick={() => act("approve")} aria-describedby={blockers.length ? `rv-why-${r.id}` : undefined}>
            Approve
          </button>
          {open.length ? (
            <button className="btn sm" type="button" disabled={busy} onClick={() => act("approve_anyway")} title={`Acepta sin cambio ${open.length} hallazgos abiertos`}>
              Approve anyway
            </button>
          ) : null}
          {picked.length ? (
            <button className="btn sm" type="button" disabled={busy} onClick={() => setPreview(picked)}>
              Post {picked.length} {picked.length === 1 ? "elegido" : "elegidos"}
            </button>
          ) : null}
          {blockers.length ? (
            <span className="rv-why" id={`rv-why-${r.id}`}>
              {blockers.length} {blockers.length === 1 ? "bloqueante abierto" : "bloqueantes abiertos"}: Approve espera a que se corrijan
            </span>
          ) : (
            <span className="rv-why">Aprobación sin comentario</span>
          )}
        </div>
      ) : null}

      {sent.map((id) => (
        <SalidaUndo key={id} id={id} />
      ))}
    </div>
  );
}

/** "Enviando en 14 s · Deshacer" for a salida the press just approved. */
function SalidaUndo({ id }: { id: string }) {
  const toast = useToast();
  const [s, setS] = useState<SalidaDetail | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    salidaApi.get(id).then((d) => live && setS(d)).catch(() => {});
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [id]);
  if (!s) return null;
  const open = undoOpen(s, now);
  return (
    <div className="rv-undo" role="status">
      <span className="ln src-github" style={{ background: "var(--c)" }} aria-hidden="true" />
      <span>
        <b>{open ? `Enviando en ${secondsLeft(s.undoUntil, now)} s` : s.status === "pending" ? "Deshecho · no salió nada" : "En Salidas"}</b> · {s.title}
      </span>
      {open ? (
        <button
          className="btn sm"
          type="button"
          onClick={() =>
            salidaApi
              .undo(id)
              .then(setS)
              .catch((e: Error) => toast({ text: e.message }))
          }
        >
          Deshacer
        </button>
      ) : null}
      <Link className="rv-link" href={`/salidas?s=${id}`}>
        Ver en Salidas
      </Link>
    </div>
  );
}
