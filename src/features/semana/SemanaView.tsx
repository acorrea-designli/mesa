"use client";
// Semana: the week's done work, grouped by project then kind. The week and the project filter live in the
// URL (?semana=YYYY-MM-DD&proyecto=...), so every state is a link. "Copiar" puts the filtered week on the
// clipboard as plain text for a client update.
import Link from "next/link";
import { Btn, cx } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/interactive";
import type { EntryView, SemanaData } from "./read";

/** /semana URL for a week and a project; the current week and "Todos" stay out of the query. */
export function semanaHref(week: string | null, project: string | null): string {
  const p = new URLSearchParams();
  if (week) p.set("semana", week);
  if (project) p.set("proyecto", project);
  const s = p.toString();
  return s ? `/semana?${s}` : "/semana";
}

function Line({ e }: { e: EntryView }) {
  return (
    <li className="sm-line">
      <time className="sm-date" dateTime={e.at}>
        {e.date}
      </time>
      <span className="sm-title">{e.title}</span>
      {e.href ? (
        e.external ? (
          <a className="lk" href={e.href} target="_blank" rel="noreferrer">
            Abrir
          </a>
        ) : (
          <Link className="lk" href={e.href}>
            Ticket
          </Link>
        )
      ) : null}
    </li>
  );
}

export function SemanaView({ data }: { data: SemanaData }) {
  const toast = useToast();
  const { week, project } = data;
  // The current week is the default: keep it out of the URL so the bookmark always means "this week".
  const here = week.current ? null : week.monday;

  async function copy() {
    try {
      await navigator.clipboard.writeText(data.text);
      toast({ text: "Semana copiada" });
    } catch {
      toast({ text: "No se pudo copiar" });
    }
  }

  return (
    <div className="sm">
      <header className="sm-head">
        <h1>
          Semana <span>{week.label}</span>
        </h1>
        <nav className="sm-weeks" aria-label="Semana">
          <Link className="btn sm" href={semanaHref(week.prev, project)} aria-label="Semana anterior">
            ‹ Anterior
          </Link>
          {week.next ? (
            <Link className="btn sm" href={semanaHref(week.next, project)} aria-label="Semana siguiente">
              Siguiente ›
            </Link>
          ) : (
            <span className="btn sm is-off" aria-disabled="true" aria-label="Semana siguiente">
              Siguiente ›
            </span>
          )}
        </nav>
        <Btn size="sm" className="sm-copy" onClick={copy} disabled={!data.text}>
          Copiar
        </Btn>
      </header>

      <nav className="sm-chips" aria-label="Proyecto">
        <Link className={cx("sm-chip", !project && "on")} href={semanaHref(here, null)} aria-current={!project ? "true" : undefined}>
          Todos <b>{data.total}</b>
        </Link>
        {data.chips.map((c) => (
          <Link key={c.name} className={cx("sm-chip", project === c.name && "on")} href={semanaHref(here, c.name)} aria-current={project === c.name ? "true" : undefined}>
            {c.name} <b>{c.count}</b>
          </Link>
        ))}
      </nav>

      <div className="sm-body">
        {data.groups.length === 0 ? (
          <p className="sm-empty">{week.current ? "Aún no hay nada hecho esta semana." : "No hubo nada hecho esta semana."}</p>
        ) : (
          data.groups.map((g) => (
            <section key={g.name} className="sm-proj" aria-label={g.name}>
              <h2>
                {g.name} <b>{g.count}</b>
              </h2>
              {g.sections.map((s) => (
                <div key={s.kind} className="sm-kind">
                  <h3>
                    {s.label} <b>{s.entries.length}</b>
                  </h3>
                  <ul>
                    {s.entries.map((e) => (
                      <Line key={`${e.kind}:${e.id}`} e={e} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))
        )}
        {data.hasSample ? <p className="sm-sample">Datos de muestra.</p> : null}
      </div>
    </div>
  );
}
