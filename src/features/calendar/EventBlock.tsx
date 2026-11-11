// The exact text of a calendar salida, drawn as the event it creates (t112): title, when, zone, invitees, Meet. The
// approved body is one field per line (src/lib/domain/calendar-event.ts); this block reads it back so Andrés sees the
// event, not "Título: …". The top stub is the Calendario line colour, like every exact-text block.
import { eventWhen, parseEventBody } from "@/lib/domain/calendar-event";
import "./calendar.css";

const offsetLabel = (iso: string) => {
  const m = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  if (!m) return "UTC";
  return `UTC${m[1] === "-" ? "−" : "+"}${Number(m[2])}${m[3] !== "00" ? `:${m[3]}` : ""}`;
};

export function EventBlock({ text, className }: { text: string; className?: string }) {
  const p = parseEventBody(text);
  const cls = ["msg", "src-calendar", "cal-event", className].filter(Boolean).join(" ");
  if (!p.ok)
    return (
      <div className={cls} aria-label="Evento que se creará">
        <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>
        <p className="cal-ev-bad">Este evento no está completo: {p.problem}. No se puede aprobar hasta que Claude lo arregle.</p>
      </div>
    );
  const f = p.fields;
  return (
    <div className={cls} aria-label="Evento que se creará">
      <b className="cal-et">{f.title}</b>
      <dl className="cal-ev-dl">
        <dt>Cuándo</dt>
        <dd>{eventWhen(f)}</dd>
        <dt>Zona</dt>
        <dd>
          {f.timeZone} ({offsetLabel(f.start)})
        </dd>
        <dt>Invitados</dt>
        <dd>{f.invitees.length ? f.invitees.join(", ") : "Nadie: solo tú"}</dd>
        <dt>Meet</dt>
        <dd>{f.meet ? "Se crea con el evento" : "Sin Meet"}</dd>
        {f.description ? (
          <>
            <dt>Notas</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{f.description}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
