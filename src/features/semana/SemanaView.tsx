"use client";
// Semana: the week's done work, drawn first and listed after. Hero (the week's total, today's in mute), the seven day
// columns, ranked bars per kind and per project, then the detail grouped by project. The week, the project and an
// optional day live in the URL (?semana=, ?proyecto=, ?dia=), so every state is a link; the project bars and the day
// columns are the filters. "Copiar" puts the selection on the clipboard as plain text for a client update.
// Every class carries the hc- prefix: the page never shares a name with the global button modifiers (.btn.sm).
import { useState } from "react";
import Link from "next/link";
import { Btn, cx, srcClass } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/interactive";
import { semanaHref } from "./href";
import type { DayView, EntryView, ProjectView, SemanaData } from "./read";

export { semanaHref };

const SOURCE_NAME = { claude: "Claude", github: "GitHub", slack: "Slack", basecamp: "Basecamp" } as const;
/** Up to this many rows per project show; a project with a couple more than that shows them all. */
const SHOWN = 6;
const SLACK = 2;

const things = (n: number) => `${n} ${n === 1 ? "cosa hecha" : "cosas hechas"}`;

function DayColumns({ data }: { data: SemanaData }) {
  const max = Math.max(1, ...data.days.map((d) => d.count));
  const picked = data.day !== null;
  const here = data.week.current ? null : data.week.monday;
  return (
    <section className="hc-block" aria-label="Semana, por día">
      <div className="hc-block-head">
        <h2 className="hc-h">Semana, por día</h2>
        {data.day ? (
          <Link className="hc-back" href={semanaHref(here, data.project)} scroll={false}>
            Ver la semana completa
          </Link>
        ) : null}
      </div>
      <ol className={cx("hc-days", picked && "picked")}>
        {data.days.map((d) => (
          <li key={d.day} className={cx(d.today && "today", d.selected && "sel")}>
            <Day d={d} max={max} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Day({ d, max }: { d: DayView; max: number }) {
  const full = `${d.label}: ${d.future ? "aún nada" : things(d.count)}`;
  const inner = (
    <>
      <span className="hc-plot" aria-hidden="true">
        {d.count > 0 ? (
          <>
            <span className="hc-day-val">{d.count}</span>
            <i style={{ height: `${Math.max(3, (d.count / max) * 100)}%` }} />
          </>
        ) : (
          <em className="hc-dots" />
        )}
        <span className="hc-tip">{full}</span>
      </span>
      <span className="hc-day-lbl" aria-hidden="true">
        {d.label}
      </span>
    </>
  );
  return d.href ? (
    <Link className="hc-day" href={d.href} scroll={false} title={full} aria-label={full} aria-current={d.selected ? "true" : undefined}>
      {inner}
    </Link>
  ) : (
    <span className="hc-day" tabIndex={0} title={full} aria-label={full} aria-current={d.today ? "date" : undefined}>
      {inner}
    </span>
  );
}

function Bar({ count, max }: { count: number; max: number }) {
  return (
    <span className="hc-track" aria-hidden="true">
      {count > 0 ? <i style={{ width: `${Math.max(1, (count / max) * 100)}%` }} /> : <em className="hc-dots" />}
    </span>
  );
}

function KindBars({ data }: { data: SemanaData }) {
  const max = Math.max(1, ...data.kinds.map((k) => k.count));
  return (
    <section className="hc-block" aria-label="Qué se hizo">
      <div className="hc-block-head">
        <h2 className="hc-h">Qué se hizo</h2>
      </div>
      <ol className="hc-rank">
        {data.kinds.map((k) => (
          <li key={k.kind} title={`${k.label}: ${k.count}`}>
            <div className="hc-r">
              <span className="hc-name">{k.label}</span>
              <Bar count={k.count} max={max} />
              <b className="hc-val">{k.count}</b>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ProjectBars({ data }: { data: SemanaData }) {
  const max = Math.max(1, ...data.projects.map((p) => p.count));
  const here = data.week.current ? null : data.week.monday;
  const day = data.day?.key ?? null;
  return (
    <section className="hc-block" aria-label="Por proyecto">
      <div className="hc-block-head">
        <h2 className="hc-h">Por proyecto</h2>
        <Link className={cx("hc-all", !data.project && "on")} href={semanaHref(here, null, day)} scroll={false} aria-current={!data.project ? "true" : undefined}>
          Todos <b>{data.projectsTotal}</b>
        </Link>
      </div>
      <ol className="hc-rank">
        {data.projects.map((p) => {
          const on = data.project === p.name;
          return (
            <li key={p.name}>
              <Link
                className={cx("hc-r", "link", on && "on")}
                href={semanaHref(here, on ? null : p.name, day)}
                scroll={false}
                aria-current={on ? "true" : undefined}
                title={`${p.name}: ${p.count}${on ? " · quitar el filtro" : ""}`}
              >
                <span className="hc-name">{p.name}</span>
                <Bar count={p.count} max={max} />
                <b className="hc-val">{p.count}</b>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Row({ e, time }: { e: EntryView; time: boolean }) {
  const source = SOURCE_NAME[e.source];
  return (
    <li className="hc-row">
      <time className="hc-when" dateTime={e.at}>
        {time ? e.time : e.date}
      </time>
      <span className={cx("hc-ln", srcClass(e.source))} role="img" aria-label={source} title={source} />
      <span className="hc-what">
        <span className="hc-tag">{e.tag}</span> <span className="hc-title">{e.name}</span>
      </span>
      {e.href ? (
        e.external ? (
          <a className="lk hc-open" href={e.href} target="_blank" rel="noreferrer">
            Abrir
          </a>
        ) : (
          <Link className="lk hc-open" href={e.href}>
            Ticket
          </Link>
        )
      ) : null}
    </li>
  );
}

function Project({ g, time }: { g: ProjectView; time: boolean }) {
  const [open, setOpen] = useState(false);
  const all = open || g.entries.length <= SHOWN + SLACK;
  const rows = all ? g.entries : g.entries.slice(0, SHOWN);
  return (
    <section className="hc-proj" aria-label={g.name}>
      <header>
        <h3>
          {g.name} <b>{g.count}</b>
        </h3>
        <p>{g.breakdown}</p>
      </header>
      <ul>
        {rows.map((e) => (
          <Row key={`${e.kind}:${e.id}`} e={e} time={time} />
        ))}
      </ul>
      {all ? null : (
        <button type="button" className="hc-more" onClick={() => setOpen(true)} aria-label={`Mostrar ${g.entries.length - SHOWN} más de ${g.name}`}>
          + {g.entries.length - SHOWN} más
        </button>
      )}
    </section>
  );
}

export function SemanaView({ data }: { data: SemanaData }) {
  const toast = useToast();
  const { week, project } = data;
  const none = data.groups.length === 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(data.text);
      toast({ text: data.day ? "Día copiado" : "Semana copiada" });
    } catch {
      toast({ text: "No se pudo copiar" });
    }
  }

  return (
    <div className="hc">
      <header className="hc-head">
        <h1>
          Semana <span>{week.label}</span>
        </h1>
        <nav className="hc-weeks" aria-label="Semana">
          <Link className="btn sm hc-b" href={semanaHref(week.prev, project)} aria-label="Semana anterior">
            ‹ Anterior
          </Link>
          {week.next ? (
            <Link className="btn sm hc-b" href={semanaHref(week.next, project)} aria-label="Semana siguiente">
              Siguiente ›
            </Link>
          ) : (
            <span className="btn sm hc-b is-off" aria-disabled="true" aria-label="Semana siguiente">
              Siguiente ›
            </span>
          )}
        </nav>
        <Btn size="sm" className="hc-b hc-copy" onClick={copy} disabled={!data.text}>
          Copiar
        </Btn>
      </header>

      <div className="hc-body">
        <div className="hc-top">
          <div className="hc-hero">
            <p className="hc-hero-row" title={things(data.total)}>
              <b className="hc-num">{data.total}</b>
              <span className="hc-hero-lbl">en la semana</span>
            </p>
            {data.todayCount !== null ? (
              <p className="hc-sub">
                <b>{data.todayCount}</b> hoy
              </p>
            ) : null}
            {project ? <p className="hc-sub">solo {project}</p> : null}
          </div>
          <DayColumns data={data} />
        </div>

        {none ? <p className="hc-empty">{data.day ? "No hubo nada hecho ese día." : week.current ? "Aún no hay nada hecho esta semana." : "No hubo nada hecho esta semana."}</p> : null}

        {data.kinds.length || data.projects.length ? (
          <div className="hc-mid">
            {data.kinds.length ? <KindBars data={data} /> : null}
            {data.projects.length ? <ProjectBars data={data} /> : null}
          </div>
        ) : null}

        {none ? null : (
          <section className="hc-detail" aria-label="Detalle">
            <h2 className="hc-h">{data.day ? `Detalle · ${data.day.label}` : "Detalle"}</h2>
            {data.groups.map((g) => (
              <Project key={g.name} g={g} time={data.showTime} />
            ))}
            <p className="hc-legend" aria-hidden="true">
              {(["claude", "github", "slack", "basecamp"] as const).map((s) => (
                <span key={s}>
                  <i className={cx("hc-ln", srcClass(s))} /> {SOURCE_NAME[s]}
                </span>
              ))}
            </p>
          </section>
        )}
        {data.hasSample ? <p className="hc-sample">Datos de muestra.</p> : null}
      </div>
    </div>
  );
}
