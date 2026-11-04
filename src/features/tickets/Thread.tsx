"use client";
// Thread pane (520 px): the question, A/B options, Claude's recommendation, the
// client's words, sources, Claude's plan, permission approvals, reviews, the
// messages, the agents on the ticket and the reply composer.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Attachment, PlannedAction, TicketMessage, TicketRef } from "@/lib/domain/types";
import { Alert, Chip, srcClass } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/interactive";
import { arrive, confirmPick, usePress } from "@/lib/motion";
import { ApprovalCard } from "@/features/approvals/ApprovalCard";
import { ReviewCard } from "@/features/reviews/ReviewCard";
import { IcBack, IcCheck, IcEngram, IcExternal, IcFile, IcUndo } from "@/features/salidas/icons";
import { ticketApi } from "./api";
import { DirLine, dirLabel, hm } from "./bits";
import { ComposerBox, fmtSize, useComposer, type SlashAction } from "./Composer";
import type { PickTicket, ThreadData } from "./read";

interface Props {
  data: ThreadData;
  listening: boolean;
  pick: PickTicket[];
  verbs: string[];
  onChanged: () => void;
}

export function Thread({ data, listening, pick, verbs, onChanged }: Props) {
  const { ticket: t } = data;
  const toast = useToast();
  const c = useComposer();
  const [busy, setBusy] = useState(false);
  const ref = usePress<HTMLElement>(".btn, .tk-opt, .tk-verb");
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current) arrive(bodyRef.current.querySelectorAll(".tk-msg, .tk-act, .ap-card"));
  }, [t.id]);

  const first = t.messages[0];
  const rest = t.messages.slice(1);
  const chosen = [...t.messages].reverse().find((m) => m.chosen)?.chosen ?? null;
  const closed = t.status === "closed";
  const pending = data.approvals.filter((a) => a.status === "pending");
  const pastApprovals = data.approvals.filter((a) => a.status !== "pending").slice(-3);

  const send = async (chosenKey?: string) => {
    if (busy) return;
    if (!chosenKey && !c.state.text.trim() && !c.state.files.length && !c.state.refs.length) return;
    setBusy(true);
    try {
      const state = chosenKey && !c.state.text.trim() ? { ...c.state, text: optionText(first, chosenKey) } : c.state;
      await ticketApi.reply(t.id, state, chosenKey);
      c.reset();
      toast({ text: listening ? "Respuesta enviada · Claude despierta" : "Respuesta guardada · la lee la próxima sesión" });
      onChanged();
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudo enviar" });
    } finally {
      setBusy(false);
    }
  };
  const transition = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ text: ok });
      onChanged();
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudo completar" });
    } finally {
      setBusy(false);
    }
  };

  const fileIn = useRef<HTMLInputElement>(null);
  const actions: SlashAction[] = [
    { key: "hecho", label: "Marcar hecho", hint: "cierra el ticket", run: () => void transition(() => ticketApi.close(t.id), "Ticket cerrado") },
    { key: "archivo", label: "Adjuntar archivo", run: () => fileIn.current?.click() },
    ...verbs.map((v) => ({ key: v.toLowerCase().replace(/\s+/g, "-"), label: v, hint: "pídeselo a Claude", run: () => c.setText(`${c.state.text}${c.state.text && !c.state.text.endsWith(" ") ? " " : ""}${v}: `) })),
  ];

  return (
    <aside className="tk-pane" ref={ref} aria-label={`Ticket ${t.ref}`}>
      <Link className="tk-back" href="/tickets">
        <IcBack />
        Tickets
      </Link>
      <div className="tk-scroll" ref={bodyRef}>
        <div className="kind">
          <DirLine direction={t.direction} />
          {t.ref} · {dirLabel(t.direction)} · {hm(t.createdAt)}
        </div>
        <h2>{t.title}</h2>
        {first?.body && first.body !== t.title ? <div className="ctx">{first.body}</div> : null}

        {first?.options?.length ? (
          <>
            <div className="k">Elige</div>
            <div className="tk-opts">
              {first.options.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className={["tk-opt", first.recommended === o.key && "rec", chosen === o.key && "pick"].filter(Boolean).join(" ")}
                  disabled={busy || closed}
                  aria-pressed={chosen === o.key}
                  onClick={(e) => {
                    confirmPick(e.currentTarget);
                    void send(o.key);
                  }}
                >
                  <b>{o.key}</b>
                  <span>
                    {o.label}
                    {o.detail ? <small>{o.detail}</small> : null}
                  </span>
                </button>
              ))}
            </div>
            {first.recommended ? (
              <div className="tk-rec">
                <span className="ln src-claude" style={{ background: "var(--c)" }} />
                <span>
                  <b>Claude recomienda {first.recommended}:</b> {first.recommendation}
                </span>
              </div>
            ) : null}
          </>
        ) : null}

        {data.item ? (
          <>
            <div className="k">Lo que pidió el cliente</div>
            <div className="ctx">{data.item.excerpt || data.item.title}</div>
          </>
        ) : null}

        <Sources refs={t.refs.filter((r) => !r.messageId || r.messageId === first?.id)} titles={data.refTitles} owner={t.ownerSession} item={data.item} />

        {first ? <Files atts={t.attachments.filter((a) => a.messageId === first.id || !a.messageId)} ticketId={t.id} /> : null}

        {t.actions.length ? <Plan ticketId={t.id} actions={t.actions} verbs={verbs} busy={busy} onVerb={(v) => c.setText(`${v}: `)} onApprove={(reject) => transition(() => ticketApi.approvePlan(t.id, reject), reject.length ? `Plan aprobado sin ${reject.length}` : "Plan aprobado · Claude empieza")} /> : t.direction === "andres_asks" && t.status !== "closed" && !rest.length ? (
          <p className="tk-wait">Claude prepara el plan: verás aquí lo que va a hacer antes de que empiece.</p>
        ) : null}

        {pending.map((a) => (
          <ApprovalCard key={a.id} approval={a} onDecided={onChanged} />
        ))}
        {pastApprovals.map((a) => (
          <ApprovalCard key={a.id} approval={a} />
        ))}

        {data.reviews.map((r) => (
          <ReviewCard key={r.id} review={r} onChange={onChanged} />
        ))}

        {rest.length ? (
          <div className="tk-msgs">
            {rest.map((m) => (
              <Message key={m.id} m={m} atts={t.attachments.filter((a) => a.messageId === m.id)} refs={t.refs.filter((r) => r.messageId === m.id)} ticketId={t.id} titles={data.refTitles} />
            ))}
          </div>
        ) : null}

        {data.salidas.length ? (
          <div className="tk-sal">
            {data.salidas.map((s) => (
              <Link key={s.id} className={`lk ${srcClass(s.source)}`} href={`/salidas?s=${s.id}`}>
                <span className="ln" style={{ background: "var(--c)", width: 12, height: 4 }} />
                Salida · {s.title} · {s.simulated && s.status === "sent" ? "simulado · no salió" : (SAL_STATUS[s.status] ?? s.status)}
              </Link>
            ))}
          </div>
        ) : null}

        <StatusLine t={t} listening={listening} />
        <Agents data={data} />
      </div>

      <div className="tk-foot">
        {closed ? (
          <div className="acts">
            <button className="btn sm" type="button" disabled={busy} onClick={() => transition(() => ticketApi.reopen(t.id), "Ticket reabierto · Claude despierta")}>
              <IcUndo />
              Reabrir
            </button>
          </div>
        ) : (
          <>
            {!listening ? (
              <Alert>
                <b>Nadie te va a leer todavía.</b> Ninguna sesión de Claude escucha este ticket. Tu respuesta se guarda y la lee la próxima sesión que abras en G:/WorkSpace/designli.
              </Alert>
            ) : null}
            <input
              ref={fileIn}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                c.addFiles([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <ComposerBox
              c={c}
              pick={pick.filter((p) => p.ref !== t.ref)}
              actions={actions}
              label="Respuesta"
              placeholder={first?.options?.length && !chosen ? `Responde, elige ${first.options.map((o) => o.key).join(" o ")}, o pide algo más` : t.status === "waiting_andres" ? "Responde a Claude" : "Añade algo más (opcional)"}
              onSubmit={() => void send()}
              menuAbove
            >
              <button className="btn sm" type="button" disabled={busy} onClick={() => transition(() => ticketApi.requestPermission(t.id), listening ? "Pedido enviado · Claude despierta para pedirte permiso" : "Pedido guardado · lo lee la próxima sesión")} title="Claude pide el permiso de la llamada bloqueada y verás la tarjeta aquí">
                Pídeme permiso
              </button>
              <button className="btn sm" type="button" disabled={busy} onClick={() => transition(() => ticketApi.close(t.id), "Ticket cerrado")}>
                <IcCheck />
                Marcar hecho
              </button>
              <button className="btn sm p" type="button" disabled={busy} onClick={() => void send()}>
                {listening ? "Responder" : "Guardar respuesta"}
              </button>
            </ComposerBox>
          </>
        )}
        <div className="meta">
          <span>{closed ? "Queda en Cerrados hoy hasta medianoche." : t.status === "working" || t.status === "waiting_claude" ? "Se cierra cuando Claude termine o lo marques hecho." : "Al responder despierta la sesión que preguntó."}</span>
          <span className="tk-mem">
            <IcEngram />
            {t.engram.length ? `En engram · ${t.engram[t.engram.length - 1]!.project || t.project}` : t.project ? `Se guarda en engram · ${t.project}` : "Se guarda en engram"}
          </span>
        </div>
        {t.isSample ? <div className="sample">Datos de muestra.</div> : null}
      </div>
    </aside>
  );
}

const SAL_STATUS: Record<string, string> = {
  pending: "por firmar",
  sending: "enviando",
  sent: "enviada",
  failed: "falló",
  denied: "denegada",
  expired: "caducada",
  scheduled: "programada",
  queued_until_back: "al volver",
  deleted: "eliminada",
  draft: "borrador",
};

function optionText(first: TicketMessage | undefined, key: string): string {
  const o = first?.options?.find((x) => x.key === key);
  return o ? `${key}. ${o.label}` : key;
}

function Sources({ refs, titles, owner, item }: { refs: TicketRef[]; titles: Record<string, string>; owner: string | null; item: ThreadData["item"] }) {
  if (!refs.length && !owner && !item) return null;
  return (
    <>
      <div className="k">Fuente</div>
      <div className="dest">
        {item?.url ? (
          <Chip source={item.source} href={item.url}>
            {item.title} <IcExternal />
          </Chip>
        ) : null}
        {refs.map((r) =>
          r.refType === "ticket" ? (
            <Link key={r.id} className="chip ref" href={`/tickets?t=${r.target}`}>
              <b>@{r.target}</b> {titles[r.target] ?? r.label}
            </Link>
          ) : r.refType === "url" ? (
            <Chip key={r.id} source={sourceOfUrl(r.target)} href={r.target}>
              {r.label || r.target} <IcExternal />
            </Chip>
          ) : (
            <Chip key={r.id} variant="plain">
              {r.label || r.target}
            </Chip>
          ),
        )}
        {owner ? <Chip source="claude">Sesión de Claude · {owner}</Chip> : null}
      </div>
    </>
  );
}

const sourceOfUrl = (u: string) => (/github\.com/.test(u) ? "github" : /slack\.com/.test(u) ? "slack" : /basecamp/.test(u) ? "basecamp" : undefined);

function Files({ atts, ticketId }: { atts: Attachment[]; ticketId: string }) {
  if (!atts.length) return null;
  return (
    <div className="tk-files">
      {atts.map((a) => (
        <a key={a.id} className="tk-att" href={`/api/tickets/${ticketId}/attachments/${a.id}`} target="_blank" rel="noreferrer">
          <IcFile />
          <span className="tk-att-t">{a.filename}</span> <small>{fmtSize(a.size)}</small>
        </a>
      ))}
    </div>
  );
}

function Message({ m, atts, refs, ticketId, titles }: { m: TicketMessage; atts: Attachment[]; refs: TicketRef[]; ticketId: string; titles: Record<string, string> }) {
  return (
    <div className="tk-msg">
      <div className="tk-who">
        {m.author === "claude" ? <span className="ln src-claude" style={{ width: 14, background: "var(--c)" }} /> : null}
        {m.author === "claude" ? "Claude" : "Tú"}
        <time>{hm(m.createdAt)}</time>
        {m.chosen ? <span className="tk-chose">eligió {m.chosen}</span> : null}
        {m.kind === "permission_request" ? <span className="tk-chose">pedido de permiso</span> : null}
      </div>
      {m.body ? <p>{m.body}</p> : null}
      {m.options?.length ? (
        <ul className="tk-mopts">
          {m.options.map((o) => (
            <li key={o.key}>
              <b>{o.key}</b> {o.label}
            </li>
          ))}
        </ul>
      ) : null}
      {refs.length ? (
        <div className="tk-files">
          {refs.map((r) => (
            <Link key={r.id} className="tk-att ref" href={r.refType === "ticket" ? `/tickets?t=${r.target}` : r.target}>
              <span className="at">@{r.target}</span> <span className="tk-att-t">{titles[r.target] ?? r.label}</span>
            </Link>
          ))}
        </div>
      ) : null}
      <Files atts={atts} ticketId={ticketId} />
    </div>
  );
}

function StatusLine({ t, listening }: { t: ThreadData["ticket"]; listening: boolean }) {
  if (t.status === "working" || t.status === "waiting_claude")
    return (
      <div className="tk-status">
        <span className="live" style={{ margin: 0 }}>
          {listening ? <LiveTrackSmall /> : null}
          {t.status === "working" ? "Claude trabaja" : "Espera a Claude"} <small>· {t.wokeAt ? `despertó ${hm(t.wokeAt)}` : "aún no despierta"}</small>
        </span>
      </div>
    );
  if (t.status === "closed")
    return (
      <div className="tk-status">
        <IcCheck />
        <span>
          <b>Cerrado</b> · {hm(t.closedAt)}
        </span>
      </div>
    );
  return null;
}

function LiveTrackSmall() {
  return (
    <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true">
      <path d="M2 5H26" fill="none" stroke="var(--cl)" strokeWidth="3" strokeLinecap="round" opacity=".35" />
      <circle cx="5" cy="5" r="3.5" fill="var(--cl)" className="lb-travel" />
    </svg>
  );
}

// ---------- "Claude va a hacer" ----------

function Plan({ actions, verbs, busy, onApprove, onVerb }: { ticketId: string; actions: PlannedAction[]; verbs: string[]; busy: boolean; onApprove: (reject: string[]) => void; onVerb: (v: string) => void }) {
  const [reject, setReject] = useState<string[]>([]);
  const waiting = actions.filter((a) => a.state === "planned");
  return (
    <>
      <div className="tk-plan">
        <div className="tk-plan-h">
          Claude va a hacer<small>{waiting.length ? "antes de empezar" : "aprobado"}</small>
        </div>
        {actions.map((a) => {
          const [head, ...tail] = a.label.split(" · ");
          const detail = typeof a.target.detail === "string" ? a.target.detail : "";
          const off = reject.includes(a.id) || a.state === "rejected";
          return (
            <div key={a.id} className={off ? "tk-act off" : "tk-act"}>
              <span className={`ln ${srcClass(a.source)}`} style={{ background: "var(--c)" }} />
              <span>
                <b>{head}</b>
                {tail.length ? ` · ${tail.join(" · ")}` : ""}
                {detail ? <small>{detail}</small> : null}
              </span>
              <span className="tk-gate">
                <span className={a.mode === "needs_ok" ? "gate ask" : "gate"}>{a.mode === "needs_ok" ? "te pide OK" : "directo"}</span>
                {a.state === "planned" && a.mode === "needs_ok" ? (
                  <label className="tk-no">
                    <input type="checkbox" checked={reject.includes(a.id)} onChange={() => setReject((r) => (r.includes(a.id) ? r.filter((x) => x !== a.id) : [...r, a.id]))} />
                    no hacer
                  </label>
                ) : a.state !== "planned" && a.state !== "approved" ? (
                  <small className="tk-astate">{ACTION_STATE[a.state]}</small>
                ) : null}
              </span>
            </div>
          );
        })}
        {waiting.length ? (
          <div className="tk-plan-f">
            <button className="btn sm p" type="button" disabled={busy} onClick={() => onApprove(reject)}>
              {reject.length ? `Aprobar sin ${reject.length}` : "Aprobar plan"}
            </button>
            <span>Lo que escribe a un cliente pasa por Salidas.</span>
          </div>
        ) : null}
      </div>
      <div className="tk-verbs" aria-label="Acciones frecuentes">
        {verbs.map((v) => (
          <button key={v} className="tk-verb" type="button" onClick={() => onVerb(v)}>
            {v}
          </button>
        ))}
      </div>
    </>
  );
}

const ACTION_STATE: Record<string, string> = { rejected: "no se hará", running: "en curso", done: "hecho", failed: "falló", approved: "aprobado", planned: "" };

// ---------- agents on the ticket ----------

function Agents({ data }: { data: ThreadData }) {
  const { brief, team, handoffs } = data;
  if (!brief && !team.length && !handoffs.length) return null;
  return (
    <details className="tk-agents">
      <summary>
        <span className="k" style={{ margin: 0 }}>
          Resumen y equipo
        </span>
        <small>
          {brief ? `rev ${brief.revision}` : ""}
          {team.length ? ` · ${team.filter((a) => a.status === "live").length} vivos de ${team.length}` : ""}
        </small>
      </summary>
      {brief ? (
        <dl className="tk-brief">
          {brief.goal ? (
            <>
              <dt>Objetivo</dt>
              <dd>{brief.goal}</dd>
            </>
          ) : null}
          {brief.planStep ? (
            <>
              <dt>Paso</dt>
              <dd>{brief.planStep}</dd>
            </>
          ) : null}
          {brief.nextAction ? (
            <>
              <dt>Siguiente</dt>
              <dd>{brief.nextAction}</dd>
            </>
          ) : null}
          {brief.openQuestions.length ? (
            <>
              <dt>Preguntas</dt>
              <dd>
                <ul>
                  {brief.openQuestions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {team.length ? (
        <ul className="tk-team">
          {team.map((a) => (
            <li key={a.name} className={a.status === "live" ? "" : "off"}>
              <span className="tk-ag">{a.name}</span>
              <span>{a.role}{a.owner ? " · dueño" : ""}</span>
              <span className="tk-life">{a.status === "live" ? "vivo" : "retirado"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {handoffs.length ? (
        <ol className="tk-hand">
          {handoffs.map((h) => (
            <li key={h.id}>
              <span className="t">{hm(h.createdAt)}</span>
              <span>
                <b>{h.agent}</b> · {h.status === "done" ? "terminó" : h.status === "paused" ? "pausó" : "bloqueado"}
                {h.body ? `: ${h.body}` : ""}
                {h.remaining ? <small>Falta: {h.remaining}</small> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </details>
  );
}
