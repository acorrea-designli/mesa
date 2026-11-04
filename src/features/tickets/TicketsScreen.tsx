"use client";
// Tickets A: one stream (never split by direction) + the thread pane.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useToast } from "@/components/ui/interactive";
import { useArrive, usePress } from "@/lib/motion";
import { IcBack, IcEngram, IcPlus } from "@/features/salidas/icons";
import { useLiveRefresh } from "@/features/salidas/live";
import { ticketApi } from "./api";
import { Dir, hm, LivePill, TicketStatus } from "./bits";
import { ComposerBox, useComposer, type SlashAction } from "./Composer";
import type { TicketRow, TicketsData } from "./read";
import { Thread } from "./Thread";

const href = (q: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/tickets?${s}` : "/tickets";
};

export function TicketsScreen({ data, explicit }: { data: TicketsData; explicit: boolean }) {
  const refresh = useLiveRefresh();
  const tab = data.tab === "open" ? undefined : data.tab;
  const sel = data.selected?.ticket;
  const listRef = useArrive<HTMLDivElement>(".tk-row", data.tab);
  const pressRef = usePress<HTMLElement>(".btn, .tab");
  const open = explicit || data.creating;

  return (
    <div className="tk-app" data-open={open ? "1" : undefined}>
      <main className="tk-main" ref={pressRef}>
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
      </main>
      {data.creating ? (
        <NewRequest data={data} tab={tab} />
      ) : data.selected ? (
        <Thread key={data.selected.ticket.id} data={data.selected} listening={data.listening.listening} pick={data.pick} verbs={data.verbs} onChanged={refresh} />
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
        {t.title}
        <small>{t.excerpt}</small>
      </span>
      <span className="t">{hm(t.createdAt)}</span>
      <TicketStatus t={t} />
    </Link>
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
