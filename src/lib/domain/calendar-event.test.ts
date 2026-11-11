import { describe, expect, it } from "vitest";
import { eventBodyProblem, formatEventBody, isoInZone, parseEventBody, type EventFields } from "./calendar-event";

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
