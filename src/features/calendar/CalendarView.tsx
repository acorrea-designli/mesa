"use client";
// Calendario (variant A, "Agenda + pedir"): the week as a line band (one station per day, today burns), the selected
// day (or the whole week) as rows, and a 392 px pane to ask Claude for a meeting in his own words. Read only toward
// Google; a requested meeting comes back as a calendar salida he signs. Spanish UI; the Calendario line colour is
// `--ca`, the fifth source (DESIGN.md).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrokenLine } from "@/components/line/Line";
import { Btn } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/interactive";
import { clockOf, dayLabel, type RepeatChoice } from "@/lib/domain/calendar";
import { localDay } from "@/lib/domain/week";
import { useLiveRefresh } from "@/lib/live/useLive";
import { call } from "@/features/salidas/api";
import { MeetIcon, NextStrip, PeopleIcon, useNow } from "./NextStrip";
import { agendaRows, calendarHref, healthPill, stations, type AgendaRow, type Station } from "./model";
import type { CalendarPageData, MeetingRequest } from "./read";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function CalendarView({ data }: { data: CalendarPageData }) {
  const { payload, day, view } = data;
  useLiveRefresh({ entityTypes: ["calendar", "source", "ticket", "salida"] });
  const now = useNow(payload.now);
  const connected = payload.configured || payload.events.length > 0;
  const pill = healthPill(payload, now);
  const sample = payload.events.some((e) => e.isSample);
  return (
    <div className="cal">
      <div className="cal-main">
        <header className="cal-head">
          <h1>
            Calendario
            <span>
              {dayLabel(localDay(now))} · {clockOf(now)}
            </span>
          </h1>
          <span className={cx("cal-health", pill.off && "off")} role="status">
            {pill.off ? <BrokenLine source="calendar" width={26} title={pill.text} /> : <i className="cal-pulse" aria-hidden="true" />}
            {pill.text}
          </span>
          {payload.configured && !payload.sandbox ? <RefreshButton /> : null}
        </header>

        {connected ? (
          <>
            <NextStrip next={payload.next} nowIso={payload.now} />
            <WeekBand stations={stations(payload.events, day, now)} view={view} />
            <div className="tabs cal-tabs" role="tablist" aria-label="Vista">
              <Link role="tab" aria-selected={view === "hoy"} className={cx("tab", view === "hoy" && "on")} href={calendarHref(day, "hoy")}>
                {day === localDay(now) ? "Hoy" : dayLabel(day)} <b>{agendaRows(payload.events, day, now).length}</b>
              </Link>
              <Link role="tab" aria-selected={view === "semana"} className={cx("tab", view === "semana" && "on")} href={calendarHref(day, "semana")}>
                Semana <b>{weekTotal(stations(payload.events, day, now))}</b>
              </Link>
              <span className="sort">Zona horaria: Bogotá · rechazadas en gris</span>
            </div>
            <Agenda data={data} now={now} />
            {sample ? <p className="cal-sample">Datos de muestra.</p> : null}
            {payload.health === "down" || payload.health === "degraded" ? (
              <div className="alert cal-alert" role="status">
                <p>
                  <b>No pude leer tu calendario{payload.lastRefresh ? ` desde las ${clockOf(payload.lastRefresh)}` : ""}.</b> Muestro lo último guardado; los avisos siguen con esos datos.
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <NotConnected sandbox={payload.sandbox} />
        )}
      </div>
      <RequestPane requests={data.requests} />
    </div>
  );
}

const weekTotal = (s: Station[]) => s.reduce((n, x) => n + x.count, 0);

function RefreshButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const { run } = await call<{ run: { state: string; error?: string } }>("/api/calendar/refresh", { body: {} });
      toast({ text: run.state === "ok" ? "Calendario actualizado" : `No se pudo leer: ${run.error ?? "sin respuesta"}` });
      router.refresh();
    } catch (err) {
      toast({ text: err instanceof Error ? err.message : "No se pudo actualizar" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Btn size="sm" onClick={run} disabled={busy} aria-busy={busy}>
      {busy ? "Leyendo…" : "Actualizar"}
    </Btn>
  );
}

function NotConnected({ sandbox }: { sandbox: boolean }) {
  return (
    <div className="cal-blank">
      <svg width="180" height="56" viewBox="0 0 180 56" aria-hidden="true">
        <path d="M6 28H78" className="sv-ln s-ca sv-dash" />
        <path d="M174 28H114" className="sv-ln s-ca sv-dash" opacity=".55" />
        <circle cx="96" cy="28" r="10" className="sv-ring on" style={{ stroke: "var(--ca)" }} />
        <path d="M78 40L114 16" className="s-ink" strokeWidth="2.5" fill="none" />
      </svg>
      <h2>{sandbox ? "Sandbox: sin lectura de Google" : "Calendario sin conectar"}</h2>
      <p>
        {sandbox
          ? "En el sandbox Mesa no lee tu calendario ni escribe en Google. Con datos de muestra verías reuniones aquí."
          : "Mesa lee tu calendario con la dirección iCal privada de Google. Va en el .env.local de tu PC y nunca sale del servidor. Sin ella no hay reuniones ni avisos."}
      </p>
    </div>
  );
}

function WeekBand({ stations: st, view }: { stations: Station[]; view: "hoy" | "semana" }) {
  const n = st.length;
  const sel = Math.max(0, st.findIndex((s) => s.selected));
  const span = n > 1 ? sel / (n - 1) : 0;
  return (
    <nav className="cal-band" aria-label="Semana" style={{ ["--n" as string]: n, ["--run" as string]: span }}>
      <span className="cal-line" aria-hidden="true" />
      <span className="cal-line on" aria-hidden="true" />
      {st.map((s) => (
        <Link key={s.ymd} href={calendarHref(s.ymd, view)} className={cx("cal-st", s.selected && "sel", s.past && "past")} aria-current={s.selected ? "date" : undefined} aria-label={`${s.name}: ${s.count} ${s.count === 1 ? "reunión" : "reuniones"}`}>
          <span className="cal-st-name">{s.name}</span>
          <span className="cal-cap">{s.count}</span>
          <span className="cal-st-note">{s.note}</span>
        </Link>
      ))}
    </nav>
  );
}

function Agenda({ data, now }: { data: CalendarPageData; now: Date }) {
  const { payload, day, view } = data;
  const days = view === "semana" ? stations(payload.events, day, now).map((s) => s.ymd) : [day];
  const empty = days.every((d) => agendaRows(payload.events, d, now).length === 0);
  return (
    <div className="cal-agenda">
      <div className="cal-cols" aria-hidden="true">
        <span>Hora</span>
        <span>Reunión</span>
        <span>Personas</span>
        <span />
      </div>
      {empty ? <p className="cal-empty">{view === "semana" ? "No hay reuniones esta semana." : "No tienes reuniones este día."} Si quieres agendar algo, pídeselo a Claude con tus palabras.</p> : null}
      {days.map((d) => {
        const rows = agendaRows(payload.events, d, now);
        if (!rows.length) return null;
        return (
          <section key={d} aria-label={dayLabel(d)}>
            {view === "semana" ? <div className="grp">{dayLabel(d)}</div> : null}
            {rows.map((r) => (
              <Row key={r.event.id} r={r} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Row({ r }: { r: AgendaRow }) {
  const e = r.event;
  return (
    <div className={cx("cal-row", r.state)}>
      <span className="t">{r.time}</span>
      <span className="subj">
        {e.title}
        <small>{r.sub}</small>
      </span>
      <span className="cal-n">
        {r.people ? (
          <>
            <PeopleIcon />
            {r.people}
          </>
        ) : null}
      </span>
      <span className="cal-end">
        {r.state === "declined" ? (
          <span className="st off">Rechazada</span>
        ) : r.canJoin && e.meetUrl ? (
          <a className={cx("btn sm", (r.state === "next" || r.state === "now") && "p")} href={e.meetUrl} target="_blank" rel="noopener noreferrer">
            <MeetIcon />
            Unirse
          </a>
        ) : r.state === "past" ? (
          <span className="cal-done">Terminó</span>
        ) : (
          <span className="cal-done">—</span>
        )}
      </span>
    </div>
  );
}

const QUICK = ["1:1 con Laura, 30 min", "Mañana a primera hora", "Con Meet"];

function RequestPane({ requests }: { requests: MeetingRequest[] }) {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [repeat, setRepeat] = useState<RepeatChoice | "">("");
  const [busy, setBusy] = useState(false);
  async function send() {
    const t = text.trim();
    if (t.length < 3 || busy) return;
    setBusy(true);
    try {
      const d = await call<{ ref: string }>("/api/calendar/requests", { body: { text: t, ...(repeat ? { repeat } : {}) } });
      setText("");
      setRepeat("");
      toast({ text: `Pedido enviado a Claude · ${d.ref}` });
      router.refresh();
    } catch (err) {
      toast({ text: err instanceof Error ? err.message : "No se pudo enviar el pedido" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="cal-pane" aria-label="Pedir reunión">
      <div className="kind">
        <i style={{ background: "var(--ca)" }} aria-hidden="true" />
        Pedir reunión
      </div>
      <h2>Cuéntale a Claude qué reunión necesitas</h2>
      <p className="cal-hint">Claude busca el hueco libre en tu calendario y los correos, y te deja el evento exacto en Salidas para tu firma.</p>
      <div className="cal-box">
        <textarea
          aria-label="Pedir reunión"
          placeholder="Por ejemplo: meet con Matt el jueves 30 min"
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <label className="cal-rep">
          <span>Repetir</span>
          <select aria-label="Repetir" value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatChoice | "")}>
            <option value="">No se repite</option>
            <option value="weekly">Cada semana</option>
            <option value="biweekly">Cada 2 semanas</option>
            <option value="monthly">Cada mes</option>
          </select>
        </label>
        <div className="cal-bar">
          <span className="hint">Texto libre · Ctrl+Enter envía</span>
          <Btn variant="primary" size="sm" onClick={send} disabled={busy || text.trim().length < 3}>
            Pedir a Claude
          </Btn>
        </div>
      </div>
      <div className="cal-verbs" aria-label="Pedidos frecuentes">
        {QUICK.map((q) => (
          <button key={q} type="button" className="cal-verb" onClick={() => setText((t) => (t.trim() ? `${t.trim()} ${q.toLowerCase()}` : q))}>
            {q}
          </button>
        ))}
      </div>
      <div className="k">Pedidos recientes</div>
      {requests.length ? (
        requests.map((q) => (
          <div key={q.ref} className="cal-req">
            <div className="cal-rq-h">
              <Link href={`/tickets?t=${encodeURIComponent(q.ref)}`} className="id">
                {q.ref}
              </Link>
              <b>{q.title}</b>
            </div>
            <div className="cal-rq-s">
              {q.statusLabel}
              {q.salidaId ? (
                <>
                  {" "}
                  ·{" "}
                  <Link href={`/salidas?s=${encodeURIComponent(q.salidaId)}`} className="chip src-calendar">
                    Salida · Calendario · por firmar
                  </Link>
                </>
              ) : null}
            </div>
          </div>
        ))
      ) : (
        <p className="cal-hint">Aún no has pedido ninguna.</p>
      )}
      <div className="meta">
        <span>Zona horaria: America/Bogota (UTC−5)</span>
      </div>
    </aside>
  );
}
