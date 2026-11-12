import { describe, expect, it } from "vitest";
import { formatMoveBody, isMoveBody, moveBodyProblem, parseMoveBody, type MoveFields } from "./calendar-move";

// The same samples as scripts/hooks/test/mesa-guardrails-calendar-move.test.mjs: the two parsers must stay in step.
const ID = "03fo5onsmpno60suu57ma2ashp";
const f: MoveFields = {
  eventId: ID,
  title: "Weekly Check-In",
  start: "2026-11-13T11:00:00-05:00",
  end: "2026-11-13T11:30:00-05:00",
  timeZone: "America/Bogota",
  notify: true,
};
const BODY = [`Mover: ${ID}`, "Título: Weekly Check-In", "Inicio: 2026-11-13T11:00:00-05:00", "Fin: 2026-11-13T11:30:00-05:00", "Zona: America/Bogota", "Avisar: sí"].join("\n");

describe("move body", () => {
  it("round-trips", () => {
    expect(formatMoveBody(f)).toBe(BODY);
    expect(parseMoveBody(BODY)).toEqual({ ok: true, fields: f });
    expect(parseMoveBody(formatMoveBody({ ...f, notify: false }))).toEqual({ ok: true, fields: { ...f, notify: false } });
    expect(parseMoveBody(BODY.replace("sí", "si")).ok).toBe(true);
  });
  it("is told apart from a new event by its first field", () => {
    expect(isMoveBody(BODY)).toBe(true);
    expect(isMoveBody("Título: Meet con Matt\nInicio: x")).toBe(false);
  });
  it("refuses a malformed body with a Spanish problem", () => {
    const bad: [string, RegExp][] = [
      [BODY.replace(`Mover: ${ID}\n`, ""), /falta el id/],
      [BODY.replace(ID, "has space"), /id de evento inválido/],
      [BODY.replace("11:00:00-05:00", "11:00:00"), /inicio debe ser una fecha ISO/],
      [BODY.replace("11:30:00-05:00", "garbage"), /fin debe ser una fecha ISO/],
      [BODY.replace("11:30:00-05:00", "10:00:00-05:00"), /fin debe ser después/],
      [BODY.replace("America/Bogota", "Narnia/Cair"), /zona debe ser una zona IANA/],
      [BODY.replace("Avisar: sí", "Avisar: quizá"), /Avisar debe ser sí o no/],
      [BODY.replace("\nAvisar: sí", ""), /Avisar debe ser sí o no/],
      [BODY.replace("Título: Weekly Check-In\n", ""), /falta el título/],
      [`${BODY}\nInvitados: a@b.co`, /solo de eventos nuevos/],
      [`${BODY}\nMeet: sí`, /solo de eventos nuevos/],
      [`${BODY}\nDescripción: x`, /solo de eventos nuevos/],
      [`${BODY}\nColor: rojo`, /campo desconocido/],
      [`${BODY}\nAvisar: no`, /campo repetido/],
    ];
    for (const [body, re] of bad) {
      const p = parseMoveBody(body);
      expect(p.ok, body).toBe(false);
      if (!p.ok) expect(p.problem).toMatch(re);
    }
  });
  it("moveBodyProblem is null for a good body", () => {
    expect(moveBodyProblem(BODY)).toBeNull();
    expect(moveBodyProblem("nada")).not.toBeNull();
  });
});
