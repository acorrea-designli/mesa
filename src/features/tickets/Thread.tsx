"use client";
// Thread pane (520 px): the question cards (QuestionCard.tsx), the checklists (ChecklistCard.tsx), Claude's recommendation, the
// client's words, sources, Claude's plan, permission approvals, reviews, the
// messages, the agents on the ticket and the reply composer.
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Attachment, Checklist, PlannedAction, QuestionAnswer, TicketMessage, TicketQuestion, TicketRef, TicketStep } from "@/lib/domain/types";
import { Alert, Chip, FilesBadge, srcClass } from "@/components/ui/primitives";
import { chipOfMeta } from "@/lib/domain/files";
import { useIdentity } from "@/components/identity";
import { useToast } from "@/components/ui/interactive";
import { arrive, arrivePlan, confirmPick, usePress } from "@/lib/motion";
import { ApprovalCard } from "@/features/approvals/ApprovalCard";
import { ReviewCard } from "@/features/reviews/ReviewCard";
import { IcBack, IcCheck, IcEngram, IcExternal, IcFile, IcUndo } from "@/features/salidas/icons";
import { ApiError } from "@/features/salidas/api";
import { classify, normalizeUrl } from "@/lib/domain/links";
import { ticketApi } from "./api";
import { isPdf, placeAttachments } from "./attachments";
import { ReviewPdf } from "./ReviewPdf";
import { DirLine, dirLabel, hm, statusLabel } from "./bits";
import { KnownTickets, Linked } from "./Linkified";
import { Markdown, MarkdownInline } from "./MarkdownView";
import { ComposerBox, fmtSize, useComposer, type SlashAction } from "./Composer";
import { hasUnseenStep, isNearBottom, nextPlanPill, onNewMessage, pillLabel, planInView, visiblePill, type PlanPillKind, type ScrollBox } from "./follow";
import { cardOf, keysLine, multiStep } from "@/lib/domain/ticket-questions";
import { checklistOf } from "@/lib/domain/ticket-checklists";
import { ChecklistCard } from "./ChecklistCard";
import { QuestionCard } from "./QuestionCard";
import { PauseBar } from "./PauseBar";
import { answersOf, livePicks, type Picks } from "./card";
import { firstLine, repeatsReviewCard } from "@/lib/domain/review-repeat";
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
  const { sessionsDir } = useIdentity();
  const c = useComposer();
  // The unsent reply lives in the browser per ticket: a remount (tab or screen change, reload, a
  // board restart under the open tab) brings it back.
  const draftId = t.id;
  const loadDraft = useCallback(() => loadReply(draftId), [draftId]);
  const saveDraft = useCallback((d: ReplyDraft) => saveReply(draftId, d), [draftId]);
  // Picks on the question cards travel with the reply draft, so a reload keeps them.
  const [picks, setPicks] = useState<Picks>({});
  const { restore } = c;
  const restoreDraft = useCallback((d: ReplyDraft) => {
    restore(d);
    setPicks(d.picks ?? {});
  }, [restore]);
  const draft = useMemo(() => ({ text: c.state.text, refs: c.state.refs, picks }), [c.state.text, c.state.refs, picks]);
  useDraft(loadDraft, saveDraft, restoreDraft, draft);
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

  // The plan pill (follow.ts): a plan with a waiting step sits at the bottom, above the composer, so one that arrives
  // while he reads history is off screen. "Ver plan nuevo ↓" / "Plan pendiente ↓"
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
    nearBottom.current = true; // the waiting plan is the end of the thread: he stays pinned there
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
  // Every question card keeps its own live buttons until each question is answered or withdrawn (t108).
  const openQs = t.questions.filter((q) => q.state === "open");
  const cardFor = (m: TicketMessage | undefined) => (m ? cardOf(t.questions, m.id) : []);
  const firstCard = cardFor(first);
  // An attachment shows under its own message; one with no message closes the thread (t135).
  const placed = useMemo(() => placeAttachments(t.attachments, t.messages), [t.attachments, t.messages]);
  const pdfs = useMemo(() => t.attachments.filter(isPdf), [t.attachments]);
  const closed = t.status === "closed";
  // Claude replies that repeat the review card (older ones, from before hook G12) fold under it.
  const cardFindings = data.reviews.flatMap((r) => r.findings);
  const pending = data.approvals.filter((a) => a.status === "pending");
  const pastApprovals = data.approvals.filter((a) => a.status !== "pending").slice(-3);

  /**
   * One reply: his words plus the answers to open card questions. `answers` comes from a card (its own picks, or the
   * click on a 1-step card); the composer's Responder sends every pick on every card.
   */
  const send = async (answers?: QuestionAnswer[]) => {
    if (busy) return;
    const all = answers ?? answersOf(t.questions, livePicks(t.questions, picks));
    if (!all.length && !c.state.text.trim() && !c.state.files.length && !c.state.refs.length) return;
    setBusy(true);
    try {
      await ticketApi.reply(t.id, c.state, all);
      clearReply(t.id); // sent: the draft must not come back (a failed send keeps it)
      c.reset();
      // What was sent leaves; picks on other cards stay (the draft saves them again).
      setPicks((p) => Object.fromEntries(Object.entries(p).filter(([id]) => !all.some((a) => a.questionId === id))));
      toast({ text: listening ? "Respuesta enviada · Claude despierta" : "Respuesta guardada · la lee la próxima sesión" });
      onChanged();
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudo enviar" });
    } finally {
      setBusy(false);
    }
  };
  /** One checklist step, ticked or unticked: the card shows it at once; a refusal reaches it as a rejection and it rolls back. */
  const setStep = async (s: TicketStep, done: boolean) => {
    await ticketApi.setStep(t.id, s.id, done);
    onChanged();
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

  // The plan card: while a step waits for him it sits at the bottom with the pending permission cards; once nothing
  // waits it is back under the first message.
  const planAtBottom = planned.length > 0;
  const planCard = t.actions.length ? (
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
  ) : null;

  const known = useMemo(() => new Set(data.knownRefs), [data.knownRefs]);
  return (
    <KnownTickets.Provider value={known}>
    <aside className="tk-pane tk-thread" ref={ref} aria-label={`Ticket ${t.ref}`}>
      <header className={pdfs.length ? "tk-phead has-pdf" : "tk-phead"}>
        <Link className="tk-back" href="/tickets" aria-label="Volver a Tickets">
          <IcBack />
          <span className="tk-back-l">Tickets</span>
        </Link>
        <div className="tk-pt">
          <b>{t.title}</b>
          <small>{statusLabel(t.status)}</small>
        </div>
        <ReviewPdf ticketId={t.id} pdfs={pdfs} />
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
          <PauseBar t={t} pick={pick} listening={listening} onChanged={onChanged} />
          {first?.body && first.body !== t.title ? <div className="ctx"><Markdown className="tk-md" text={first.body} /></div> : null}

          {firstCard.length ? (
            <>
              <div className="k">{firstCard.some((q) => q.state === "open") ? (firstCard.length > 1 ? "Responde" : "Elige") : firstCard.length > 1 ? "Preguntas" : "Opciones"}</div>
              <QuestionCard questions={firstCard} picks={picks} onPicks={setPicks} onSend={(a) => void send(a)} disabled={busy || closed} />
            </>
          ) : null}

          {data.item ? (
            <>
              <div className="k">Lo que pidió el cliente</div>
              <div className="ctx"><Linked text={data.item.excerpt || data.item.title} /></div>
            </>
          ) : null}

          <Sources refs={t.refs.filter((r) => !r.messageId || r.messageId === first?.id)} titles={data.refTitles} owner={t.ownerSession} item={data.item} related={data.related} />

          {first ? <Files atts={placed.byMessage.get(first.id) ?? []} ticketId={t.id} /> : null}

          {t.actions.length ? (
            planAtBottom ? null : planCard
          ) : t.direction === "andres_asks" && t.status !== "closed" && !rest.length ? (
            <p className="tk-wait">Claude prepara el plan: verás aquí lo que va a hacer antes de que empiece.</p>
          ) : null}

          {pastApprovals.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}

          {data.reviews.map((r) => (
            <ReviewCard key={r.id} review={r} onChange={onChanged} />
          ))}

          {rest.length ? (
            <div className="tk-msgs">
              {rest.map((m) => (
                <Message
                  key={m.id}
                  m={m}
                  fold={repeatsReviewCard({ ...m, options: cardFor(m).length ? cardFor(m) : m.options }, cardFindings, data.reviews.length > 0)}
                  card={cardFor(m)}
                  list={checklistOf(t.checklists, m.id)}
                  closed={closed}
                  onSetStep={setStep}
                  answered={t.questions.filter((q) => q.answerMessageId === m.id)}
                  all={t.questions}
                  picks={picks}
                  onPicks={setPicks}
                  disabled={busy || closed}
                  onSend={(a) => void send(a)}
                  atts={placed.byMessage.get(m.id) ?? []}
                  refs={t.refs.filter((r) => r.messageId === m.id)}
                  ticketId={t.id}
                  titles={data.refTitles}
                />
              ))}
            </div>
          ) : null}

          {placed.tail.length ? (
            <>
              <div className="k">Adjuntos</div>
              <Files atts={placed.tail} ticketId={t.id} />
            </>
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

          {/* What waits for him sits last, right above the composer, where the thread opens and he is reading (t150).
              Always rendered, so the resize observer already watches it when a card arrives and keeps him at the end. */}
          <div className="tk-bottom">
            {planAtBottom ? planCard : null}
            {pending.map((a) => (
              <ApprovalCard key={a.id} approval={a} onDecided={onChanged} />
            ))}
          </div>
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
            {pillLabel(shown).text} <span aria-hidden="true">{pillLabel(shown).arrow}</span>
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
                <b>Nadie te va a leer todavía.</b> Ninguna sesión de Claude escucha este ticket. Tu respuesta se guarda y la lee la próxima sesión que abras en {sessionsDir}.
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
              placeholder={openQs.length === 1 ? `Responde, elige ${keysLine(openQs[0]!.options)}, o pide algo más` : openQs.length ? "Responde con la tarjeta o escribe 1A 2C, o pide algo más" : t.status === "waiting_andres" ? "Responde a Claude" : "Añade algo más (opcional)"}
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
          <span>{closed ? "Queda en Cerrados hoy hasta medianoche." : t.status === "working" || t.status === "waiting_claude" ? "Se cierra cuando Claude termine o lo marques hecho." : t.status === "paused" || t.status === "ongoing" ? "Al responder o reanudar vuelve a Claude." : "Al responder despierta la sesión que preguntó."}</span>
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
  withdrawn: "retirada",
  scheduled: "programada",
  queued_until_back: "al volver",
  draft_created: "borrador en Slack",
  deleted: "eliminada",
  draft: "borrador",
};

// A chip label on one line: cut with an ellipsis, rolled sideways on hover or focus (tickets.css, "source chips").
function Lbl({ text }: { text: string }) {
  return (
    <span className="tk-cl">
      <span className="tk-cl-i" style={{ animationDuration: `${Math.min(10000, Math.max(1200, text.length * 32))}ms` }}>{text}</span>
    </span>
  );
}

function Sources({ refs, titles, owner, item, related }: { refs: TicketRef[]; titles: Record<string, string>; owner: string | null; item: ThreadData["item"]; related: Related[] }) {
  if (!refs.length && !owner && !item && !related.length) return null;
  return (
    <>
      <div className="k">Fuente</div>
      <div className="dest">
        {item?.url ? (
          <Chip source={item.source} href={item.url} className="tk-src" title={item.title}>
            <Lbl text={item.title} />
            <IcExternal />
          </Chip>
        ) : null}
        {refs.map((r) =>
          r.refType === "ticket" ? (
            <Link key={r.id} className="chip ref tk-src" href={`/tickets?t=${r.target}`} title={`@${r.target} ${titles[r.target] ?? r.label}`}>
              <b>@{r.target}</b>
              <Lbl text={titles[r.target] ?? r.label} />
            </Link>
          ) : r.refType === "url" && normalizeUrl(r.target) ? (
            <Chip key={r.id} source={classify(r.target)?.source} href={normalizeUrl(r.target) ?? undefined} className="tk-src" title={r.label || r.target}>
              <Lbl text={r.label || r.target} />
              <IcExternal />
            </Chip>
          ) : (
            <Chip key={r.id} variant="plain" className="tk-src" title={r.label || r.target}>
              <Lbl text={r.label || r.target} />
            </Chip>
          ),
        )}
        {owner ? (
          <Chip source="claude" className="tk-src" title={`Sesión de Claude · ${owner}`}>
            <Lbl text={`Sesión de Claude · ${owner}`} />
          </Chip>
        ) : null}
      </div>
      {related.length ? (
        <>
          <div className="k">Relacionado</div>
          <div className="dest" aria-label="Relacionado">
            {related.map((x) =>
              x.internal ? (
                <Link key={x.key} className="chip ref tk-src" href={x.href} title={`${x.label} ${x.detail ?? ""}`.trim()}>
                  <b>{x.label}</b>
                  {x.detail ? <Lbl text={x.detail} /> : null}
                </Link>
              ) : (
                <Chip key={x.key} source={x.source} href={x.href} className="tk-rel tk-src" title={x.label}>
                  <Lbl text={x.label} />
                  <IcExternal />
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
        <span key={a.id} className="tk-att-row">
          <a className="tk-att" href={`/api/tickets/${ticketId}/attachments/${a.id}`} target="_blank" rel="noreferrer">
            <IcFile />
            <span className="tk-att-t">{a.filename}</span> <small>{fmtSize(a.size)}</small>
          </a>
          {a.mime === "application/pdf" ? (
            <Link className="tk-att tk-review" href={`/tickets/${ticketId}/pdf/${a.id}`} aria-label={`Revisar ${a.filename}`}>
              Revisar
            </Link>
          ) : null}
        </span>
      ))}
    </div>
  );
}

/** "eligió 1A · 2C", "eligió B", "respondió 2" (his own words): what an answer message of his closed. */
const answeredTag = (qs: TicketQuestion[], all: TicketQuestion[]) => {
  if (!qs.length) return null;
  const many = qs.length > 1 || multiStep(qs[0]!, all);
  const parts = qs.map((q) => (q.chosen ? `${many ? q.n : ""}${q.chosen}` : `${q.n}`));
  return qs.every((q) => q.chosen) ? `eligió ${parts.join(" · ")}` : `respondió ${parts.join(" · ")}`;
};

function Message({ m, fold, card, list, closed, onSetStep, answered, all, picks, onPicks, disabled, onSend, atts, refs, ticketId, titles }: { m: TicketMessage; fold?: boolean; card: TicketQuestion[]; list: Checklist | null; closed: boolean; onSetStep: (s: TicketStep, done: boolean) => Promise<void>; answered: TicketQuestion[]; all: TicketQuestion[]; picks: Picks; onPicks: (p: Picks) => void; disabled: boolean; onSend: (a: QuestionAnswer[]) => void; atts: Attachment[]; refs: TicketRef[]; ticketId: string; titles: Record<string, string> }) {
  const tag = answeredTag(answered, all) ?? (m.chosen ? `eligió ${m.chosen}` : null);
  return (
    <div className="tk-msg">
      <div className="tk-who">
        {m.author === "claude" ? <span className="ln src-claude" style={{ width: 14, background: "var(--c)" }} /> : null}
        {m.author === "claude" ? "Claude" : "Tú"}
        <time>{hm(m.createdAt)}</time>
        {tag ? <span className="tk-chose">{tag}</span> : null}
        {m.kind === "permission_request" ? <span className="tk-chose">pedido de permiso</span> : null}
      </div>
      {m.body && fold ? (
        <>
          <p><MarkdownInline text={firstLine(m.body)} /></p>
          <details className="tk-fold">
            <summary>Ver texto completo</summary>
            <Markdown className="tk-md" text={m.body} />
          </details>
        </>
      ) : m.body ? <Markdown className="tk-md" text={m.body} /> : null}
      {card.length ? <QuestionCard questions={card} picks={picks} onPicks={onPicks} onSend={onSend} disabled={disabled} /> : null}
      {list ? <ChecklistCard checklist={list} disabled={closed} onSet={onSetStep} /> : null}
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
