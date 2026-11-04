"use client";
// <SalidaApproval salidaId compact /> for lane A's Hoy detail pane (392 px): kind
// line, destination (route, or chips when compact), context, exact text, split
// approve, Editar, Denegar and the 20 s undo window. Loads the salida itself and
// refreshes on live events; pass `initial` to skip the first fetch.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { SalidaDetail } from "@/lib/domain/types";
import { Kind } from "@/components/ui/primitives";
import { SplitApprove } from "@/components/ui/interactive";
import { usePress } from "@/lib/motion";
import { salidaApi } from "./api";
import { useSalidaController } from "./controller";
import { IcPencil } from "./icons";
import { useLive, useNow } from "./live";
import { hhmm, sourceLabel } from "./model";
import { DestChips, Route } from "./parts";
import { ExactBlock, StateBlocks } from "./SalidaCard";
import "./salidas.css";

export interface SalidaApprovalProps {
  salidaId: string;
  /** Narrow pane: destination as chips, smaller buttons, no stepper. */
  compact?: boolean;
  initial?: SalidaDetail;
  /** Called after any change (approve, undo, deny…), e.g. to refresh the Hoy list. */
  onChange?: (s: SalidaDetail) => void;
}

export function SalidaApproval({ salidaId, compact, initial, onChange }: SalidaApprovalProps) {
  const [data, setData] = useState<SalidaDetail | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    salidaApi
      .get(salidaId)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [salidaId]);
  useEffect(() => {
    if (!initial || initial.id !== salidaId) load();
  }, [salidaId, initial, load]);
  useLive(load);
  if (!data) return <div className="sa-apv">{error ? <p className="sa-why-line">No se pudo cargar la salida: {error}</p> : <p className="sa-why-line">Cargando…</p>}</div>;
  return <ApprovalBody key={data.id} data={data} compact={compact} onChange={(d) => (setData(d), onChange?.(d))} />;
}

function ApprovalBody({ data, compact, onChange }: { data: SalidaDetail; compact?: boolean; onChange: (d: SalidaDetail) => void }) {
  const c = useSalidaController(data, { onChange });
  const { s } = c;
  const now = useNow(data.updatedAt, true, s.status === "sending" ? 250 : 1000);
  const [confirmDel, setConfirmDel] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const ref = usePress<HTMLDivElement>(".btn");
  const cur = s.versions.find((v) => v.n === s.currentVersion);
  const text = cur?.body ?? "";
  return (
    <div className={compact ? "sa-apv compact" : "sa-apv"} ref={ref}>
      <Kind source={s.source}>
        Salida · {sourceLabel(s.source)} · {hhmm(s.createdAt)}
      </Kind>
      <h2>{s.title || "Mensaje"}</h2>
      <div className="k">Destino exacto</div>
      {compact ? <DestChips d={s.destination} source={s.source} /> : <Route d={s.destination} source={s.source} />}
      {s.context ? <blockquote className="ctx">{s.context}</blockquote> : null}
      {c.mode === "edit" && draft !== null ? (
        <>
          <div className="k">Tu versión</div>
          <textarea className="sa-edit" value={draft} aria-label="Tu versión del texto" onChange={(e) => setDraft(e.target.value)} autoFocus />
          <div className="acts">
            <SplitApprove version={s.versions.length + 1} label="Aprobar y enviar mi versión" disabled={!draft.trim() || draft === text || c.busy} onSend={() => c.approveText(draft)} onSchedule={async () => (await c.saveText(draft)) && c.setMode("pick")} />
            <button className="btn" type="button" onClick={() => c.setMode("view")}>
              Descartar
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="k">
            Texto exacto que se enviará{s.versions.length > 1 ? ` · v${s.currentVersion} de ${s.versions.length}` : ""}
          </div>
          <ExactBlock s={s} text={text} marks={[]} />
        </>
      )}
      <StateBlocks c={c} now={now} confirmDel={confirmDel} setConfirmDel={setConfirmDel} compact={compact} />
      {s.status === "pending" && c.mode === "view" ? (
        <div className="acts">
          <SplitApprove version={s.currentVersion} disabled={c.locked || c.busy} onSend={() => c.approve()} onSchedule={() => c.setMode("pick")} />
          <button
            className="btn"
            type="button"
            disabled={c.locked || c.busy}
            onClick={() => {
              setDraft(text);
              c.setMode("edit");
            }}
          >
            <IcPencil />
            Editar
          </button>
          <button className="btn" type="button" disabled={c.busy} onClick={c.deny}>
            Denegar
          </button>
        </div>
      ) : null}
      {c.rewritePending ? <p className="sa-why-line">Claude está reescribiendo; espera la nueva versión para aprobar.</p> : null}
      <div className="meta">
        <Link href={`/salidas?s=${s.id}`}>Abrir en Salidas · afinar con Claude</Link>
        {s.isSample ? <span>Datos de muestra.</span> : null}
      </div>
    </div>
  );
}
