import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/salidas/[id]/route";
import { openDb } from "@/lib/db/sqlite";
import { createRepos } from "@/lib/repo";
import { destinationConfig, loadSalidas, salidaView } from "./read";

const T0 = new Date("2026-11-03T10:00:00.000Z");

describe("salida view carries the destination URL", () => {
  const setup = () => {
    const r = createRepos(openDb(":memory:"));
    const slack = r.salidas.create(
      {
        source: "slack",
        destination: { kind: "slack_thread", workspace: "Designli", channel: "#scout-dev", channelId: "C0SCOUT01", threadTs: "1730640660.118000", postAs: "Andrés" },
        body: "Listo.",
      },
      T0,
    );
    const gh = r.salidas.create({ source: "github", destination: { kind: "github_comment", repo: "designli/scout", pr: 59, postAs: "Andrés" }, body: "LGTM" }, T0);
    return { r, slack, gh };
  };

  it("reads MESA_SLACK_DOMAIN, MESA_BASECAMP_ACCOUNT and MESA_SLACK_TEAM_ID", () => {
    expect(destinationConfig({ MESA_SLACK_DOMAIN: "designli", MESA_BASECAMP_ACCOUNT: "42", MESA_SLACK_TEAM_ID: "T0ABC123" })).toEqual({ slackDomain: "designli", basecampAccount: "42", slackTeamId: "T0ABC123" });
    expect(destinationConfig({})).toEqual({ slackDomain: undefined, basecampAccount: undefined, slackTeamId: undefined });
  });

  it("carries the Abrir conversación links for Slack only, and keeps a draft_created salida in the open list", () => {
    const { r, slack, gh } = setup();
    expect(salidaView(r, slack.id, { slackDomain: "designli", slackTeamId: "T0ABC123" }).conversation).toEqual({
      app: "slack://channel?team=T0ABC123&id=C0SCOUT01&message=1730640660.118000",
      web: "https://designli.slack.com/archives/C0SCOUT01/p1730640660118000",
    });
    expect(salidaView(r, slack.id, {}).conversation).toEqual({ app: null, web: null });
    expect(salidaView(r, gh.id, { slackDomain: "designli", slackTeamId: "T0ABC123" }).conversation).toBeNull();

    r.salidas.transition(slack.id, { type: "approve", version: 1, mode: "draft" }, T0);
    r.salidas.transition(slack.id, { type: "release" }, new Date(T0.getTime() + 25_000));
    r.salidas.transition(slack.id, { type: "drafted" }, new Date(T0.getTime() + 26_000));
    const items = loadSalidas(r, new Date(T0.getTime() + 27_000)).items;
    expect(items.find((s) => s.id === slack.id)).toMatchObject({ status: "draft_created", sendMode: "draft" });
  });

  it("links with the config and shows no link without it", () => {
    const { r, slack, gh } = setup();
    expect(salidaView(r, slack.id, { slackDomain: "designli" }).destinationUrl).toBe("https://designli.slack.com/archives/C0SCOUT01/p1730640660118000");
    expect(salidaView(r, slack.id, {}).destinationUrl).toBeNull();
    expect(salidaView(r, gh.id, {}).destinationUrl).toBe("https://github.com/designli/scout/pull/59");
    expect(loadSalidas(r, T0).items.every((s) => "destinationUrl" in s)).toBe(true);
  });
});

describe("GET /api/salidas/:id exposes destinationUrl", () => {
  afterEach(() => vi.unstubAllEnvs());
  const g = globalThis as unknown as { __mesaRepos?: ReturnType<typeof createRepos> };

  it("carries the URL (config from env) and the permalink after the send", async () => {
    const r = createRepos(openDb(":memory:"));
    g.__mesaRepos = r;
    vi.stubEnv("MESA_SLACK_DOMAIN", "designli");
    const s = r.salidas.create(
      { source: "slack", destination: { kind: "slack_thread", workspace: "Designli", channel: "#scout-dev", channelId: "C0SCOUT01", threadTs: "1730640660.118000", postAs: "Andrés" }, body: "Listo." },
      T0,
    );
    const get = async () => (await (await GET(new Request(`http://local/api/salidas/${s.id}`), { params: Promise.resolve({ id: s.id }) })).json()) as { destinationUrl: string | null };
    expect((await get()).destinationUrl).toBe("https://designli.slack.com/archives/C0SCOUT01/p1730640660118000");
    vi.stubEnv("MESA_SLACK_DOMAIN", "");
    expect((await get()).destinationUrl).toBeNull();
  });
});
