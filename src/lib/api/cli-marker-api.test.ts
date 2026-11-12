// t122: only Andrés's real clicks count as interaction. A request from the Mesa CLI (header `x-mesa-client: cli`,
// sent by bin/mesa and the team scripts) never stamps lastInteractionAt; the same request without it does.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as SELECT } from "@/app/api/salidas/[id]/select/route";
import { POST as DISPATCH } from "@/app/api/tasks/[id]/dispatch/route";
import { POST as MOVE } from "@/app/api/tasks/[id]/move/route";
import { POST as BATCH } from "@/app/api/tasks/batch/route";
import { POST as MESSAGE } from "@/app/api/tickets/[id]/messages/route";
import { openDb } from "../db/sqlite";
import { createRepos, type Repos } from "../repo";

const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;
beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
});

const ctx = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
const req = (path: string, body: unknown, cli: boolean) =>
  new Request(`http://local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cli ? { "x-mesa-client": "cli" } : {}) },
    body: JSON.stringify(body),
  });

// One write per stamping path that the lead's CLI reaches; each runs marked and unmarked.
const writes: Record<string, (cli: boolean) => Promise<Response>> = {
  "task move": (cli) => {
    const t = r.tasks.create({ title: "A", source: "github", station: "inbox" });
    return MOVE(req(`/api/tasks/${t.id}/move`, { station: "doing" }, cli), ctx({ id: t.id }));
  },
  "task batch move": (cli) => {
    const t = r.tasks.create({ title: "A", source: "github", station: "inbox" });
    return BATCH(req("/api/tasks/batch", { action: "move", ids: [t.id], station: "doing" }, cli), ctx());
  },
  dispatch: (cli) => {
    const t = r.tasks.create({ title: "A", source: "github", station: "inbox" });
    return DISPATCH(req(`/api/tasks/${t.id}/dispatch`, {}, cli), ctx({ id: t.id }));
  },
  "ticket message authored as andres": (cli) => {
    const t = r.tickets.create({ direction: "andres_asks", title: "Pide algo", ownerSession: "lead" });
    return MESSAGE(req(`/api/tickets/${t.ref}/messages`, { author: "andres", body: "hola" }, cli), ctx({ id: t.ref }));
  },
  "salida version pick": (cli) => {
    const s = r.salidas.create({ source: "slack", destination: { kind: "slack_channel", workspace: "designli", channel: "#pruebas", postAs: "Andrés" }, body: "uno" });
    r.salidas.addVersion(s.id, { body: "dos", author: "claude" });
    r.db.prepare("DELETE FROM settings WHERE key = 'last_interaction_at'").run(); // creating the versions is not under test
    return SELECT(req(`/api/salidas/${s.id}/select`, { n: 1 }, cli), ctx({ id: s.id }));
  },
};

describe("x-mesa-client: cli", () => {
  for (const [name, write] of Object.entries(writes)) {
    it(`${name}: marked leaves lastInteractionAt alone, unmarked stamps it`, async () => {
      expect(r.lastInteractionAt()).toBeNull();
      const marked = await write(true);
      expect(marked.status, await marked.clone().text()).toBe(200);
      expect(r.lastInteractionAt()).toBeNull();

      const unmarked = await write(false);
      expect(unmarked.status, await unmarked.clone().text()).toBe(200);
      expect(r.lastInteractionAt()).not.toBeNull();
    });
  }
});
