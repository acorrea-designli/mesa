"use client";
// Right column of the Salidas B card: origin strip + ticket history, the
// "Afinar con Claude" refine chat with learned chips, and the engram memory panel.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LearnedChip, Mark, SalidaDetail } from "@/lib/domain/types";
import { srcClass } from "@/components/ui/primitives";
import { arrive } from "@/lib/motion";
import { searchEngram } from "./api";
import { IcChevRight, IcStub } from "./icons";
import { MARK_LABEL } from "./marks";
import { ago, hhmm } from "./model";
import { MarksChip } from "./Semaforo";
import { cx } from "./parts";
import type { EngramObservation, EngramSearch, HistoryEvent, SalidaView } from "./types";

// ---------- origin strip ----------

export function OriginStrip({ s, histOpen, onToggle }: { s: SalidaView; histOpen: boolean; onToggle: () => void }) {
  if (!s.ticket && !s.links.length) return null;
  return (
    <div className="sa-orig">
      <span className="lbl">Origen</span>
      {s.ticket ? (
        <Link className="chip src-claude sa-tk" href={`/tickets?t=${s.ticket.ref}`}>
          Ticket {s.ticket.ref} · {s.ticket.title}
        </Link>
      ) : null}
      {s.links.length ? (
        <span className="sa-srcs">
          <span className="mark" aria-hidden="true">
            {s.links.map((l, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
                {i ? <span className="ring" /> : null}
                <span className={cx("ln", srcClass(l.source))} style={{ width: 12, background: "var(--c)" }} />
              </span>
            ))}
          </span>
          {s.links.map((l, i) =>
            l.url ? (
              <a key={i} className={cx("chip", srcClass(l.source))} href={l.url} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            ) : (
              <span key={i} className={cx("chip", srcClass(l.source))}>
                {l.label}
              </span>
            ),
          )}
        </span>
      ) : null}
      {s.history.length ? (
        <button type="button" className="sa-hbtn" aria-expanded={histOpen} onClick={onToggle}>
          <IcChevRight className="sa-chev" />
          Historial<b>{s.history.length}</b>
        </button>
      ) : null}
    </div>
  );
}

// ---------- history ----------

const SHOW_LAST = 6;

export function History({ s }: { s: SalidaView }) {
  const [all, setAll] = useState(false);
  const ev = s.history;
  const hidden = all ? 0 : Math.max(0, ev.length - SHOW_LAST);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) arrive(ref.current.querySelectorAll(".sa-hs"));
  }, []);
  if (!ev.length) return null;
  return (
    <div className="sa-hist" ref={ref}>
      <div className="k" style={{ marginTop: 0 }}>
        Historial del ticket {s.ticket?.ref}
      </div>
      <div className="sa-tl">
        {hidden ? (
          <button type="button" className="sa-older" onClick={() => setAll(true)}>
            +{hidden} anteriores
          </button>
        ) : null}
        {ev.slice(hidden).map((e, i) => (
          <HistoryStation key={i} e={e} />
        ))}
      </div>
    </div>
  );
}

function HistoryStation({ e }: { e: HistoryEvent }) {
  const link = e.link ? (
    e.href ? (
      <a className="lk" href={e.href} target={e.href.startsWith("/") ? undefined : "_blank"} rel="noreferrer" onClick={(x) => x.stopPropagation()}>
        {e.link}
      </a>
    ) : (
      <span className="lk">{e.link}</span>
    )
  ) : (
    <span />
  );
  const style = { ["--c" as string]: `var(--${e.source === "github" ? "gh" : e.source === "slack" ? "sl" : e.source === "basecamp" ? "bc" : "cl"})` };
  if (!e.evidence || e.now)
    return (
      <div className={cx("sa-hs", e.now && "now")} style={style}>
        <div className="sum">
          <span className="t">{hhmm(e.at)}</span>
          <span className="tx">{e.text}</span>
          {link}
          <span />
        </div>
      </div>
    );
  return (
    <details className="sa-hs" style={style}>
      <summary>
        <span className="t">{hhmm(e.at)}</span>
        <span className="tx">{e.text}</span>
        {link}
        <IcChevRight className="sa-chev" />
      </summary>
      <div className="sa-ev">{e.evidence}</div>
    </details>
  );
}

// ---------- refine chat ----------

interface ChatProps {
  s: SalidaDetail;
  chips: LearnedChip[];
  marks: Mark[];
  onClearMarks: () => void;
  locked: boolean;
  openTurnId: string | null;
  onSend: (body: string, chip?: string) => void;
  onCancelTurn: () => void;
  onEdit: () => void;
  onPickVersion: (n: number) => void;
  /** Phone dock renders the composer itself. */
  composer?: boolean;
}

/** Turns fold into "N vueltas anteriores · ver"; the last two rounds stay open. */
const OPEN_TURNS = 4;

export function RefineChat({ s, chips, marks, onClearMarks, locked, openTurnId, onSend, onCancelTurn, onEdit, onPickVersion, composer = true }: ChatProps) {
  const [unfold, setUnfold] = useState(false);
  const turns = s.turns.filter((t) => t.state !== "cancelled");
  const hiddenTurns = unfold ? [] : turns.slice(0, Math.max(0, turns.length - OPEN_TURNS));
  const shown = turns.slice(hiddenTurns.length);
  const folded = hiddenTurns.filter((t) => t.author === "andres").length;
  const pendingN = openTurnId ? s.versions.length + 1 : null;
  const last = s.versions.length;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) arrive(ref.current.querySelectorAll(".sa-turn"));
  }, [turns.length]);
  return (
    <div className="sa-chat" ref={ref}>
      <div className="k" style={{ marginTop: 0 }}>
        Afinar con Claude
      </div>
      {!turns.length && composer ? <p className="sa-q0">Aún no le has pedido cambios a esta salida.</p> : null}
      <div className="sa-turns">
        {folded ? (
          <button type="button" className="sa-fold" onClick={() => setUnfold(true)}>
            <span className="ln src-claude" style={{ background: "var(--c)" }} />
            {folded} {folded === 1 ? "vuelta anterior" : "vueltas anteriores"} · <u>ver</u>
          </button>
        ) : null}
        {turns.length && !hiddenTurns.length ? (
          <div className="sa-turn">
            <span className="sa-who">
              <span className="ln src-claude" style={{ background: "var(--c)" }} />
              Claude
            </span>
            <p>
              Primer borrador.
              <VTag n={1} s={s} onPick={onPickVersion} />
            </p>
          </div>
        ) : null}
        {shown.map((t) =>
          t.author === "andres" ? (
            <div key={t.id} className="sa-turn me">
              <span className="sa-who">Tú</span>
              <p>
                {t.body || (t.marks.length ? "Con marcas" : "")}
                {t.marks.length ? <small className="sm-sent">{marksSummary(t.marks)}</small> : null}
              </p>
            </div>
          ) : (
            <div key={t.id} className="sa-turn">
              <span className="sa-who">
                <span className="ln src-claude" style={{ background: "var(--c)" }} />
                Claude
              </span>
              <p>
                {t.onVersion ? "Lista." : t.body}
                {t.onVersion ? <VTag n={t.onVersion} s={s} onPick={onPickVersion} /> : null}
              </p>
            </div>
          ),
        )}
        {s.versions
          .filter((v) => v.author === "andres")
          .slice(-1)
          .map((v) => (
            <div key={v.id} className="sa-sys">
              Editaste a mano · v{v.n} {hhmm(v.createdAt)}
            </div>
          ))}
        {s.currentVersion < last && !openTurnId ? (
          <div className="sa-sys">
            Volviste a v{s.currentVersion}. v{s.currentVersion + 1} a v{last} siguen en la lista.
          </div>
        ) : null}
        {openTurnId ? (
          <div className="sa-turn">
            <span className="sa-who">
              <span className="ln src-claude" style={{ background: "var(--c)" }} />
              Claude
            </span>
            <p className="sa-pend">
              <PendTrack />
              Claude reescribiendo… v{pendingN}
              <button type="button" className="btn sm" style={{ marginLeft: "auto" }} onClick={onCancelTurn}>
                Cancelar el cambio
              </button>
            </p>
          </div>
        ) : null}
      </div>
      {composer ? (
        <Composer
          chips={chips}
          marks={marks}
          onClearMarks={onClearMarks}
          disabled={locked || Boolean(openTurnId)}
          placeholder={openTurnId ? `Espera a v${pendingN} o cancela el cambio` : s.currentVersion < last ? `Pídele un cambio sobre v${s.currentVersion}…` : "Pídele un cambio a Claude…"}
          onSend={onSend}
        />
      ) : (
        <p className="sa-q0">{s.status === "scheduled" ? "Programada: cancela la programación para pedir cambios." : "Esta salida ya no admite cambios."}</p>
      )}
      {s.versions.length >= 8 && !locked ? (
        <div className="sa-hint">
          Van {s.versions.length} versiones. ¿Lo escribes tú?{" "}
          <button type="button" className="sa-link" onClick={onEdit}>
            Editar a mano
          </button>
        </div>
      ) : null}
    </div>
  );
}

function VTag({ n, s, onPick }: { n: number; s: SalidaDetail; onPick: (n: number) => void }) {
  return (
    <button type="button" className="sa-vtag" aria-current={s.currentVersion === n ? "true" : undefined} aria-label={`Ver v${n}`} onClick={() => n !== s.currentVersion && onPick(n)}>
      v{n}
    </button>
  );
}

function PendTrack() {
  return (
    <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true">
      <path d="M2 5H26" fill="none" stroke="var(--cl)" strokeWidth="3" strokeLinecap="round" opacity=".35" />
      <circle cx="5" cy="5" r="3.5" fill="var(--cl)" className="lb-travel" />
    </svg>
  );
}

export function marksSummary(marks: Mark[]): string {
  const by = (k: Mark["kind"]) => marks.filter((m) => m.kind === k).map((m) => `«${m.text}»`);
  return (["keep", "redo", "drop"] as const)
    .map((k) => (by(k).length ? `${MARK_LABEL[k]}: ${by(k).join(", ")}` : ""))
    .filter(Boolean)
    .join(" · ");
}

export function Composer({
  chips,
  marks,
  onClearMarks,
  disabled,
  placeholder,
  onSend,
  phone,
}: {
  chips: LearnedChip[];
  marks: Mark[];
  onClearMarks: () => void;
  disabled: boolean;
  placeholder: string;
  onSend: (body: string, chip?: string) => void;
  phone?: boolean;
}) {
  const [text, setText] = useState("");
  const send = () => {
    if (disabled || (!text.trim() && !marks.length)) return;
    onSend(text.trim());
    setText("");
  };
  return (
    <>
      <MarksChip marks={marks} onClear={onClearMarks} />
      <div className={cx(phone ? "pp-in" : "sa-ask", disabled && "is-off")}>
        <input
          aria-label="Pedir un cambio"
          placeholder={placeholder}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className={phone ? "send" : "btn sm"} type="button" disabled={disabled || (!text.trim() && !marks.length)} onClick={send}>
          Enviar
        </button>
      </div>
      {chips.length ? (
        <div className={phone ? "pp-chips" : "sa-qcs"} aria-label="Tus pedidos frecuentes">
          {chips.map((c) => (
            <span key={c.label} className="qc">
              <button
                type="button"
                className={phone ? "pp-chip" : "sa-qc"}
                disabled={disabled}
                title={c.phrasings.length ? `agrupa: ${c.phrasings.slice(0, 2).join(" · ")}` : undefined}
                onClick={() => {
                  onSend(text.trim(), c.label);
                  setText("");
                }}
              >
                {c.label}
              </button>
              {c.phrasings.length && !phone ? (
                <span className="qc-src" aria-hidden="true">
                  agrupa: {c.phrasings.slice(0, 2).join(" · ")}
                </span>
              ) : null}
            </span>
          ))}
        </div>
      ) : (
        <p className="qc-cold">Aquí aparecerán tus pedidos frecuentes</p>
      )}
    </>
  );
}

// ---------- memory · engram ----------

const TYPE_LABEL: Record<string, string> = { decision: "decision", lesson: "lesson", learning: "lesson", process: "process", pattern: "process", board: "board" };
const typeClass = (t: string) => TYPE_LABEL[t] ?? "lesson";

/** A phrase in the draft that an observation supports: a shared distinctive token. */
export function appliesTo(title: string, text: string): string | null {
  const lower = text.toLowerCase();
  const tokens = title.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const strong = tokens.filter((t) => t.length >= 5 || /\d|_/.test(t)).sort((a, b) => b.length - a.length);
  for (const t of strong) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0) {
      // Grow to the neighbouring word when it also appears in the title ("after 2pm").
      const rest = text.slice(0, i).match(/(\p{L}+)\s+$/u);
      const prev = rest?.[1];
      if (prev && title.toLowerCase().includes(prev.toLowerCase()) && prev.length > 2) return text.slice(i - rest[0].length, i + t.length);
      return text.slice(i, i + t.length);
    }
  }
  return null;
}

export function MemoryPanel({
  s,
  text,
  now,
  onHighlight,
}: {
  s: SalidaView;
  text: string;
  now: number;
  onHighlight: (phrase: string | null) => void;
}) {
  const base = s.ticket?.title || s.title;
  const project = s.ticket?.project ?? "";
  const [res, setRes] = useState<EngramSearch | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const load = (query: string) => {
    setLoading(true);
    searchEngram(query, project).then((r) => {
      setRes(r);
      setLoading(false);
    });
  };
  useEffect(() => {
    let live = true;
    searchEngram(base, project).then((r) => {
      if (!live) return;
      setRes(r);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [base, project]);
  const list = useMemo(() => {
    const obs = res?.observations ?? [];
    const f = q.trim().toLowerCase();
    return (f ? obs.filter((o) => o.title.toLowerCase().includes(f) || o.type.includes(f)) : obs).slice(0, 5);
  }, [res, q]);
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (ref.current) arrive(ref.current.querySelectorAll(".mm-row"));
  }, [res]);
  const offline = res?.status === "offline";
  const footer = s.ticket ? `Registrado en engram · ${s.ticket.engramTopic}${s.ticket.engramAt ? ` · ${s.ticket.engramLinked ? "sincronizado" : "último sync"} ${ago(s.ticket.engramAt, now)}` : " · sin sincronizar todavía"}` : "Sin ticket · nada registrado en engram";
  return (
    <div className="mm">
      <div className="mm-h">
        <div className="k" style={{ marginTop: 0 }}>
          Memoria · engram
        </div>
        <span className={cx("mm-st", offline && "off")}>
          <i aria-hidden="true" />
          {loading && !res ? "buscando…" : offline ? "sin conexión" : "conectado"}
        </span>
      </div>
      <form
        className="mm-q"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) load(q.trim());
        }}
      >
        <input type="search" placeholder="Buscar en la memoria" aria-label="Buscar en la memoria" autoComplete="off" value={q} disabled={offline} onChange={(e) => setQ(e.target.value)} />
      </form>
      {offline ? (
        <div className="mm-off">
          <b>Engram no responde</b>
          <span>No se pueden consultar las decisiones de este ticket. Puedes firmar igual; el mensaje no depende de la memoria.</span>
          <button className="btn sm" type="button" onClick={() => load(base)}>
            Reintentar
          </button>
        </div>
      ) : res ? (
        <>
          <div className="mm-sub">{q.trim() ? `Resultados para «${q.trim()}»` : `Relacionadas con «${base}»`}</div>
          {list.length ? (
            <ul className="mm-list" ref={ref}>
              {list.map((o) => (
                <MemoryRow key={String(o.id)} o={o} text={text} now={now} onHighlight={onHighlight} />
              ))}
            </ul>
          ) : (
            <p className="mm-n">
              {q.trim() ? "Sin resultados para esa búsqueda." : "Nada relacionado en la memoria."}
              {q.trim() ? null : <small>Busca a mano o sigue sin contexto; nada bloquea la firma.</small>}
            </p>
          )}
        </>
      ) : null}
      <div className="mm-ft">{footer}</div>
    </div>
  );
}

function MemoryRow({ o, text, now, onHighlight }: { o: EngramObservation; text: string; now: number; onHighlight: (p: string | null) => void }) {
  const phrase = o.type === "decision" ? appliesTo(o.title, text) : null;
  return (
    <li className="mm-row">
      <span className={cx("mm-t", typeClass(o.type))}>{TYPE_LABEL[o.type] ?? o.type}</span>
      <span className="mm-ti" title={o.title}>
        {o.title}
      </span>
      <span className="mm-a">{ago(o.createdAt, now)}</span>
      {phrase ? (
        <span className="mm-ap">
          <b className="mm-f">aplica a este mensaje</b>
          <button
            type="button"
            className="mm-ln"
            onMouseEnter={() => onHighlight(phrase)}
            onMouseLeave={() => onHighlight(null)}
            onFocus={() => onHighlight(phrase)}
            onBlur={() => onHighlight(null)}
          >
            <IcStub />«{phrase}»
          </button>
        </span>
      ) : null}
    </li>
  );
}
