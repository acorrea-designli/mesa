"use client";
// Building blocks of a salida: route, version stepper and list, diff line, undo
// track, state banners, scheduler. Used by the Salidas B card and <SalidaApproval>.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Destination, SalidaDetail, SalidaTurn, SalidaVersion } from "@/lib/domain/types";
import { DELETE_POLICY } from "@/lib/domain/types";
import { isSimulated } from "@/lib/domain/sandbox";
import { Chip, srcClass } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/interactive";
import { confirmPick, rise, travel } from "@/lib/motion";
import { COPY_TOAST, copyExactText } from "./copy";
import { IcCheck, IcClock, IcCopy, IcExternal, IcStar, IcUndo } from "./icons";
import { age, comparedWith, conversationHref, destinationLinkLabel, destShort, hhmm, mentionCount, routeStops, scheduleChoices, secondsElapsed, secondsLeft, shownText, stepperItems, UNDO_SECONDS, whenLabel, wordDiff } from "./model";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- destination ----------

export function Route({ d, source }: { d: Destination; source: SalidaDetail["source"] }) {
  const stops = routeStops(d);
  const color = source === "slack" ? "var(--sl)" : source === "basecamp" ? "var(--bc)" : "var(--gh)";
  return (
    <div className="sa-route" style={{ ["--route" as string]: color }}>
      {stops.map((s) => (
        <div key={s.label} className="sa-stop">
          <span>{s.label}</span>
          <b>
            {s.value}
            {s.note ? <small>{s.note}</small> : null}
          </b>
        </div>
      ))}
    </div>
  );
}

/** "Abrir destino": where the salida will be published (the permalink once sent). Nothing when the URL cannot be known. */
export function DestLink({ d, url }: { d: Destination; url: string | null | undefined }) {
  if (!url) return null;
  return (
    <a className="sa-destlink" href={url} target="_blank" rel="noopener noreferrer" aria-label={destinationLinkLabel(d)}>
      Abrir destino
      <IcExternal />
    </a>
  );
}

/** Compact destination for narrow panes: chips in the source colour. */
export function DestChips({ d, source }: { d: Destination; source: SalidaDetail["source"] }) {
  const stops = routeStops(d).filter((s) => !/Publica como|Como|Workspace/.test(s.label));
  return (
    <div className="dest">
      {stops.map((s) => (
        <Chip key={s.label} source={source}>
          {s.value}
        </Chip>
      ))}
    </div>
  );
}

/** Compact route for the phone: line · channel › thread › as. */
export function PhoneRoute({ d, source }: { d: Destination; source: SalidaDetail["source"] }) {
  const parts = routeStops(d)
    .filter((s) => s.label !== "Workspace")
    .map((s) => (s.label === "Publica como" ? `como ${s.value.replace(/ \(tú\)$/, "")}` : s.value));
  return (
    <div className={cx("pp-route", srcClass(source))}>
      <span className="ln" style={{ background: "var(--c)" }} />
      {parts.map((p, i) => (
        <span key={i}>
          {i ? <span className="sep">› </span> : null}
          {p}
        </span>
      ))}
    </div>
  );
}

// ---------- Slack: send mode and quick buttons ----------

/** A Slack salida: what "Aprobar" does (a draft Andrés sends) and the second button, with its cost said next to it. */
export function SlackModes({ onDirect, disabled, phone }: { onDirect: () => void; disabled?: boolean; phone?: boolean }) {
  return (
    <div className={cx("sa-modes", phone && "phone")}>
      <button type="button" className="btn" disabled={disabled} onClick={onDirect}>
        Aprobar y que Claude lo envíe
      </button>
      <span className="sa-modenote">
        <b>Sale con «Sent using @Claude».</b> Aprobar deja el texto como borrador en tu Slack y lo envías tú; si ya escribes algo en ese canal, el borrador puede reemplazarlo.
      </span>
    </div>
  );
}

/** Select the visible text of the card the buttons live in, so Andrés can copy it by hand when the clipboard is unavailable. */
function selectCardText(from: HTMLElement | null): boolean {
  const el = from?.closest(".sa-card, .sa-apv")?.querySelector(".msg");
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!el || !sel) return false;
  const r = document.createRange();
  r.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}

/**
 * "Copiar" and "Abrir conversación" on a Slack salida. Copiar puts exactly the text shown (the approved version once approved) on the
 * clipboard and says so in a toast, falling back to selecting the text; Abrir conversación opens the Slack app (slack:// deep link)
 * or, without a team id, the https link. Both are plain buttons/links: they work the same on the phone.
 */
export function SlackQuick({ s }: { s: SalidaDetail }) {
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);
  const href = conversationHref(s.conversation);
  const copy = async () => {
    const r = await copyExactText(shownText(s), {
      clipboard: typeof navigator !== "undefined" ? navigator.clipboard : null,
      select: () => selectCardText(root.current),
    });
    toast({ text: COPY_TOAST[r] });
  };
  return (
    <div className="sa-quick" ref={root}>
      <button type="button" className="btn sm" onClick={copy}>
        <IcCopy />
        Copiar
      </button>
      {href ? (
        <a className="btn sm" href={href} {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})} aria-label={`Abrir conversación: ${destShort(s.destination)}`}>
          Abrir conversación
          <IcExternal />
        </a>
      ) : (
        <>
          <button type="button" className="btn sm" disabled aria-disabled="true" aria-describedby={`conv-${s.id}`}>
            Abrir conversación
          </button>
          <span className="sx-why" id={`conv-${s.id}`}>
            Falta MESA_SLACK_TEAM_ID o MESA_SLACK_DOMAIN en .env.local
          </span>
        </>
      )}
    </div>
  );
}

/** Slack, mode draft, drafted: the text waits in Andrés's Slack until he sends it and presses "Ya lo envié". */
export function DraftBlock({ s, busy, onSent }: { s: SalidaDetail; busy: boolean; onSent: () => void }) {
  const simulated = isSimulated(s);
  return (
    <Banner
      tone="draft"
      title="Borrador en Slack · envíalo tú"
      text={
        simulated
          ? `Simulado · no salió. Sandbox: Claude marcó el borrador sin crear nada en Slack (${destShort(s.destination)}).`
          : `Está en tu Slack, en ${destShort(s.destination)}${s.draftedAt ? ` · desde las ${hhmm(s.draftedAt)}` : ""}. Ábrelo, revisa y dale enviar; sale como mensaje tuyo.`
      }
    >
      <div className="sx-del">
        <button className="btn p" type="button" disabled={busy} onClick={onSent}>
          <IcCheck />
          Ya lo envié
        </button>
        <span className="sx-why">Márcalo cuando lo hayas enviado; Mesa no ve tu Slack.</span>
      </div>
    </Banner>
  );
}

// ---------- versions ----------

export interface StepperProps {
  s: SalidaDetail;
  pendingN: number | null;
  locked: boolean;
  onSelect: (n: number) => void;
  listOpen: boolean;
  onToggleList: () => void;
}

export function VersionStepper({ s, pendingN, locked, onSelect, listOpen, onToggleList }: StepperProps) {
  const total = s.versions.length;
  const cur = s.currentVersion;
  const cmp = comparedWith(total, cur);
  const starred = s.versions.filter((v) => v.starred).map((v) => v.n);
  const items = stepperItems(total, { current: cur, compared: cmp, starred });
  if (total <= 1 && !pendingN) return null;
  return (
    <div className="sa-ver">
      <div className={cx("sa-steps", srcClass(s.source))} role="group" aria-label={`Versiones (${total})`}>
        {items.map((it) =>
          it.type === "gap" ? (
            <button
              key={`g${it.from}`}
              type="button"
              className="gap"
              aria-expanded={listOpen}
              aria-label={`Ver v${it.from} a v${it.to}`}
              onClick={onToggleList}
            >
              …
            </button>
          ) : (
            <button
              key={it.n}
              type="button"
              className={cx(it.n === cmp && it.n !== cur && "cmp", starred.includes(it.n) && "star")}
              aria-current={it.n === cur ? "true" : undefined}
              aria-label={`v${it.n}${starred.includes(it.n) ? ", marcada" : ""}${it.n === cur ? ", la que se envía" : it.n === cmp ? ", comparada" : ""}`}
              disabled={locked && it.n !== cur}
              onClick={(e) => {
                if (it.n === cur) return;
                confirmPick(e.currentTarget);
                onSelect(it.n);
              }}
            >
              {starred.includes(it.n) ? <IcStar on /> : null}v{it.n}
            </button>
          ),
        )}
        {pendingN ? (
          <button type="button" className="pend" aria-disabled="true" disabled>
            v{pendingN}
          </button>
        ) : null}
      </div>
      <span className="sa-cmp">
        <b>v{cur}</b> de {total}
        {listOpen ? " · elige dos para comparar" : cmp ? ` · comparando con v${cmp}` : ""}
      </span>
    </div>
  );
}

/** The turn that produced a version, as one line for the list. */
export function versionOrigin(v: SalidaVersion, turns: SalidaTurn[]): string {
  if (v.author === "andres") return "tu versión (a mano)";
  if (v.n === 1) return "Primer borrador";
  const t = v.turnId ? turns.find((x) => x.id === v.turnId) : undefined;
  if (!t) return "Claude";
  if (t.body) return t.body;
  return t.marks.length ? `con ${t.marks.length} marcas` : (t.chipLabel ?? "Claude");
}

export function VersionList({
  s,
  now,
  locked,
  onStar,
  onBack,
  onClose,
}: {
  s: SalidaDetail;
  now: number;
  locked: boolean;
  onStar: (n: number, on: boolean) => void;
  onBack: (n: number) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<number[]>(() => [comparedWith(s.versions.length, s.currentVersion) ?? 1, s.currentVersion].filter((n, i, a) => a.indexOf(n) === i));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) rise(ref.current);
  }, []);
  const toggle = (n: number) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p.slice(-1), n]));
  const [a, b] = [...picked].sort((x, y) => x - y);
  const va = s.versions.find((v) => v.n === a);
  const vb = s.versions.find((v) => v.n === b);
  const back = picked.find((n) => n !== s.currentVersion);
  return (
    <>
      <div ref={ref} className="sa-vlist" role="dialog" aria-label="Versiones">
        <div className="sa-vhead">
          <span>{s.versions.length} versiones · marca dos para comparar</span>
          <span>
            <IcStar on /> me gustaba esta
          </span>
        </div>
        {s.versions.map((v) => (
          <div key={v.n} className={cx("sa-vrow", v.n === s.currentVersion && "cur", picked.includes(v.n) && "pick")}>
            <input type="checkbox" checked={picked.includes(v.n)} onChange={() => toggle(v.n)} aria-label={`Comparar v${v.n}`} />
            <b>v{v.n}</b>
            <button type="button" className="sa-starbtn" aria-pressed={v.starred} aria-label={v.starred ? `Quitar estrella de v${v.n}` : `Marcar v${v.n}: me gustaba esta`} onClick={() => onStar(v.n, !v.starred)}>
              <IcStar on={v.starred} />
            </button>
            <span>{versionOrigin(v, s.turns)}</span>
            <time>{age(v.createdAt, now)}</time>
          </div>
        ))}
      </div>
      {va && vb ? (
        <div className="sa-cmpbox">
          <div className="k">
            Comparando v{a} y v{b}
          </div>
          <p>
            <Diff a={va.body} b={vb.body} />
          </p>
          <div className="acts">
            {back && !locked ? (
              <button type="button" className="btn sm p" onClick={() => onBack(back)}>
                <IcUndo />
                Volver a v{back}
              </button>
            ) : null}
            <button type="button" className="btn sm" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function Diff({ a, b }: { a: string; b: string }) {
  const d = useMemo(() => wordDiff(a, b), [a, b]);
  return (
    <>
      {d.map((o, i) => (o.op === "eq" ? <span key={i}>{o.text}</span> : o.op === "del" ? <del key={i}>{o.text}</del> : <ins key={i}>{o.text}</ins>))}
    </>
  );
}

/** One-line diff vs the compared version. */
export function DiffLine({ s }: { s: SalidaDetail }) {
  const cmp = comparedWith(s.versions.length, s.currentVersion);
  const prev = s.versions.find((v) => v.n === cmp);
  const cur = s.versions.find((v) => v.n === s.currentVersion);
  if (!prev || !cur || prev.body === cur.body) return null;
  return (
    <div className="sa-dif2" aria-label={`Cambios respecto a v${cmp}`}>
      <Diff a={prev.body} b={cur.body} />
    </div>
  );
}

// ---------- facts ----------

export function Facts({ text, destination }: { text: string; destination: Destination }) {
  const mentions = mentionCount(destination, text);
  return (
    <div className="sa-facts">
      <span>{text.length} caracteres</span>
      <span>{mentions ? `${mentions} ${mentions === 1 ? "mención" : "menciones"}` : "Sin menciones"}</span>
    </div>
  );
}

// ---------- undo window ----------

/** The tick travels the source line to the destination station over the 20 s. */
export function UndoTrack({ undoUntil, now, source }: { undoUntil: string | null; now: number; source: SalidaDetail["source"] }) {
  const tick = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const startAt = useRef(now);
  useEffect(() => {
    if (!tick.current || !track.current) return;
    return travel(tick.current, track.current, UNDO_SECONDS, secondsElapsed(undoUntil, startAt.current));
  }, [undoUntil]);
  return (
    <span ref={track} className={cx("sx-track", srcClass(source))} aria-hidden="true">
      <span className="sx-rail" />
      <span className="sx-from" />
      <span className="sx-end" />
      <span ref={tick} className="sx-tk" />
    </span>
  );
}

export function SendingBanner({ s, now, onUndo }: { s: SalidaDetail; now: number; onUndo: () => void }) {
  const left = secondsLeft(s.undoUntil, now);
  const slack = DELETE_POLICY[s.destination.kind] === "none";
  const draft = s.source === "slack" && s.sendMode !== "send";
  return (
    <div className="sa-sx send" role="status">
      <UndoTrack undoUntil={s.undoUntil} now={now} source={s.source} />
      <div className="sx-tx">
        <b>
          {draft ? "Borrador en " : "Enviando en "}
          <span data-n>{left}</span> s
        </b>
        <span>
          a {destShort(s.destination)}
          {draft ? " · queda en tu Slack y lo envías tú" : s.source === "slack" ? " · sale con «Sent using @Claude»" : ""}
          {slack ? (s.source === "slack" ? " · después Slack no deja borrarlo desde Mesa" : " · después no se puede borrar desde Mesa") : ""}
        </span>
      </div>
      <button className="btn" type="button" onClick={onUndo}>
        Deshacer
      </button>
    </div>
  );
}

export function Banner({ tone, title, text, children, icon }: { tone?: string; title: React.ReactNode; text?: React.ReactNode; children?: React.ReactNode; icon?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) rise(ref.current);
  }, []);
  return (
    <div ref={ref} className={cx("sa-sx", tone)} role="status">
      <div className="sx-tx">
        <b>
          {icon}
          {title}
        </b>
        {text ? <span>{text}</span> : null}
      </div>
      {children}
    </div>
  );
}

// ---------- sent: permalink + delete per destination ----------

const OPEN_IN: Record<string, string> = { slack: "Abrir en Slack", basecamp: "Abrir en Basecamp", github: "Abrir en GitHub" };

export function SentBlock({
  s,
  onDelete,
  onRestore,
  confirming,
  setConfirming,
}: {
  s: SalidaDetail;
  onDelete: () => void;
  onRestore: () => void;
  confirming: boolean;
  setConfirming: (b: boolean) => void;
}) {
  const policy = DELETE_POLICY[s.destination.kind];
  const campfire = s.destination.kind === "basecamp_campfire";
  const openLabel = campfire ? "Abrir el Campfire" : OPEN_IN[s.source];
  const copy = () => s.permalink && navigator.clipboard?.writeText(s.permalink).catch(() => {});
  if (s.status === "deleted")
    return policy === "trash" ? (
      <Banner tone="gone" title={`Eliminado · en la papelera de ${s.source === "basecamp" ? "Basecamp" : "la fuente"}`} text={s.deletedAt ? `Recuperable hasta el ${restoreUntil(s.deletedAt)}.` : undefined}>
        <div className="sx-del">
          <button className="btn" type="button" onClick={onRestore}>
            Restaurar
          </button>
        </div>
      </Banner>
    ) : (
      <Banner tone="gone" title={campfire ? "Eliminado del Campfire" : "Eliminado"} text="Borrado permanente; no hay copia que restaurar." />
    );
  if (confirming)
    return (
      <Banner
        tone="confirm"
        title={campfire ? "¿Eliminar la línea del Campfire?" : policy === "trash" ? "¿Eliminar el comentario?" : "¿Eliminar el comentario de GitHub?"}
        text={policy === "trash" ? "Se mueve a la papelera de Basecamp · recuperable 25 días" : "Es permanente: no se puede recuperar."}
      >
        <div className="sx-del">
          <button className="btn p" type="button" onClick={() => (setConfirming(false), onDelete())}>
            {policy === "trash" ? "Mover a la papelera" : "Eliminar para siempre"}
          </button>
          <button className="btn" type="button" onClick={() => setConfirming(false)}>
            Cancelar
          </button>
        </div>
      </Banner>
    );
  const whyId = `why-${s.id}`;
  // Sandbox: the lead reported the send as simulated; there is no real message and no link to open.
  const simulated = isSimulated(s);
  const permalink = simulated ? null : s.permalink;
  return (
    <Banner
      tone="done"
      icon={<IcCheck />}
      title={simulated ? `Simulado · no salió · ${destShort(s.destination)} · ${hhmm(s.sentAt)}` : `Enviada a ${destShort(s.destination)} · ${hhmm(s.sentAt)}`}
      text={simulated ? "Sandbox: Claude marcó el envío sin publicar nada en la fuente." : undefined}
    >
      {permalink ? (
        <div className="sa-perma">
          <span>{permalink.replace(/^https?:\/\//, "")}</span>
          <button className="ico-btn btn sm" type="button" aria-label="Copiar enlace" onClick={copy}>
            <IcCopy />
          </button>
        </div>
      ) : null}
      <div className="sx-del">
        {s.deleteRequestedAt ? (
          <span className="sx-why">Eliminando… la sesión de Claude lo borra en la fuente.</span>
        ) : policy === "none" ? (
          <>
            <button className="btn" type="button" disabled aria-disabled="true" aria-describedby={whyId}>
              Eliminar
            </button>
            {permalink ? (
              <a className="btn sm" href={permalink} target="_blank" rel="noreferrer">
                {openLabel} <IcExternal />
              </a>
            ) : null}
            <span className="sx-why" id={whyId}>
              {s.source === "slack" ? "Slack no permite borrar desde Mesa todavía · ábrelo en Slack" : "Una revisión enviada no se puede borrar · ábrela en GitHub"}
            </span>
          </>
        ) : (
          <>
            <button className="btn" type="button" onClick={() => setConfirming(true)}>
              {campfire || s.source === "github" ? "Eliminar" : "Eliminar mensaje"}
            </button>
            {permalink ? (
              <a className="btn sm" href={permalink} target="_blank" rel="noreferrer">
                {openLabel} <IcExternal />
              </a>
            ) : null}
          </>
        )}
      </div>
    </Banner>
  );
}

function restoreUntil(iso: string) {
  const d = new Date(Date.parse(iso) + 25 * 86400_000);
  return `${d.getDate()} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][d.getMonth()]}`;
}

// ---------- scheduler ----------

export function SchedulePicker({ now, onPick, onCancel }: { now: number; onPick: (iso: string) => void; onCancel: () => void }) {
  const choices = useMemo(() => scheduleChoices(new Date(now)), [now]);
  const [custom, setCustom] = useState("");
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <Banner tone="pick" icon={<IcClock />} title="¿Cuándo sale?" text="Queda firmada y sale sola a esa hora; hasta entonces puedes cambiarla o cancelarla.">
      <div className="sx-del">
        {choices.map((c, i) => (
          <button key={c.at} ref={i === 0 ? first : undefined} className="btn sm" type="button" onClick={() => onPick(c.at)}>
            {c.label}
          </button>
        ))}
        <label className="sa-custom">
          <span className="sr-only">Otra hora</span>
          <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />
        </label>
        <button className="btn sm" type="button" disabled={!custom} onClick={() => custom && onPick(new Date(custom).toISOString())}>
          Programar
        </button>
        <button className="btn sm" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </Banner>
  );
}

export function ScheduledBanner({ s, now, onChange, onCancel }: { s: SalidaDetail; now: number; onChange: () => void; onCancel: () => void }) {
  return (
    <Banner tone="sched" icon={<IcClock />} title={`Sale ${s.sendAt ? whenLabel(s.sendAt, new Date(now)) : ""}`} text={`a ${destShort(s.destination)} · firmada; al salir tendrá sus 20 s de Deshacer`}>
      <div className="sx-del">
        <button className="btn" type="button" onClick={onChange}>
          Cambiar
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </Banner>
  );
}
