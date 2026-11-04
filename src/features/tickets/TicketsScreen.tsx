"use client";
// Tickets A: one stream (never split by direction) + the thread pane.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/interactive";
import { useArrive, usePress } from "@/lib/motion";
import { IcBack, IcEngram, IcPlus } from "@/features/salidas/icons";
import { useLiveRefresh } from "@/features/salidas/live";
import { ticketApi } from "./api";
import { Dir, hm, LivePill, statusLabel, TicketStatus } from "./bits";
import { ComposerBox, useComposer, type SlashAction } from "./Composer";
import type { TicketRow, TicketsData } from "./read";
import { Thread } from "./Thread";

const href = (q: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/tickets?${s}` : "/tickets";
};

/** The list stays a rail this long after the composer lets go, so a click that blurs it still lands. */
const RESTORE_MS = 400;

export function TicketsScreen({ data, explicit, pin }: { data: TicketsData; explicit: boolean; pin?: string }) {
  const router = useRouter();
  const refresh = useLiveRefresh();
  const tab = data.tab === "open" ? undefined : data.tab;
  const sel = data.selected?.ticket;
  const listRef = useArrive<HTMLDivElement>(".tk-row", data.tab);
  const pressRef = usePress<HTMLElement>(".btn, .tab");
  const open = explicit || data.creating;

  // Landing view (no ?t=): settle on the ticket shown by putting it in the URL (?p=), so a live
  // refresh after a new ticket or message keeps it instead of falling back to the first row.
  useEffect(() => {
    if (explicit || data.creating || !sel || sel.ref === pin) return;
    router.replace(href({ tab, p: sel.ref }), { scroll: false });
  }, [explicit, data.creating, sel, pin, tab, router]);

  // Opening a ticket (or a message arriving on the one that is open) marks it seen on the server.
  // On the phone the landing view shows the list, not the thread, so nothing is open there.
  const unreadOpen = Boolean(sel && data.selectedUnread);
  const selId = sel?.id;
  useEffect(() => {
    if (!selId || !unreadOpen) return;
    if (!open && window.matchMedia("(max-width: 720px)").matches) return;
    const mark = () => void ticketApi.seen(selId).catch(() => {});
    if (document.visibilityState === "visible") return mark();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onVisible);
      mark();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [selId, unreadOpen, open]);

  // While Andrés writes (composer focused or with text) the list shrinks to a rail.
  const [composing, setComposing] = useState(false);
  const [expanded, setExpanded] = useState(false); // the rail's own control, until he stops writing
  const restore = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false); // a restore is due but focus is still inside the rail
  const startRestore = useCallback(() => {
    if (restore.current) clearTimeout(restore.current);
    restore.current = setTimeout(() => {
      restore.current = null;
      if (document.activeElement?.closest(".tk-rail")) {
        held.current = true; // keyboard focus is on a rail entry: keep the rail mounted until it leaves
        return;
      }
      held.current = false;
      setComposing(false);
      setExpanded(false);
    }, RESTORE_MS);
  }, []);
  // `refocus`: the composer just took focus again, so a list expanded by hand folds back into the rail.
  const onComposing = useCallback(
    (on: boolean, refocus = false) => {
      if (restore.current) clearTimeout(restore.current);
      restore.current = null;
      held.current = false;
      if (on) {
        setComposing(true);
        if (refocus) setExpanded(false);
        return;
      }
      startRestore();
    },
    [startRestore],
  );
  const focusList = useRef(false); // the expand control was used from the keyboard: land on the list
  useEffect(
    () => () => {
      if (restore.current) clearTimeout(restore.current);
    },
    [],
  );
  const rail = composing && !expanded && !data.creating;
  const mainRef = useRef<HTMLElement | null>(null);
  const saved = useRef(0);
  useLayoutEffect(() => {
    // The rail starts at its top; the list gets its place back.
    if (mainRef.current) mainRef.current.scrollTop = rail ? 0 : saved.current;
    if (!rail && focusList.current) {
      focusList.current = false;
      mainRef.current?.querySelector<HTMLElement>(".tk-row.sel, .tk-row")?.focus(); // the control he pressed is gone
    }
  }, [rail]);

  return (
    <div className="tk-app" data-open={open ? "1" : undefined} data-rail={rail ? "1" : undefined}>
      <main
        className="tk-main"
        ref={(el) => {
          mainRef.current = el;
          pressRef.current = el;
        }}
        onScroll={(e) => {
          if (!e.currentTarget.closest("[data-rail]")) saved.current = e.currentTarget.scrollTop;
        }}
      >
        {rail ? (
          <Rail
            rows={[...data.rows, ...data.closedToday]}
            sel={sel?.id}
            tab={tab}
            onExpand={() => {
              focusList.current = Boolean(document.activeElement?.closest(".tk-rail"));
              setExpanded(true);
            }}
            onLeave={() => {
              if (held.current) {
                held.current = false;
                startRestore();
              }
            }}
          />
        ) : null}
        <div className="tk-full">
          <div className="tk-head">
            <h1>
              Tickets<span>Claude y tú, en un solo flujo</span>
            </h1>
            <LivePill listening={data.listening.listening} />
          </div>
          <div className="tk-tools">
            <div className="tabs" role="tablist" aria-label="Tickets">
              <Link role="tab" className="tab" aria-selected={data.tab === "open"} href={href({})}>
                Abiertos {data.counts.open}
              </Link>
              <Link role="tab" className="tab" aria-selected={data.tab === "you"} href={href({ tab: "you" })}>
                Te esperan {data.counts.you}
              </Link>
              <Link role="tab" className="tab" aria-selected={data.tab === "closed"} href={href({ tab: "closed" })}>
                Cerrados hoy {data.counts.closedToday}
              </Link>
            </div>
            <Link className="btn sm tk-new" href={href({ tab, new: "1" })}>
              <IcPlus />
              Nuevo pedido para Claude
            </Link>
          </div>
          <div className="tk-cols" aria-hidden="true">
            <span>ID</span>
            <span>Dirección</span>
            <span>Asunto</span>
            <span>Hora</span>
            <span>Estado</span>
          </div>
          <div ref={listRef} role="list">
            {data.rows.length ? (
              data.rows.map((t) => <Row key={t.id} t={t} sel={!data.creating && sel?.id === t.id} tab={tab} />)
            ) : (
              <div className="tk-blank">
                <svg width="180" height="56" viewBox="0 0 180 56" aria-hidden="true">
                  <path d="M6 20H66l12 12h18" fill="none" stroke="var(--cl)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
                  <path d="M174 44H114l-12-12H90" fill="none" stroke="var(--ink)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
                  <circle cx="90" cy="32" r="10" fill="var(--raise)" stroke="var(--ink)" strokeWidth="3" />
                </svg>
                <h2>{data.tab === "closed" ? "Nada cerrado hoy" : "Nada pendiente entre tú y Claude"}</h2>
                <p>Cuando Claude necesite una decisión aparece aquí. Tú también puedes pedirle algo.</p>
                <Link className="btn p" href={href({ tab, new: "1" })}>
                  <IcPlus />
                  Nuevo pedido para Claude
                </Link>
              </div>
            )}
            {data.closedToday.length ? (
              <>
                <div className="grp">Cerrados hoy</div>
                {data.closedToday.map((t) => (
                  <Row key={t.id} t={t} sel={!data.creating && sel?.id === t.id} tab={tab} />
                ))}
              </>
            ) : null}
          </div>
          {data.rows.some((r) => r.isSample) ? <div className="sample">Datos de muestra.</div> : null}
        </div>
      </main>
      {data.creating ? (
        <NewRequest data={data} tab={tab} />
      ) : data.selected ? (
        <Thread key={data.selected.ticket.id} data={data.selected} listening={data.listening.listening} pick={data.pick} verbs={data.verbs} onChanged={refresh} onComposing={onComposing} />
      ) : (
        <aside className="tk-pane tk-empty">
          <p>Elige un ticket para ver el hilo.</p>
        </aside>
      )}
    </div>
  );
}

function Row({ t, sel, tab }: { t: TicketRow; sel: boolean; tab?: string }) {
  return (
    <Link
      role="listitem"
      href={href({ tab, t: t.ref })}
      className={["tk-row", sel && "sel", t.status === "closed" && "closed"].filter(Boolean).join(" ")}
      aria-current={sel ? "true" : undefined}
      scroll={false}
    >
      <span className="id">{t.ref}</span>
      <Dir direction={t.direction} />
      <span className="subj">
        {t.unread ? <span className="tk-flag">new</span> : null}
        {t.title}
        <small>{t.excerpt}</small>
      </span>
      <span className="t">{hm(t.createdAt)}</span>
      <TicketStatus t={t} />
    </Link>
  );
}

/** The list while he writes: ref, status dot and the "new" flag per ticket; the control expands it. */
function Rail({ rows, sel, tab, onExpand, onLeave }: { rows: TicketRow[]; sel?: string; tab?: string; onExpand: () => void; onLeave: () => void }) {
  return (
    // Mouse presses keep the composer focused (a click on the rail must not end the writing).
    <nav
      className="tk-rail"
      aria-label="Tickets"
      onMouseDown={(e) => e.preventDefault()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onLeave();
      }}
    >
      <button className="tk-rail-open" type="button" aria-label="Mostrar la lista de tickets" aria-expanded="false" title="Mostrar la lista" onClick={onExpand}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 3l5 5-5 5M9 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {rows.map((t) => {
        const isSel = sel === t.id;
        const flag = t.unread && !isSel;
        return (
          <Link
            key={t.id}
            href={href({ tab, t: t.ref })}
            className={["tk-rail-item", isSel && "sel", t.status === "closed" && "closed"].filter(Boolean).join(" ")}
            aria-label={`${t.ref} · ${t.title} · ${statusLabel(t.status)}${flag ? " · nuevo" : ""}`}
            aria-current={isSel ? "true" : undefined}
            title={t.title}
            scroll={false}
          >
            <span className="id">{t.ref}</span>
            <span className="tk-rail-meta" aria-hidden="true">
              <i className={`tk-dot ${t.status}`} />
              {flag ? <span className="tk-flag">new</span> : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function NewRequest({ data, tab }: { data: TicketsData; tab?: string }) {
  const router = useRouter();
  const toast = useToast();
  const c = useComposer();
  const [project, setProject] = useState(data.projects[0] ?? "");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteOnly, setNoteOnly] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  const verbs: SlashAction[] = [
    { key: "archivo", label: "Adjuntar archivo", run: () => fileIn.current?.click() },
    ...data.verbs.map((v) => ({ key: v.toLowerCase().replace(/\s+/g, "-"), label: v, run: () => c.setText(`${c.state.text}${c.state.text ? " " : ""}${v}: `) })),
  ];
  const submit = async () => {
    if (!c.state.text.trim() || busy) return;
    setBusy(true);
    try {
      if (noteOnly) {
        // "Solo anotar (sin agente)": only the card on the Tablero, no ticket and no wake.
        await ticketApi.note({ text: c.state.text, project, link });
        toast({ text: "Anotado en el Tablero · sin agente" });
        router.push("/tablero");
        return;
      }
      const t = await ticketApi.create({ text: c.state.text, project, link, owner: data.listening.owner, state: c.state });
      toast({ text: data.listening.listening ? "Pedido enviado · Claude prepara el plan" : "Pedido guardado · lo recoge la próxima sesión" });
      router.push(href({ tab, t: t.ref }));
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "No se pudo crear el pedido" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="tk-pane" aria-label="Nuevo pedido">
      <Link className="tk-back" href={href({ tab })}>
        <IcBack />
        Tickets
      </Link>
      <div className="tk-scroll">
        <div className="kind">
          <svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true">
            <path d="M2 6H24" fill="none" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />
            <circle cx="28" cy="6" r="4" fill="var(--gnd)" stroke="var(--cl)" strokeWidth="2.4" />
          </svg>
          Nuevo pedido para Claude
        </div>
        <h2>¿Qué necesitas?</h2>
        <div className="tk-form">
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
          <ComposerBox c={c} pick={data.pick} actions={verbs} label="Pedido" placeholder="Pídele algo a Claude: investiga, mueve, crea, revisa…" rows={4} onSubmit={() => void submit()} autoFocus />
          <div className="tk-verbs" aria-label="Acciones frecuentes">
            {data.verbs.map((v) => (
              <button key={v} className="tk-verb" type="button" onClick={() => c.setText(`${c.state.text}${c.state.text ? " " : ""}${v}: `)}>
                {v}
              </button>
            ))}
          </div>
          <label htmlFor="tk-link">
            Relacionar con <span className="opt">(opcional)</span>
          </label>
          <input id="tk-link" className="tk-field" value={link} onChange={(e) => setLink(e.target.value)} placeholder="PR, recording de Basecamp o hilo" />
          <label htmlFor="tk-project">Proyecto</label>
          <input id="tk-project" className="tk-field" list="tk-projects" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Proyecto (scope de engram)" />
          <datalist id="tk-projects">
            {data.projects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <label className="tk-note-only">
            <input type="checkbox" checked={noteOnly} onChange={(e) => setNoteOnly(e.target.checked)} />
            <span>
              Solo anotar (sin agente)
              <small>{noteOnly ? "Solo crea la tarjeta en el Tablero; nadie la trabaja. Los archivos no se guardan." : "Crea el ticket y su tarjeta; el lead le asigna un agente."}</small>
            </span>
          </label>
          {noteOnly ? null : <p className="tk-wait">Cuando Claude lo lea, verás aquí lo que va a hacer (directo o te pide OK) antes de que empiece.</p>}
        </div>
      </div>
      <div className="tk-foot">
        <div className="acts">
          <button className="btn p" type="button" disabled={busy || !c.state.text.trim()} onClick={() => void submit()}>
            {noteOnly ? "Anotar en el Tablero" : "Enviar a Claude"}
          </button>
          <Link className="btn" href={href({ tab })}>
            Cancelar
          </Link>
        </div>
        <div className="meta">
          <span>{data.listening.listening ? "Lo recoge la sesión que esté escuchando." : "Nadie escucha: lo recoge la próxima sesión."}</span>
          <span className="tk-mem">
            <IcEngram />
            Se guarda en engram{project ? ` · ${project}` : ""}
          </span>
        </div>
      </div>
    </aside>
  );
}
