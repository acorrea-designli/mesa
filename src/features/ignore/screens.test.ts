// Hoy and Tablero read models with ignored projects, and the undo path (un-ignore brings
// rows, band ticks, counts and cards back exactly as they were).
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/sqlite";
import { createRepos, type Repos } from "@/lib/repo";
import { loadHoy } from "../hoy/data";
import { loadTablero } from "../tablero/data";

const NOW = new Date("2026-11-03T15:00:00Z");
const g = globalThis as unknown as { __mesaRepos?: Repos };
let r: Repos;

beforeEach(() => {
  r = createRepos(openDb(":memory:"));
  g.__mesaRepos = r;
  const pr = r.items.create({ source: "github", externalId: "pr:designli/prospec-admin#212", kind: "pr_review", title: "#212 · feat: bulk export", project: "prospec-admin", receivedAt: "2026-11-03T14:00:00Z" }, NOW);
  r.items.create({ source: "slack", externalId: "C0DEPLOY:1730640000.0001", kind: "message", title: "Matt · env var", project: "#deploys", meta: { channel: "#deploys" }, receivedAt: "2026-11-03T14:10:00Z" }, NOW);
  r.items.create({ source: "basecamp", externalId: "5001", kind: "request", title: "Tarifa por milla", project: "Freightmate", receivedAt: "2026-11-03T14:20:00Z" }, NOW);
  r.tasks.create({ title: "Review 212", source: "github", project: "prospec-admin", itemIds: [pr.id] }, NOW);
  r.tasks.create({ title: "Tarifa", source: "basecamp", project: "Freightmate" }, NOW);
});

const hoyIds = () => loadHoy(NOW).rows.filter((x) => x.kind === "item").map((x) => x.subject);

describe("Hoy and Tablero with ignored projects", () => {
  it("offers each row's and card's project with its key and label", () => {
    const hoy = loadHoy(NOW);
    const targets = hoy.rows.map((x) => x.ignore);
    expect(targets).toEqual(
      expect.arrayContaining([
        { source: "github", project: "designli/prospec-admin", label: "prospec-admin" },
        { source: "slack", project: "C0DEPLOY", label: "#deploys" },
        { source: "basecamp", project: "Freightmate", label: "Freightmate" },
      ]),
    );
    const cards = loadTablero(NOW).cards;
    expect(cards.find((c) => c.title === "Review 212")?.ignore).toEqual({ source: "github", project: "designli/prospec-admin", label: "prospec-admin" });
  });

  it("drops the project from rows, band, station counts and the board, lists it, and undo restores everything", () => {
    const before = loadHoy(NOW);
    const boardBefore = loadTablero(NOW);
    expect(before.rows).toHaveLength(3);
    expect(before.stations.inbox).toBe(3);
    expect(before.ignored).toEqual([]);

    const { ignored } = r.ignored.add({ source: "github", project: "designli/prospec-admin", label: "prospec-admin" });
    const hoy = loadHoy(NOW);
    expect(hoy.rows.some((x) => x.ignore?.project === "designli/prospec-admin")).toBe(false);
    expect(hoy.band).toHaveLength(2);
    expect(hoy.stations.inbox).toBe(2);
    expect(hoy.ignored).toEqual([{ id: ignored.id, source: "github", project: "designli/prospec-admin", label: "prospec-admin", hidden: 2 }]);
    expect(loadTablero(NOW).cards.map((c) => c.title)).toEqual(["Tarifa"]);
    expect(r.counts().tablero).toBe(1);

    // Deshacer = DELETE the row.
    r.ignored.remove(ignored.id);
    const after = loadHoy(NOW);
    expect(after.rows).toEqual(before.rows);
    expect(after.stations).toEqual(before.stations);
    expect(after.ignored).toEqual([]);
    expect(loadTablero(NOW).cards).toEqual(boardBefore.cards);
  });

  it("keeps a pending salida of an ignored project on Hoy's salidas group and in Salidas", () => {
    r.sessions.touch({ id: "s1", label: "x" }, NOW);
    const s = r.salidas.create(
      { source: "slack", destination: { kind: "slack_thread", workspace: "Designli", channel: "#deploys", postAs: "Andrés" }, body: "Listo.", ownerSession: "s1" },
      NOW,
    );
    const slackRow = (ids: string[]) => ids.filter((x) => x.includes("Matt · env var"));
    expect(slackRow(hoyIds())).toHaveLength(1);
    r.ignored.add({ source: "slack", project: "C0DEPLOY", label: "#deploys" });
    expect(slackRow(hoyIds())).toHaveLength(0);
    expect(loadHoy(NOW).rows.filter((x) => x.kind === "salida").map((x) => x.id)).toEqual([s.id]);
    expect(r.counts().salidas).toBe(1);
  });
});
