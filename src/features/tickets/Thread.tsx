"use client";
// Thread pane (520 px): the question, A/B options, Claude's recommendation, the
// client's words, sources, Claude's plan, permission approvals, reviews, the
// messages, the agents on the ticket and the reply composer.
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Attachment, PlannedAction, TicketMessage, TicketRef } from "@/lib/domain/types";
import { Alert, Chip, FilesBadge, srcClass } from "@/components/ui/primitives";
import { chipOfMeta } from "@/lib/domain/files";
import { useToast } from "@/components/ui/interactive";
import { arrive, arrivePlan, confirmPick, usePress } from "@/lib/motion";
import { ApprovalCard } from "@/features/approvals/ApprovalCard";
import { ReviewCard } from "@/features/reviews/ReviewCard";
import { IcBack, IcCheck, IcEngram, IcExternal, IcFile, IcUndo } from "@/features/salidas/icons";
import { ApiError } from "@/features/salidas/api";
import { classify, normalizeUrl } from "@/lib/domain/links";
import { ticketApi } from "./api";
import { DirLine, dirLabel, hm, statusLabel } from "./bits";
import { KnownTickets, Linked } from "./Linkified";
import { ComposerBox, fmtSize, useComposer, type SlashAction } from "./Composer";
import { hasUnseenStep, isNearBottom, nextPlanPill, onNewMessage, planInView, visiblePill, type PlanPillKind, type ScrollBox } from "./follow";
import { optionStates, optionText, type OptionState } from "@/lib/domain/ticket-options";
import { clearReply, loadReply, saveReply, type ReplyDraft } from "./drafts";
import { useDraft } from "./useDraft";
import type { PickTicket, ThreadData } from "./read";
import type { Related } from "@/lib/domain/related";

interface Props {
  data: ThreadData;
  listening: boolean;
  pick: PickTicket[];
  verbs: string[];
  onChanged: () => void;
  /** Focus mode (the screen shrinks the ticket list to a rail) and its toggle, shown in the composer. */
  focusMode: boolean;
  onToggleFocus: () => void;
}

export function Thread({ data, listening, pick, verbs, onChanged, focusMode, onToggleFocus }: Props) {
  const { ticket: t } = data;
  const toast = useToast();
  const c = useComposer();
  // The unsent reply lives in the browser per ticket: a remount (tab or screen change, reload, a
  // board restart under the open tab) brings it back.
  const draftId = t.id;
  const loadDraft = useCallback(() => loadReply(draftId), [draftId]);
  const saveDraft = useCallback((d: ReplyDraft) => saveReply(draftId, d), [draftId]);
  const draft = useMemo(() => ({ text: c.state.text, refs: c.state.refs }), [c.state.text, c.state.refs]);
  useDraft(loadDraft, saveDraft, c.restore, draft);
  const [busy, setBusy] = useState(false);
  const ref = usePress<HTMLElement>(".btn, .tk-opt, .tk-verb");
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current) arrive(bodyRef.current.querySelectorAll(".tk-msg, .tk-act, .ap-card"));
  }, [t.id]);

  // Autoscroll (follow.ts): opening a ticket and sending land on the last message; a message from
  // Claude scrolls only when he is already near the bottom, otherwise the "nuevo mensaje" pill shows.
  // On desktop the thread scrolls itself; on the phone the page does, and the same rule applies to
  // it. Only scroll positions move: never the list, the focus or the composer.
  const [pill, setPill] = useState(false);
  const nearBottom = useRef(true);
  const lastMsg = t.messages[t.messages.length - 1];
  const seenMsg = useRef(lastMsg?.id);
  /** What scrolls the thread right now, or null while it is not on screen (phone list view). */
  const scroller = (): { el: HTMLElement | null; box: ScrollBox } | null => {
    const el = bodyRef.current;
    if (!el || el.getClientRects().length === 0) return null;
    if (getComputedStyle(el).overflowY === "auto") return { el, box: el };
    const d = document.documentElement;
    return { el: null, box: { scrollTop: window.scrollY, clientHeight: window.innerHeight, scrollHeight: d.scrollHeight } };
  };
  // Scroll events caused by our own instant jump arrive a frame later, when a resize may already have
  // pushed the end away: they are not him scrolling up, so they are not measured.
  const quiet = useRef(0);
  const toBottom = (smooth: boolean) => {
    const s = scroller();
    if (!s) return;
    const behavior = smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto";
    if (behavior === "auto") quiet.current = performance.now() + 150;
    if (s.el) s.el.scrollTo({ top: s.el.scrollHeight, behavior });
    else window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
  };
  const measured = (near: boolean) => {
    nearBottom.current = near;
    // Pinned to the bottom we re-pin ourselves on every resize; the browser's scroll anchoring would read its own
    // correction as him scrolling up. Reading history keeps the anchoring.
    if (bodyRef.current) bodyRef.current.style.overflowAnchor = near ? "none" : "";
    if (near) setPill(false);
  };

  // The plan pill (follow.ts): the plan sits above the messages and the thread opens at the end, so a plan that
  // arrives (or still waits when the ticket opens) is usually off screen. "Ver plan nuevo ↑" / "Plan pendiente ↑"
  // take its place over the composer, win over "nuevo mensaje", never scroll by themselves, and hide when the plan
  // is in view or nothing is planned. The plan's rows arrive (and its stubs grow) when it comes into view.
  const planRef = useRef<HTMLDivElement>(null);
  const planned = t.status === "closed" ? [] : t.actions.filter((a) => a.state === "planned").map((a) => a.id);
  const actionIds = t.actions.map((a) => a.id);
  const live = useRef({ planned, actionIds });
  useLayoutEffect(() => {
    live.current = { planned, actionIds };
  });
  const [planPill, setPlanPill] = useState<PlanPillKind | null>(null);
  const planPillNow = useRef<PlanPillKind | null>(null);
  const seenSteps = useRef<string[]>([]);
  const opened = useRef(false);
  const arrivalDue = useRef(false);
  const checkPlan = () => {
    const s = scroller();
    if (!s) return; // the thread is not on screen (phone list view): it is judged when it appears
    const opening = !opened.current;
    opened.current = true;
    const { planned: waiting, actionIds: all } = live.current;
    const el = planRef.current;
    // On the phone the window scrolls and the sticky header and the composer cover its edges: the plan is in
    // view only between the header's bottom and the composer's top.
    const edge = (sel: string, side: "top" | "bottom", dflt: number) => {
      const node = ref.current?.querySelector(sel);
      return node && node.getClientRects().length ? node.getBoundingClientRect()[side] : dflt;
    };
    const view = s.el
      ? s.el.getBoundingClientRect()
      : { top: edge("header.tk-phead", "bottom", 0), bottom: edge(".tk-foot", "top", window.innerHeight) };
    const inView = el ? planInView(el.getBoundingClientRect(), view) : false;
    const grew = !opening && hasUnseenStep(waiting, seenSteps.current);
    const next = nextPlanPill({ current: planPillNow.current, planned: waiting, seen: seenSteps.current, inView, opening });
    seenSteps.current = all;
    if (next !== planPillNow.current) {
      planPillNow.current = next;
      setPlanPill(next);
    }
    if (grew) arrivalDue.current = true;
    if (!waiting.length) arrivalDue.current = false;
    if (arrivalDue.current && inView && el) {
      arrivalDue.current = false;
      arrivePlan(el);
    }
  };
  const goPlan = () => {
    planPillNow.current = null;
    setPlanPill(null);
    arrivalDue.current = true;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    nearBottom.current = false; // leaving the end: a resize must not pull him back
    planRef.current?.scrollIntoView({ block: "start", behavior });
  };

  useLayoutEffect(() => {
    toBottom(false); // opening: already at the end on first paint, no jump from the top
    nearBottom.current = true;
    if (bodyRef.current) bodyRef.current.style.overflowAnchor = "none";
    // On a hard load the server HTML is hidden (tickets.css) until here, so it is never painted at the top.
    bodyRef.current?.removeAttribute("data-pin");
    checkPlan(); // opening with a plan still waiting out of view: "Plan pendiente"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A plan that arrives or grows is judged after the frame in which the list rail, the end-of-thread pin and the
  // new rows have settled (the pin runs in the resize observer).
  const actionsKey = actionIds.join(",");
  const plannedKey = planned.join(",");
  useEffect(() => {
    if (!opened.current) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(checkPlan);
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionsKey, plannedKey]);
  useLayoutEffect(() => {
    if (!lastMsg || seenMsg.current === lastMsg.id) return;
    seenMsg.current = lastMsg.id;
    if (!scroller()) return;
    if (onNewMessage({ own: lastMsg.author === "andres", wasNearBottom: nearBottom.current }) === "scroll") {
      toBottom(true);
    } else {
      setPill(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMsg?.id]);
  // The page scrolls on the phone: measure it too.
  useEffect(() => {
    const on = () => {
      const s = scroller();
      if (s && !s.el && performance.now() >= quiet.current) measured(isNearBottom(s.box));
      checkPlan();
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Staying at the bottom when sizes change under him (focus mode opening or closing re-wraps
  // the text and resizes the composer; the thread appearing on the phone): re-pin if he was there.
  const resizes = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    resizes.current = new ResizeObserver(() => {
      if (nearBottom.current) toBottom(false);
      checkPlan(); // after the pin: what the plan shows now is what he sees
    });
    return () => resizes.current?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const el = bodyRef.current;
    const ro = resizes.current;
    if (!el || !ro) return;
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
  });

  const first = t.messages[0];
  const rest = t.messages.slice(1);
  // Every message with options gets buttons; only the latest one Andrés has not answered is live.
  const optStates = optionStates(t.messages);
  const openMsg = t.messages.find((m) => optStates.get(m.id)?.actionable);
  const closed = t.status === "closed";
  const pending = data.approvals.filter((a) => a.status === "pending");
  const pastApprovals = data.approvals.filter((a) => a.status !== "pending").slice(-3);

  const send = async (chosenKey?: string, from?: TicketMessage) => {
    if (busy) return;
    if (!chosenKey && !c.state.text.trim() && !c.state.files.length && !c.state.refs.length) return;
    setBusy(true);
    try {
      const state = chosenKey && !c.state.text.trim() ? { ...c.state, text: optionText(from ?? openMsg, chosenKey) } : c.state;
      await ticketApi.reply(t.id, state, chosenKey);
      clearReply(t.id); // sent: the draft must not come back (a failed send keeps it)
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

  /** "autoaprobado" -> "te pide OK". Once Claude started the step the server says 409: it stays autoaprobado. */
  const revoke = async (a: PlannedAction) => {
    setBusy(true);
    try {
      await ticketApi.revokeStep(t.id, a.id);
      toast({ text: "El paso vuelve a pedirte OK" });
      onChanged();
    } catch (e) {
      toast({ text: e instanceof ApiError && e.status === 409 ? "Claude ya empezó ese paso" : e instanceof Error ? e.message : "No se pudo completar" });
      onChanged(); // show what the step really is now
    } finally {
      setBusy(false);
    }
  };
  const shown = visiblePill({ plan: planPill, message: pill });

  const fileIn = useRef<HTMLInputElement>(null);
  const actions: SlashAction[] = [
    { key: "hecho", label: "Marcar hecho", hint: "cierra el ticket", run: () => void transition(() => ticketApi.close(t.id), "Ticket cerrado") },
    { key: "archivo", label: "Adjuntar archivo", run: () => fileIn.current?.click() },
    ...verbs.map((v) => ({ key: v.toLowerCase().replace(/\s+/g, "-"), label: v, hint: "pídeselo a Claude", run: () => c.setText(`${c.state.text}${c.state.text && !c.state.text.endsWith(" ") ? " " : ""}${v}: `) })),
  ];

  const known = useMemo(() => new Set(data.knownRefs), [data.knownRefs]);
  return (
    <KnownTickets.Provider value={known}>
    <aside className="tk-pane tk-thread" ref={ref} aria-label={`Ticket ${t.ref}`}>
      <header className="tk-phead">
        <Link className="tk-back" href="/tickets" aria-label="Volver a Tickets">
          <IcBack />
          <span className="tk-back-l">Tickets</span>
        </Link>
        <div className="tk-pt">
          <b>{t.title}</b>
          <small>{statusLabel(t.status)}</small>
        </div>
      </header>
      <div className="tk-scrollwrap">
        <div
          className="tk-scroll"
          ref={bodyRef}
          data-pin="1"
          onScroll={(e) => {
            if (performance.now() >= quiet.current) measured(isNearBottom(e.currentTarget));
            checkPlan();
          }}
        >
          <div className="kind">
            <DirLine direction={t.direction} />
            {t.ref} · {dirLabel(t.direction)} · {hm(t.createdAt)}
            <FilesBadge chip={chipOfMeta(data.item?.meta)} />
          </div>
          <h2>{t.title}</h2>
          {first?.body && first.body !== t.title ? <div className="ctx"><Linked text={first.body} /></div> : null}

          {first?.options?.length ? (
            <>
              <div className="k">{optStates.get(first.id)?.actionable ? "Elige" : "Opciones"}</div>
              <Options m={first} state={optStates.get(first.id)} disabled={busy || closed} onPick={(key) => send(key, first)} />
            </>
          ) : null}

          {data.item ? (
            <>
              <div className="k">Lo que pidió el cliente</div>
              <div className="ctx"><Linked text={data.item.excerpt || data.item.title} /></div>
            </>
          ) : null}

          <Sources refs={t.refs.filter((r) => !r.messageId || r.messageId === first?.id)} titles={data.refTitles} owner={t.ownerSession} item={data.item} related={data.related} />

          {first ? <Files atts={t.attachments.filter((a) => a.messageId === first.id || !a.messageId)} ticketId={t.id} /> : null}

          {t.actions.length ? (
            <div className="tk-planwrap" ref={planRef}>
              <Plan
                ticketId={t.id}
                actions={t.actions}
                verbs={verbs}
                busy={busy}
                onVerb={(v) => c.setText(`${v}: `)}
                onApprove={(reject) => transition(() => ticketApi.approvePlan(t.id, reject), reject.length ? `Plan aprobado sin ${reject.length}` : "Plan aprobado · Claude empieza")}
                onApproveStep={(a) => transition(() => ticketApi.approveStep(t.id, a.id), "Paso autoaprobado · Claude lo hace sin volver a preguntar")}
                onRevokeStep={(a) => revoke(a)}
              />
            </div>
          ) : t.direction === "andres_asks" && t.status !== "closed" && !rest.length ? (
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
                <Message key={m.id} m={m} options={optStates.get(m.id)} disabled={busy || closed} onPick={(key) => send(key, m)} atts={t.attachments.filter((a) => a.messageId === m.id)} refs={t.refs.filter((r) => r.messageId === m.id)} ticketId={t.id} titles={data.refTitles} />
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
      </div>

      <div className="tk-foot">
        {shown ? (
          <button
            key={shown}
            className="tk-newmsg"
            type="button"
            // The composer keeps its focus and caret: the pill only moves the thread.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (shown === "message") {
                toBottom(true);
                setPill(false);
              } else goPlan();
            }}
          >
            {shown === "plan-nuevo" ? "Ver plan nuevo" : shown === "plan-pendiente" ? "Plan pendiente" : "nuevo mensaje"} <span aria-hidden="true">{shown === "message" ? "↓" : "↑"}</span>
          </button>
        ) : null}
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
              placeholder={openMsg?.options?.length ? `Responde, elige ${openMsg.options.map((o) => o.key).join(" o ")}, o pide algo más` : t.status === "waiting_andres" ? "Responde a Claude" : "Añade algo más (opcional)"}
              onSubmit={() => void send()}
              focusMode={focusMode}
              onToggleFocus={onToggleFocus}
              menuAbove
            >
              <button className="btn sm perm" type="button" disabled={busy} onClick={() => transition(() => ticketApi.requestPermission(t.id), listening ? "Pedido enviado · Claude despierta para pedirte permiso" : "Pedido guardado · lo lee la próxima sesión")} title="Claude pide el permiso de la llamada bloqueada y verás la tarjeta aquí">
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
    </KnownTickets.Provider>
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
  draft_created: "borrador en Slack",
  deleted: "eliminada",
  draft: "borrador",
};

/** A/B choices of one message as real buttons: the recommended one marked, the picked one pressed. */
function Options({ m, state, disabled, onPick }: { m: TicketMessage; state?: OptionState; disabled: boolean; onPick: (key: string) => void }) {
  const live = Boolean(state?.actionable);
  return (
    <>
      <div className={live ? "tk-opts" : "tk-opts ro"} role="group" aria-label="Opciones">
        {m.options?.map((o) => (
          <button
            key={o.key}
            type="button"
            className={["tk-opt", m.recommended === o.key && "rec", state?.chosen === o.key && "pick"].filter(Boolean).join(" ")}
            disabled={!live || disabled}
            aria-pressed={state?.chosen === o.key}
            onClick={(e) => {
              confirmPick(e.currentTarget);
              onPick(o.key);
            }}
          >
            <b>{o.key}</b>
            <span>
              <Linked text={o.label} inButton />
              {o.detail ? <small><Linked text={o.detail} inButton /></small> : null}
            </span>
          </button>
        ))}
      </div>
      {m.recommended ? (
        <div className="tk-rec">
          <span className="ln src-claude" style={{ background: "var(--c)" }} />
          <span>
            <b>Claude recomienda {m.recommended}:</b> <Linked text={m.recommendation ?? ""} />
          </span>
        </div>
      ) : null}
    </>
  );
}

function Sources({ refs, titles, owner, item, related }: { refs: TicketRef[]; titles: Record<string, string>; owner: string | null; item: ThreadData["item"]; related: Related[] }) {
  if (!refs.length && !owner && !item && !related.length) return null;
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
          ) : r.refType === "url" && normalizeUrl(r.target) ? (
            <Chip key={r.id} source={classify(r.target)?.source} href={normalizeUrl(r.target) ?? undefined}>
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
      {related.length ? (
        <>
          <div className="k">Relacionado</div>
          <div className="dest" aria-label="Relacionado">
            {related.map((x) =>
              x.internal ? (
                <Link key={x.key} className="chip ref" href={x.href}>
                  <b>{x.label}</b> {x.detail}
                </Link>
              ) : (
                <Chip key={x.key} source={x.source} href={x.href} className="tk-rel">
                  {x.label} <IcExternal />
                </Chip>
              ),
            )}
          </div>
        </>
      ) : null}
    </>
  );
}


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

function Message({ m, options, disabled, onPick, atts, refs, ticketId, titles }: { m: TicketMessage; options?: OptionState; disabled: boolean; onPick: (key: string) => void; atts: Attachment[]; refs: TicketRef[]; ticketId: string; titles: Record<string, string> }) {
  return (
    <div className="tk-msg">
      <div className="tk-who">
        {m.author === "claude" ? <span className="ln src-claude" style={{ width: 14, background: "var(--c)" }} /> : null}
        {m.author === "claude" ? "Claude" : "Tú"}
        <time>{hm(m.createdAt)}</time>
        {m.chosen ? <span className="tk-chose">eligió {m.chosen}</span> : null}
        {m.kind === "permission_request" ? <span className="tk-chose">pedido de permiso</span> : null}
      </div>
      {m.body ? <p><Linked text={m.body} /></p> : null}
      {m.options?.length ? <Options m={m} state={options} disabled={disabled} onPick={onPick} /> : null}
      {refs.length ? (
        <div className="tk-files">
          {refs.map((r) => (
            r.refType === "ticket" ? (
              <Link key={r.id} className="tk-att ref" href={`/tickets?t=${r.target}`}>
                <span className="at">@{r.target}</span> <span className="tk-att-t">{titles[r.target] ?? r.label}</span>
              </Link>
            ) : r.refType === "url" && normalizeUrl(r.target) ? (
              <a key={r.id} className="tk-att ref" href={normalizeUrl(r.target) ?? undefined} target="_blank" rel="noopener noreferrer" title={r.target}>
                <span className="at">{classify(r.target)?.label ?? "enlace"}</span> <span className="tk-att-t">{r.label || r.target}</span>
              </a>
            ) : (
              <span key={r.id} className="tk-att ref">
                <span className="at">{r.refType === "url" ? "enlace" : "@"}</span> <span className="tk-att-t">{r.label || r.target}</span>
              </span>
            )
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

function Plan({ actions, verbs, busy, onApprove, onApproveStep, onRevokeStep, onVerb }: { ticketId: string; actions: PlannedAction[]; verbs: string[]; busy: boolean; onApprove: (reject: string[]) => void; onApproveStep: (a: PlannedAction) => void; onRevokeStep: (a: PlannedAction) => void; onVerb: (v: string) => void }) {
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
          const approved = a.state === "approved";
          // Only a needs_ok step while the plan still waits toggles: planned (and not marked "no hacer") or autoaprobado.
          const toggles = a.mode === "needs_ok" && ((a.state === "planned" && !off) || (approved && waiting.length > 0));
          return (
            <div key={a.id} className={off ? "tk-act off" : "tk-act"}>
              <span className={`ln ${srcClass(a.source)}`} style={{ background: "var(--c)" }} />
              <span>
                <b>{head}</b>
                {tail.length ? ` · ${tail.join(" · ")}` : ""}
                {detail ? <small>{detail}</small> : null}
              </span>
              <span className="tk-gate">
                {toggles ? (
                  // The chip is the toggle: te pide OK <-> autoaprobado (approve this step now, or take it back while Claude has not started it).
                  <button
                    className={approved ? "gate ask tog on" : "gate ask tog"}
                    type="button"
                    aria-pressed={approved}
                    disabled={busy}
                    title={approved ? "Toca para que vuelva a pedirte OK" : "Toca para que Claude lo haga sin volver a preguntar"}
                    onClick={(e) => {
                      confirmPick(e.currentTarget);
                      if (approved) onRevokeStep(a);
                      else onApproveStep(a);
                    }}
                  >
                    {approved ? (
                      <>
                        <IcCheck aria-hidden="true" />
                        autoaprobado
                      </>
                    ) : (
                      "te pide OK"
                    )}
                  </button>
                ) : (
                  <span className={a.mode === "needs_ok" ? "gate ask" : "gate"}>{a.mode === "needs_ok" ? "te pide OK" : "directo"}</span>
                )}
                {a.state === "planned" && a.mode === "needs_ok" ? (
                  <label className="tk-no">
                    <input type="checkbox" checked={reject.includes(a.id)} onChange={() => setReject((r) => (r.includes(a.id) ? r.filter((x) => x !== a.id) : [...r, a.id]))} />
                    no hacer
                  </label>
                ) : !toggles && a.state !== "planned" && (a.state !== "approved" || a.mode === "needs_ok") ? (
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
          <button key={v} className="tk-verb" type="button" title={v} onClick={() => onVerb(v)}>
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
              <dd><Linked text={brief.goal} /></dd>
            </>
          ) : null}
          {brief.planStep ? (
            <>
              <dt>Paso</dt>
              <dd><Linked text={brief.planStep} /></dd>
            </>
          ) : null}
          {brief.nextAction ? (
            <>
              <dt>Siguiente</dt>
              <dd><Linked text={brief.nextAction} /></dd>
            </>
          ) : null}
          {brief.openQuestions.length ? (
            <>
              <dt>Preguntas</dt>
              <dd>
                <ul>
                  {brief.openQuestions.map((q) => (
                    <li key={q}><Linked text={q} /></li>
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
                {h.body ? <>: <Linked text={h.body} /></> : ""}
                {h.remaining ? <small>Falta: <Linked text={h.remaining} /></small> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </details>
  );
}
