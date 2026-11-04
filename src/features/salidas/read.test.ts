import { describe, expect, it } from "vitest";
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
