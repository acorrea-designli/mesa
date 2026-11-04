import { describe, expect, it } from "vitest";
import { ignoreLabel, ignoredCountLabel, ignoredDetail, ignoreTarget } from "./model";

describe("ignore model", () => {
  it("targets the project key and labels it with what the row shows", () => {
    expect(ignoreTarget({ source: "github", project: "prospec-admin", projectKey: "designli/prospec-admin" })).toEqual({
      source: "github",
      project: "designli/prospec-admin",
      label: "prospec-admin",
    });
    expect(ignoreTarget({ source: "github", project: "", projectKey: "designli/scout" })?.label).toBe("scout");
    expect(ignoreTarget({ source: "slack", project: "", projectKey: "C1", meta: { channel: "#deploys" } })).toEqual({ source: "slack", project: "C1", label: "#deploys" });
    expect(ignoreTarget({ source: "basecamp", project: "Freightmate", projectKey: "Freightmate" })?.label).toBe("Freightmate");
    expect(ignoreTarget({ source: "claude", project: "", projectKey: "" })).toBeNull();
  });

  it("writes the Spanish copy", () => {
    expect(ignoreLabel({ label: "scout" })).toBe("Ignorar proyecto «scout»");
    expect(ignoredCountLabel(1)).toBe("1 ignorado");
    expect(ignoredCountLabel(3)).toBe("3 ignorados");
    expect(ignoredDetail({ id: "i", source: "github", project: "designli/scout", label: "scout", hidden: 2 })).toBe("GitHub · designli/scout · 2 ocultos");
    expect(ignoredDetail({ id: "i", source: "*", project: "bseen", label: "bseen", hidden: 0 })).toBe("Todas las fuentes · nada abierto");
  });
});
