// The exact text of a calendar salida, drawn as the event it creates (t112): title, when, zone, invitees, Meet. The
// approved body is one field per line (src/lib/domain/calendar-event.ts); this block reads it back so Andrés sees the
// event, not "Título: …". The top stub is the Calendario line colour, like every exact-text block.
import { describeRecurrence, eventWhen, parseEventBody } from "@/lib/domain/calendar-event";
import { isMoveBody, parseMoveBody } from "@/lib/domain/calendar-move";
import "./calendar.css";

const offsetLabel = (iso: string) => {
  const m = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  if (!m) return "UTC";
  return `UTC${m[1] === "-" ? "−" : "+"}${Number(m[2])}${m[3] !== "00" ? `:${m[3]}` : ""}`;
};

export function EventBlock({ text, className }: { text: string; className?: string }) {
  const cls = ["msg", "src-calendar", "cal-event", className].filter(Boolean).join(" ");
  if (isMoveBody(text)) return <MoveBlock text={text} cls={cls} />;
  const p = parseEventBody(text);
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
        {f.recurrence ? (
          <>
            <dt>Se repite</dt>
            <dd>
              {describeRecurrence(f.recurrence, f.timeZone)}
              <code className="cal-ev-rule">{f.recurrence}</code>
            </dd>
          </>
        ) : null}
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

// A move (t131, calendar-move.ts): the event that already exists and the new time, not a new event.
function MoveBlock({ text, cls }: { text: string; cls: string }) {
  const p = parseMoveBody(text);
  if (!p.ok)
    return (
      <div className={cls} aria-label="Evento que se moverá">
        <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>
        <p className="cal-ev-bad">Este movimiento no está completo: {p.problem}. No se puede aprobar hasta que Claude lo arregle.</p>
      </div>
    );
  const f = p.fields;
  return (
    <div className={cls} aria-label="Evento que se moverá">
      <b className="cal-et">{f.title}</b>
      <dl className="cal-ev-dl">
        <dt>Se mueve a</dt>
        <dd>{eventWhen(f)}</dd>
        <dt>Zona</dt>
        <dd>
          {f.timeZone} ({offsetLabel(f.start)})
        </dd>
        <dt>Avisar</dt>
        <dd>{f.notify ? "Sí: Google avisa a los invitados" : "No: se mueve en silencio"}</dd>
      </dl>
    </div>
  );
}
