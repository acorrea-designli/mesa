// A calendar MOVE salida over the API (t131): `mesa salida propose --source calendar` accepts a move body and refuses a
// malformed one with a Spanish problem, on the first version and on every new one.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as postSalida } from "@/app/api/salidas/route";
import { openDb } from "../db/sqlite";
import { formatMoveBody, type MoveFields } from "../domain/calendar-move";
import { createRepos, type Repos } from "../repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
const ctx = { params: Promise.resolve({}) };
const post = (body: unknown) =>
  new Request("http://local/api/salidas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const f: MoveFields = {
  eventId: "03fo5onsmpno60suu57ma2ashp",
  title: "Weekly Check-In",
  start: "2026-11-13T11:00:00-05:00",
  end: "2026-11-13T11:30:00-05:00",
  timeZone: "America/Bogota",
  notify: true,
};
const dest = { kind: "calendar_event", calendar: "primary", postAs: "Andrés" };
const propose = (body: string) => postSalida(post({ source: "calendar", destination: dest, body, ownerSession: "lead" }), ctx);

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  r.sessions.touch({ id: "lead" }, new Date());
});

describe("a calendar move salida over the API", () => {
  it("accepts a move body", async () => {
    expect((await propose(formatMoveBody(f))).status).toBe(201);
    expect((await propose(formatMoveBody({ ...f, notify: false }))).status).toBe(201);
  });

  it("rejects a malformed one with a Spanish problem", async () => {
    const body = formatMoveBody(f);
    const bad: [string, RegExp][] = [
      [body.replace(/^Mover: .*\n/, "Mover:\n"), /falta el id del evento/],
      [body.replace("Mover: 03fo5onsmpno60suu57ma2ashp", "Mover: a b"), /id de evento inválido/],
      [body.replace("2026-11-13T11:00:00-05:00", "mañana a las 11"), /el inicio debe ser una fecha ISO/],
      [body.replace("2026-11-13T11:30:00-05:00", "2026-11-13T10:30:00-05:00"), /el fin debe ser después del inicio/],
      [body.replace("America/Bogota", "Narnia/Cair"), /la zona debe ser una zona IANA/],
      [body.replace("Avisar: sí", "Avisar: quizá"), /Avisar debe ser sí o no/],
      [`${body}\nInvitados: boss@example.com`, /solo de eventos nuevos/],
      [`${body}\nMeet: sí`, /solo de eventos nuevos/],
      [`${body}\nDescripción: hola`, /solo de eventos nuevos/],
    ];
    for (const [b, re] of bad) {
      const res = await propose(b);
      expect(res.status, b).toBe(400);
      expect(JSON.stringify(await res.json())).toMatch(re);
    }
  });

  it("checks every new version too, and a move cannot become a half-event", async () => {
    const made = r.salidas.create({ source: "calendar", destination: dest, body: formatMoveBody(f), ownerSession: "lead" } as never);
    const id = made.id;
    expect(r.salidas.addVersion(id, { body: formatMoveBody({ ...f, notify: false }), author: "claude" }).versions).toHaveLength(2);
    expect(() => r.salidas.addVersion(id, { body: `${formatMoveBody(f)}\nMeet: sí`, author: "claude" })).toThrow(/solo de eventos nuevos/);
  });
});
