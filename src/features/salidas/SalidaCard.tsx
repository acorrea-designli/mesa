"use client";
// Salidas B: one card at a time. Left: origin, destination route, exact text with
// semáforo, version stepper, diff, split approve. Right: history + refine chat on
// top, engram memory below. On the phone the actions dock at the bottom.
import { useEffect, useRef, useState } from "react";
import type { LearnedChip, Mark, SalidaDetail } from "@/lib/domain/types";
import { Alert, Kind } from "@/components/ui/primitives";
import { SplitApprove, Sheet } from "@/components/ui/interactive";
import { usePress } from "@/lib/motion";
import { useSalidaController, type SalidaController } from "./controller";
import { IcCopy, IcEngram, IcPencil, IcRetry } from "./icons";
import { carryKeeps, markOutcome } from "./marks";
import { hhmm, sourceLabel, undoOpen, whenLabel } from "./model";
import {
  Banner,
  cx,
  DestLink,
  Diff,
  DiffLine,
  Facts,
  PhoneRoute,
  Route,
  ScheduledBanner,
  SchedulePicker,
  SendingBanner,
  SentBlock,
  VersionList,
  VersionStepper,
} from "./parts";
import { SemaforoText } from "./Semaforo";
import { Composer, History, MemoryPanel, OriginStrip, RefineChat } from "./side";
import type { SalidaView } from "./types";

export interface CardProps {
  view: SalidaView;
  chips: LearnedChip[];
  now: number;
  marks: Mark[];
  setMarks: (m: Mark[]) => void;
  /** Register the controller so the screen's keyboard shortcuts act on the open card. */
  bind?: (c: SalidaController<SalidaView> | null) => void;
  onDecided: (id: string) => void;
  onUndecided?: (id: string) => void;
  onSkip?: () => void;
  onChanged: () => void;
}

export function SalidaCard({ view, chips, now, marks, setMarks, bind, onDecided, onUndecided, onSkip, onChanged }: CardProps) {
  const c = useSalidaController(view, { onChange: onChanged, onDecided, onUndecided });
  const { s } = c;
  const [histOpen, setHistOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [hl, setHl] = useState<string | null>(null);
  const [memSheet, setMemSheet] = useState(false);
  const pressRef = usePress<HTMLDivElement>(".btn, .sa-qc, .sa-steps button");

  useEffect(() => {
    bind?.(c);
  });
  useEffect(() => () => bind?.(null), [bind]);

  const cur = s.versions.find((v) => v.n === s.currentVersion);
  const text = cur?.body ?? "";
  const answeringTurn = cur?.turnId ? s.turns.find((t) => t.id === cur.turnId) : undefined;
  const pendingN = c.openTurnId ? s.versions.length + 1 : null;

  // Kept marks carry over to the version that answered a marked turn.
  const carried = useRef<string | null>(null);
  useEffect(() => {
    const key = `${s.id}:${s.currentVersion}`;
    if (carried.current === key) return;
    carried.current = key;
    if (answeringTurn?.marks.length && !marks.length) setMarks(carryKeeps(answeringTurn.marks, text));
  }, [s.id, s.currentVersion, answeringTurn, marks.length, setMarks, text]);

  const isGithubBatch = s.destination.kind === "github_review" && Boolean(s.destination.comments?.length);
  const canMark = s.status === "pending" && !c.rewritePending && Boolean(text) && !isGithubBatch && c.mode === "view";
  const sendLabel = s.status === "pending";
  const outcome = answeringTurn?.marks.length ? markOutcome(answeringTurn.marks, text) : null;

  const sendTurn = async (body: string, chip?: string) => {
    if (await c.turn(body, marks, chip)) setMarks([]);
  };

  const textLabel =
    s.status === "scheduled" && s.sendAt
      ? `Texto programado · sale ${whenLabel(s.sendAt, new Date(now))}`
      : s.status === "sent" || s.status === "deleted"
        ? "Texto enviado"
        : s.status === "denied"
          ? "Texto que no saldrá"
          : s.status === "expired"
            ? `Borrador de las ${hhmm(s.createdAt)}`
            : s.status === "sending"
              ? "Texto exacto"
              : "Texto que se enviará";

  const left = (
    <div className="sa-left">
      <OriginStrip s={s} histOpen={histOpen} onToggle={() => setHistOpen((o) => !o)} />
      <Kind source={s.source}>Salida · {sourceLabel(s.source)}</Kind>
      <h2>{s.title || "Mensaje"}</h2>
      <div className="sa-destrow">
        <div className="k">Destino exacto</div>
        <DestLink d={s.destination} url={s.destinationUrl} />
      </div>
      <div className="sa-desk-only">
        <Route d={s.destination} source={s.source} />
      </div>
      <div className="sa-phone-only">
        <PhoneRoute d={s.destination} source={s.source} />
      </div>
      {s.context ? <blockquote className="ctx">{s.context}</blockquote> : null}

      {c.mode === "edit" ? (
        <EditBox c={c} text={text} />
      ) : (
        <>
          <div className={cx("k", canMark && "sm-k")}>
            {textLabel}
            {canMark ? <span>Arrastra sobre el texto para marcar con semáforo</span> : null}
          </div>
          <VersionStepper s={s} pendingN={pendingN} locked={c.locked} listOpen={listOpen} onToggleList={() => setListOpen((o) => !o)} onSelect={(n) => c.select(n)} />
          {listOpen ? (
            <VersionList
              s={s}
              now={now}
              locked={c.locked}
              onStar={(n, on) => c.star(n, on)}
              onBack={(n) => {
                void c.select(n);
                setListOpen(false);
              }}
              onClose={() => setListOpen(false)}
            />
          ) : null}
          <ExactBlock s={s} text={text} marks={marks} setMarks={canMark ? setMarks : undefined} highlight={hl} />
          {!marks.length && s.status === "pending" ? <DiffLine s={s} /> : null}
          {outcome && s.status === "pending" ? <MarkOutcome o={outcome} /> : null}
          {s.status !== "pending" && text ? <Facts text={text} /> : null}
        </>
      )}

      <StateBlocks c={c} now={now} confirmDel={confirmDel} setConfirmDel={setConfirmDel} />

      {c.mode === "view" && sendLabel ? (
        <div className="acts sa-desk-acts">
          <SplitApprove version={s.currentVersion} disabled={c.locked || c.busy} onSend={() => c.approve()} onSchedule={() => c.setMode("pick")} kbd="A" />
          <button className="btn" type="button" disabled={c.locked || c.busy || isGithubBatch} onClick={() => c.setMode("edit")}>
            <IcPencil />
            Editar<span className="kbd">E</span>
          </button>
          <button className="btn" type="button" disabled={c.busy} onClick={c.deny}>
            Denegar<span className="kbd">D</span>
          </button>
          {onSkip ? (
            <button className="btn sa-skip" type="button" onClick={onSkip}>
              Saltar por ahora<span className="kbd">S</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {c.mode === "view" && sendLabel ? (
        <div className="sa-ph-acts sa-phone-only">
          <button className="btn" type="button" disabled={c.locked || c.busy || isGithubBatch} onClick={() => c.setMode("edit")}>
            <IcPencil />
            Editar
          </button>
          <button className="btn" type="button" disabled={c.busy} onClick={c.deny}>
            Denegar
          </button>
        </div>
      ) : null}
      {c.rewritePending && s.status === "pending" ? <p className="sa-why-line">Mientras reescribe no se puede aprobar: saldría un texto que no estás viendo.</p> : null}

      <div className="meta">
        <span>{metaLine(s)}</span>
        {s.isSample ? <span>Datos de muestra.</span> : null}
      </div>
    </div>
  );

  const chat = (
    <RefineChat
      s={s}
      chips={chips}
      marks={marks}
      onClearMarks={() => setMarks([])}
      locked={s.status !== "pending"}
      openTurnId={c.openTurnId}
      onSend={sendTurn}
      onCancelTurn={c.cancelTurn}
      onEdit={() => c.setMode("edit")}
      onPickVersion={(n) => c.select(n)}
      composer={s.status === "pending"}
    />
  );
  const memory = <MemoryPanel s={s} text={text} now={now} onHighlight={setHl} />;

  return (
    <article className={cx("sa-card chat", c.locked && "is-locked")} aria-label={s.title} ref={pressRef}>
      {left}
      <div className="sa-side split">
        <div className="sa-half">
          {histOpen ? <History s={s} /> : null}
          {chat}
        </div>
        <div className="sa-half sa-desk-only">{memory}</div>
      </div>
      <div className="sa-phone-only sa-memsheet">
        <button type="button" className="btn sm" onClick={() => setMemSheet(true)}>
          <IcEngram />
          Memoria · engram
        </button>
      </div>
      <Sheet open={memSheet} onClose={() => setMemSheet(false)} title="Memoria · engram">
        {memory}
      </Sheet>
      {s.status === "pending" && c.mode === "view" ? (
        <div className="sa-dock sa-phone-only">
          <Composer
            phone
            chips={chips}
            marks={marks}
            onClearMarks={() => setMarks([])}
            disabled={c.locked || c.busy}
            placeholder={c.openTurnId ? `Espera a v${pendingN} o cancela el cambio` : "Pídele un cambio a Claude…"}
            onSend={sendTurn}
          />
          <SplitApprove phone up version={s.currentVersion} disabled={c.locked || c.busy} onSend={() => c.approve()} onSchedule={() => c.setMode("pick")} />
        </div>
      ) : null}
    </article>
  );
}

function metaLine(s: SalidaView): string {
  const first = s.versions[0];
  const last = s.versions[s.versions.length - 1];
  const parts = [first ? `Claude · v1 ${hhmm(first.createdAt)}` : "Claude"];
  if (last && last.n > 1) parts.push(`v${last.n} ${hhmm(last.createdAt)}`);
  if (s.ticket) parts.push(`ticket ${s.ticket.ref}`);
  if (s.expiresAt && s.status === "pending") parts.push(`caduca ${hhmm(s.expiresAt)}`);
  return parts.join(" · ");
}

/** The exact text: semáforo block, or the batched GitHub review comments. */
export function ExactBlock({ s, text, marks, setMarks, highlight }: { s: SalidaDetail; text: string; marks: Mark[]; setMarks?: (m: Mark[]) => void; highlight?: string | null }) {
  const d = s.destination;
  if (d.kind === "github_review") {
    const comments = d.comments ?? [];
    return (
      <div className="sa-gh">
        {text ? <SemaforoText text={text} source={s.source} marks={marks} onMarks={comments.length ? undefined : setMarks} highlight={highlight} /> : null}
        {!text && !comments.length ? <div className="msg src-github sa-empty">Aprobación sin comentario</div> : null}
        {comments.map((cm, i) => (
          <div key={i} className="msg src-github sa-ghc">
            <span className="sa-ghat">{cm.path ? `${cm.path}${cm.line ? `:${cm.line}` : ""}` : "Conversación del PR"}</span>
            {cm.body}
          </div>
        ))}
      </div>
    );
  }
  return <SemaforoText text={text} source={s.source} marks={marks} onMarks={setMarks} locked={!setMarks} highlight={highlight} className={s.status === "sent" || s.status === "denied" || s.status === "expired" || s.status === "deleted" ? "sent" : undefined} />;
}

function MarkOutcome({ o }: { o: ReturnType<typeof markOutcome> }) {
  return (
    <div className="sm-check">
      {o.keep.total ? (
        <div>
          <b>
            {o.keep.held} de {o.keep.total}
          </b>
          <span>&nbsp;se mantuvieron idénticas; la marca sigue puesta.</span>
        </div>
      ) : null}
      {o.redo.total ? (
        <div>
          <b>{o.redo.changed.length}</b>
          <span>&nbsp;reformuladas{o.redo.changed.length ? `: ${o.redo.changed.map((t) => `«${t}»`).join(", ")}` : ""}.</span>
        </div>
      ) : null}
      {o.drop.total ? (
        <div>
          <b>{o.drop.gone.length}</b>
          <span>&nbsp;quitadas{o.drop.gone.length ? `: ${o.drop.gone.map((t) => `«${t}»`).join(", ")} ya no está` : ""}.</span>
        </div>
      ) : null}
    </div>
  );
}

function EditBox({ c, text }: { c: SalidaController<SalidaView>; text: string }) {
  const [draft, setDraft] = useState(text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const changed = draft.trim() !== text.trim() && draft.trim().length > 0;
  return (
    <>
      <div className="k">Tu versión</div>
      <textarea
        ref={ref}
        className="sa-edit"
        value={draft}
        aria-label="Tu versión del texto"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") c.setMode("view");
        }}
      />
      {changed ? (
        <div className="sa-diff" aria-label="Cambios">
          <Diff a={text} b={draft} />
        </div>
      ) : null}
      <div className="acts">
        <SplitApprove version={c.s.versions.length + 1} label="Aprobar y enviar mi versión" disabled={!changed || c.busy} onSend={() => c.approveText(draft)} onSchedule={async () => (await c.saveText(draft)) && c.setMode("pick")} />
        <button className="btn" type="button" disabled={!changed || c.busy} onClick={() => c.saveText(draft)}>
          Guardar sin enviar
        </button>
        <button className="btn" type="button" onClick={() => c.setMode("view")}>
          Descartar cambios
        </button>
      </div>
      <div className="sa-legend">Edición manual sobre v{c.s.currentVersion} · se envía tu versión</div>
    </>
  );
}


/** Banners for every non-pending state, plus the scheduler. */
export function StateBlocks({
  c,
  now,
  confirmDel,
  setConfirmDel,
  compact,
}: {
  c: SalidaController<SalidaDetail>;
  now: number;
  confirmDel: boolean;
  setConfirmDel: (b: boolean) => void;
  compact?: boolean;
}) {
  const { s } = c;
  if (c.mode === "pick") return <SchedulePicker now={now} onPick={(at) => c.schedule(at)} onCancel={() => c.setMode("view")} />;
  switch (s.status) {
    case "pending":
      return (
        <>
          {c.undone ? <Banner tone="undone" title="Deshecho · no salió nada" text={`Vuelve a pendiente con v${s.currentVersion} intacta.`} /> : null}
          {s.error ? <Alert>{`Volvió a pendiente: ${s.error}. Revísala antes de firmar otra vez.`}</Alert> : null}
        </>
      );
    case "sending":
      return undoOpen(s, now) ? (
        <SendingBanner s={s} now={now} onUndo={() => c.undo()} />
      ) : (
        <Banner tone="send" title="Enviando…" text="La sesión de Claude lo publica ahora; aquí verás el enlace cuando confirme." />
      );
    case "scheduled":
      return <ScheduledBanner s={s} now={now} onChange={() => c.reschedule()} onCancel={() => c.unschedule()} />;
    case "queued_until_back":
      return (
        <Banner tone="queued" title={`Aprobar al volver · sale cuando vuelva ${sourceLabel(s.source)}`} text={s.error ? `Firmada v${s.approvedVersion ?? s.currentVersion}. ${s.error}` : `Firmada v${s.approvedVersion ?? s.currentVersion}. Antes de enviar, Claude relee el hilo por si cambió.`}>
          <div className="sx-del">
            <button className="btn" type="button" disabled={c.busy} onClick={() => c.unqueue()}>
              Sacar de la cola
            </button>
          </div>
        </Banner>
      );
    case "sent":
    case "deleted":
      return <SentBlock s={s} confirming={confirmDel} setConfirming={setConfirmDel} onDelete={() => c.requestDelete()} onRestore={() => c.requestRestore()} />;
    case "failed":
      return (
        <>
          <Alert>
            <b>No se envió.</b> {s.error ?? "La fuente rechazó el mensaje."}
          </Alert>
          <div className="acts">
            <button className="btn p" type="button" disabled={c.busy} onClick={() => c.retry()}>
              <IcRetry />
              Reintentar
            </button>
            <button className="btn" type="button" onClick={() => navigator.clipboard?.writeText(s.versions.find((v) => v.n === (s.approvedVersion ?? s.currentVersion))?.body ?? "").catch(() => {})}>
              <IcCopy />
              Copiar texto
            </button>
          </div>
        </>
      );
    case "denied":
      return compact ? <div className="sa-status"><b>Denegada.</b>&nbsp;Claude no la enviará.</div> : <div className="sa-status"><span><b>Denegaste esta salida{s.updatedAt ? ` · ${hhmm(s.updatedAt)}` : ""}.</b> Claude no la enviará.</span></div>;
    case "expired":
      return (
        <div className="sa-status">
          <span>
            <b>Caducó{s.expiresAt ? ` a las ${hhmm(s.expiresAt)}` : ""}.</b> Nunca se envió; pídele a Claude que la rehaga desde el ticket.
          </span>
        </div>
      );
    default:
      return null;
  }
}
