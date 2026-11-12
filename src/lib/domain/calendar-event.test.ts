import { describe, expect, it } from "vitest";
import { describeRecurrence, eventBodyProblem, eventWhenLine, formatEventBody, isoInZone, parseEventBody, type EventFields } from "./calendar-event";

const f: EventFields = {
  title: "Meet con Matt",
  start: "2026-11-12T10:00:00-05:00",
  end: "2026-11-12T10:30:00-05:00",
  timeZone: "America/Bogota",
  invitees: ["matt.r@scoutapp.example"],
  meet: true,
};

describe("isoInZone", () => {
  it("writes an instant with its zone's offset", () => {
    expect(isoInZone(Date.parse("2026-11-12T15:00:00Z"), "America/Bogota")).toBe("2026-11-12T10:00:00-05:00");
    expect(isoInZone(Date.parse("2026-07-01T13:00:00Z"), "America/New_York")).toBe("2026-07-01T09:00:00-04:00");
    expect(isoInZone(Date.parse("2026-11-12T15:00:00Z"), "UTC")).toBe("2026-11-12T15:00:00+00:00");
  });
});

describe("event body", () => {
  it("round-trips", () => {
    const body = formatEventBody({ ...f, description: "Revisar el despliegue.\nLlevar el log." });
    expect(body).toBe(
      "Título: Meet con Matt\nInicio: 2026-11-12T10:00:00-05:00\nFin: 2026-11-12T10:30:00-05:00\nZona: America/Bogota\nInvitados: matt.r@scoutapp.example\nMeet: sí\nDescripción: Revisar el despliegue.\nLlevar el log.",
    );
    expect(parseEventBody(body)).toEqual({ ok: true, fields: { ...f, description: "Revisar el despliegue.\nLlevar el log." } });
  });
  it("omits the invitees line when nobody is invited and reads Meet: no", () => {
    const body = formatEventBody({ ...f, invitees: [], meet: false });
    expect(body).not.toContain("Invitados");
    expect(parseEventBody(body)).toEqual({ ok: true, fields: { ...f, invitees: [], meet: false } });
  });
  it("lower-cases and splits invitees", () => {
    const p = parseEventBody(formatEventBody(f).replace("Invitados: matt.r@scoutapp.example", "Invitados: Matt.R@scoutapp.example,  laura@x.co"));
    expect(p.ok && p.fields.invitees).toEqual(["matt.r@scoutapp.example", "laura@x.co"]);
  });
  it.each([
    ["falta el título", (b: string) => b.replace("Título: Meet con Matt\n", "")],
    ["el inicio debe ser", (b: string) => b.replace("2026-11-12T10:00:00-05:00", "mañana a las 10")],
    ["el inicio debe ser", (b: string) => b.replace("2026-11-12T10:00:00-05:00", "2026-11-12T10:00:00")],
    ["el fin debe ser después", (b: string) => b.replace("T10:30:00", "T09:30:00")],
    ["la zona debe ser", (b: string) => b.replace("America/Bogota", "Narnia/Cair")],
    ["invitado inválido", (b: string) => b.replace("matt.r@scoutapp.example", "matt")],
    ["Meet debe ser", (b: string) => b.replace("Meet: sí", "Meet: tal vez")],
    ["campo desconocido", (b: string) => `${b}\nColor: rojo`],
    ["campo repetido", (b: string) => `${b}\nFin: 2026-11-12T11:00:00-05:00`],
  ])("rejects: %s", (problem, mutate) => {
    const r = parseEventBody(mutate(formatEventBody(f)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain(problem);
  });
  it("is null for a good body", () => expect(eventBodyProblem(formatEventBody(f))).toBeNull());
});

// The DRE weekly (t128): Wednesdays 16:00-16:30 Bogota from 2026-11-18 (a Wednesday).
const dre: EventFields = {
  title: "DRE Central & Designli Weekly Check-In",
  start: "2026-11-18T16:00:00-05:00",
  end: "2026-11-18T16:30:00-05:00",
  timeZone: "America/Bogota",
  invitees: ["matt.r@scoutapp.example"],
  meet: true,
  recurrence: "RRULE:FREQ=WEEKLY;BYDAY=WE",
};

describe("recurrence line", () => {
  it("writes Repetir after Meet and before Descripción, only when set", () => {
    const body = formatEventBody({ ...dre, description: "Weekly." });
    expect(body.split("\n").slice(-3)).toEqual(["Meet: sí", "Repetir: RRULE:FREQ=WEEKLY;BYDAY=WE", "Descripción: Weekly."]);
    expect(formatEventBody(f)).not.toContain("Repetir");
    expect(formatEventBody({ ...f, recurrence: "  " })).not.toContain("Repetir");
  });
  it("round-trips the DRE sample", () => {
    const body = formatEventBody({ ...dre, description: "Weekly.\nAgenda en Basecamp." });
    expect(parseEventBody(body)).toEqual({ ok: true, fields: { ...dre, description: "Weekly.\nAgenda en Basecamp." } });
    expect(parseEventBody(formatEventBody(dre))).toEqual({ ok: true, fields: dre });
  });
  it("reads the key case-insensitively and leaves events without it unchanged", () => {
    const p = parseEventBody(formatEventBody(dre).replace("Repetir:", "repetir:"));
    expect(p.ok && p.fields.recurrence).toBe("RRULE:FREQ=WEEKLY;BYDAY=WE");
    const q = parseEventBody(formatEventBody(f));
    expect(q.ok && "recurrence" in q.fields).toBe(false);
  });
  it.each([
    ["debe empezar por RRULE:", "FREQ=WEEKLY;BYDAY=WE"],
    ["debe empezar por RRULE:", "rrule:FREQ=WEEKLY;BYDAY=WE"],
    ["debe empezar por RRULE:", ""],
    ["mayúsculas", "RRULE:freq=weekly;byday=we"],
    ["necesita FREQ", "RRULE:BYDAY=WE"],
    ["FREQ debe ser", "RRULE:FREQ=HOURLY"],
    ["no admite «BYSETPOS»", "RRULE:FREQ=MONTHLY;BYSETPOS=1;BYDAY=WE"],
    ["no admite «BYHOUR»", "RRULE:FREQ=DAILY;BYHOUR=9"],
    ["repite «FREQ»", "RRULE:FREQ=WEEKLY;FREQ=DAILY"],
    ["repite «BYDAY»", "RRULE:FREQ=WEEKLY;BYDAY=WE;BYDAY=TH"],
    ["parte inválida", "RRULE:FREQ=WEEKLY;"],
    ["parte inválida", "RRULE:FREQ=WEEKLY;BYDAY"],
    ["INTERVAL debe ser", "RRULE:FREQ=WEEKLY;INTERVAL=0"],
    ["INTERVAL debe ser", "RRULE:FREQ=WEEKLY;INTERVAL=-2"],
    ["INTERVAL debe ser", "RRULE:FREQ=WEEKLY;INTERVAL=1.5"],
    ["COUNT debe ser", "RRULE:FREQ=WEEKLY;COUNT=0"],
    ["COUNT debe ser", "RRULE:FREQ=WEEKLY;COUNT=1O"],
    ["BYDAY debe ser", "RRULE:FREQ=WEEKLY;BYDAY=XX"],
    ["BYDAY debe ser", "RRULE:FREQ=WEEKLY;BYDAY=WE,WE"],
    ["BYMONTHDAY debe ser", "RRULE:FREQ=MONTHLY;BYMONTHDAY=0"],
    ["BYMONTHDAY debe ser", "RRULE:FREQ=MONTHLY;BYMONTHDAY=32"],
    ["BYMONTH debe ser", "RRULE:FREQ=YEARLY;BYMONTH=13"],
    ["WKST debe ser", "RRULE:FREQ=WEEKLY;WKST=XX"],
    ["COUNT y UNTIL", "RRULE:FREQ=WEEKLY;COUNT=4;UNTIL=20261231"],
    ["UNTIL debe ser YYYYMMDD", "RRULE:FREQ=WEEKLY;UNTIL=2026-12-31"],
    ["UNTIL debe ser YYYYMMDD", "RRULE:FREQ=WEEKLY;UNTIL=20261331"],
    ["UNTIL debe ser YYYYMMDD", "RRULE:FREQ=WEEKLY;UNTIL=20261231T100000"],
    ["UNTIL debe ser después", "RRULE:FREQ=WEEKLY;UNTIL=20261118"],
    ["UNTIL debe ser después", "RRULE:FREQ=WEEKLY;UNTIL=20261101"],
    ["UNTIL debe ser después", "RRULE:FREQ=WEEKLY;UNTIL=20261118T203000Z"],
    ["empieza un WE", "RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
  ])("rejects: %s (%s)", (problem, rule) => {
    const r = parseEventBody(formatEventBody({ ...dre, recurrence: undefined }).replace("Meet: sí", `Meet: sí\nRepetir: ${rule}`));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain(problem);
  });
  it("accepts the rules a calendar series needs", () => {
    for (const rule of [
      "RRULE:FREQ=WEEKLY",
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=MO",
      "RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=10",
      "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261218",
      "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261219T045959Z",
      "RRULE:FREQ=DAILY;INTERVAL=3",
      "RRULE:FREQ=MONTHLY;BYMONTHDAY=18",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=18",
    ])
      expect(eventBodyProblem(formatEventBody({ ...dre, recurrence: rule })), rule).toBeNull();
  });
  it("checks the weekday in the event zone, not in UTC", () => {
    // 20:00 Bogota on a Wednesday is already Thursday in UTC; the rule must name Wednesday.
    const late = { ...dre, start: "2026-11-18T20:00:00-05:00", end: "2026-11-18T20:30:00-05:00", recurrence: "RRULE:FREQ=WEEKLY;BYDAY=WE" };
    expect(eventBodyProblem(formatEventBody(late))).toBeNull();
    expect(eventBodyProblem(formatEventBody({ ...late, recurrence: "RRULE:FREQ=WEEKLY;BYDAY=TH" }))).toContain("empieza un WE");
  });
  it("does not check BYDAY against the start for a non-weekly rule", () => {
    expect(eventBodyProblem(formatEventBody({ ...dre, recurrence: "RRULE:FREQ=MONTHLY;BYDAY=MO" }))).toBeNull();
  });
});

describe("describeRecurrence", () => {
  it.each([
    ["RRULE:FREQ=WEEKLY;BYDAY=WE", "Cada semana, los miércoles"],
    ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TH,MO", "Cada 2 semanas, lunes y jueves"],
    ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR", "Cada semana, lunes, miércoles y viernes"],
    ["RRULE:FREQ=WEEKLY;BYDAY=SA", "Cada semana, los sábados"],
    ["RRULE:FREQ=WEEKLY", "Cada semana"],
    ["RRULE:FREQ=MONTHLY;BYMONTHDAY=5", "Cada mes, el día 5"],
    ["RRULE:FREQ=MONTHLY;BYMONTHDAY=5,20", "Cada mes, los días 5 y 20"],
    ["RRULE:FREQ=DAILY", "Cada día"],
    ["RRULE:FREQ=DAILY;INTERVAL=3", "Cada 3 días"],
    ["RRULE:FREQ=YEARLY;INTERVAL=2;BYMONTH=3;BYMONTHDAY=8", "Cada 2 años, el día 8, en marzo"],
    ["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261218", "Cada semana, los miércoles, hasta el 18 dic 2026"],
    ["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=10", "Cada semana, los miércoles, 10 veces"],
    ["RRULE:FREQ=MONTHLY;BYMONTHDAY=5;COUNT=1", "Cada mes, el día 5, 1 vez"],
  ])("%s -> %s", (rule, text) => expect(describeRecurrence(rule)).toBe(text));
  it("places a UNTIL with a time in the event zone", () => {
    expect(describeRecurrence("RRULE:FREQ=WEEKLY;UNTIL=20261219T020000Z", "America/Bogota")).toBe("Cada semana, hasta el 18 dic 2026");
    expect(describeRecurrence("RRULE:FREQ=WEEKLY;UNTIL=20261219T020000Z")).toBe("Cada semana, hasta el 19 dic 2026");
  });
  it("returns an invalid rule untouched", () => expect(describeRecurrence("every week")).toBe("every week"));
});

describe("eventWhenLine", () => {
  it("says a series repeats and leaves a single event as it was", () => {
    expect(eventWhenLine(dre)).toBe("desde miércoles 18 nov · 16:00–16:30 · cada semana, los miércoles");
    expect(eventWhenLine(f)).toBe("jueves 12 nov · 10:00–10:30");
  });
});
