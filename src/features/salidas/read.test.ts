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

  it("reads MESA_SLACK_DOMAIN and MESA_BASECAMP_ACCOUNT", () => {
    expect(destinationConfig({ MESA_SLACK_DOMAIN: "designli", MESA_BASECAMP_ACCOUNT: "42" })).toEqual({ slackDomain: "designli", basecampAccount: "42" });
    expect(destinationConfig({})).toEqual({ slackDomain: undefined, basecampAccount: undefined });
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
