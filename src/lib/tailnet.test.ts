import { describe, expect, it } from "vitest";
import { normalizeTailnetUrl, tailnetUrl, tailnetUrlFromStatus } from "./tailnet";

const status = (o: object) => JSON.stringify(o);

describe("tailnet URL", () => {
  it("reads Self.DNSName from tailscale status", () => {
    expect(tailnetUrlFromStatus(status({ BackendState: "Running", Self: { DNSName: "pc.tail1234.ts.net." } }))).toBe("https://pc.tail1234.ts.net");
  });
  it("is null when Tailscale is stopped, logged out or the output is junk", () => {
    expect(tailnetUrlFromStatus(status({ BackendState: "NeedsLogin", Self: { DNSName: "pc.tail1234.ts.net." } }))).toBeNull();
    expect(tailnetUrlFromStatus(status({ BackendState: "Running", Self: {} }))).toBeNull();
    expect(tailnetUrlFromStatus("not json")).toBeNull();
  });
  it("MESA_TAILNET_URL wins and must be https", async () => {
    const never = async () => {
      throw new Error("should not run");
    };
    expect(await tailnetUrl({ MESA_TAILNET_URL: "https://pc.tail1234.ts.net/" } as unknown as NodeJS.ProcessEnv, never)).toBe("https://pc.tail1234.ts.net");
    expect(normalizeTailnetUrl("http://pc.ts.net")).toBeNull();
    expect(normalizeTailnetUrl("pc.ts.net")).toBeNull();
    expect(normalizeTailnetUrl("")).toBeNull();
  });
  it("falls back to the CLI, trying the next candidate when one is missing", async () => {
    const calls: string[] = [];
    const exec = async (file: string) => {
      calls.push(file);
      return calls.length === 1 ? { code: 1, stdout: "" } : { code: 0, stdout: status({ BackendState: "Running", Self: { DNSName: "pc.tail1234.ts.net." } }) };
    };
    expect(await tailnetUrl({} as NodeJS.ProcessEnv, exec)).toBe("https://pc.tail1234.ts.net");
    expect(calls.length).toBe(2);
  });
  it("is null when no CLI answers", async () => {
    expect(await tailnetUrl({} as NodeJS.ProcessEnv, async () => ({ code: 1, stdout: "" }))).toBeNull();
  });
});
