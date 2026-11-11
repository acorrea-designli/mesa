"use client";
// "Próxima reunión": the next meeting (or the one in progress) as a strip. Shared by Calendario, Hoy and the phone.
// The server hands over the next event and its own clock; this component only keeps the "en N min" words current.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CalendarEvent } from "@/lib/domain/types";
import { localDay } from "@/lib/domain/week";
import { calendarHref, stripModel } from "./model";
import "./calendar.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Now, re-read every 30 s so "en 18 min" and the ink border at ten minutes stay true without a refresh. */
export function useNow(initialIso: string, everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date(initialIso));
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

export const MeetIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="1.5" y="4" width="8" height="8" rx="1.5" />
    <path d="M9.5 7l5-2.5v7L9.5 9" />
  </svg>
);

export const PeopleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="5.5" r="2.5" />
    <path d="M1.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
    <path d="M11 3.5a2.2 2.2 0 010 4.2M12.5 9.5c1.5.4 2.5 1.6 2.5 3.5" />
  </svg>
);

/** A line that runs into an open ring: the meeting, drawn in the Calendario line colour. */
export const NextMark = () => (
  <svg className="cal-mark" width="44" height="18" viewBox="0 0 44 18" aria-hidden="true">
    <path d="M3 9H27" className="sv-ln s-ca" strokeWidth="4" />
    <circle cx="33" cy="9" r="6" className="sv-ring on" style={{ stroke: "var(--ca)" }} />
  </svg>
);

export function NextStrip({ next, nowIso, className }: { next: CalendarEvent | null; nowIso: string; className?: string }) {
  const now = useNow(nowIso);
  const s = stripModel(next, now);
  const e = s.event;
  const day = e ? localDay(new Date(e.startsAt)) : null;
  if (!e)
    return (
      <section className={cx("cal-strip none", className)} aria-label="Próxima reunión">
        <NextMark />
        <div className="cal-sm">
          <span className="lbl">Próxima reunión</span>
          <b className="cal-t">Sin más reuniones esta semana</b>
        </div>
        <div className="cal-acts">
          <Link className="btn sm" href={calendarHref()}>
            Abrir Calendario
          </Link>
        </div>
      </section>
    );
  return (
    <section className={cx("cal-strip", s.mode === "soon" && "soon", className)} aria-label="Próxima reunión" data-mode={s.mode}>
      <NextMark />
      <div className="cal-sm">
        <span className="lbl">{s.mode === "now" ? "En curso" : "Próxima reunión"}</span>
        <b className="cal-t">{e.title}</b>
        <small>
          <span className="cal-when">{s.when}</span> · {s.time}
          {e.attendeesCount > 0 ? (
            <>
              {" "}
              · <PeopleIcon /> {e.attendeesCount}
            </>
          ) : null}
        </small>
      </div>
      <div className="cal-acts">
        {e.meetUrl ? (
          <a className="btn p sm" href={e.meetUrl} target="_blank" rel="noopener noreferrer">
            <MeetIcon />
            Unirse
          </a>
        ) : null}
        <Link className="btn sm" href={calendarHref(day)}>
          Abrir
        </Link>
      </div>
    </section>
  );
}
