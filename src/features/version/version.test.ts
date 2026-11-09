import { describe, expect, it } from "vitest";
import { resolveBuild } from "@/lib/version";
import { compareVersion, formatVersion, parseVersion } from "./version";

const A = { sha: "07e984f", startedAt: "2026-11-09T17:00:00.000Z" };

describe("compareVersion", () => {
  it("is same for the identical pair", () => {
    expect(compareVersion(A, { ...A })).toBe("same");
  });
  it("changes on a new sha (a merge)", () => {
    expect(compareVersion(A, { ...A, sha: "1a2b3c4" })).toBe("changed");
  });
  it("changes on a new start time (a restart of the same sha)", () => {
    expect(compareVersion(A, { ...A, startedAt: "2026-11-09T18:00:00.000Z" })).toBe("changed");
  });
  it("is unknown when either side is missing, never a reason to nag", () => {
    expect(compareVersion(null, A)).toBe("unknown");
    expect(compareVersion(A, null)).toBe("unknown");
    expect(compareVersion(null, null)).toBe("unknown");
  });
});

describe("parseVersion", () => {
  it("reads the version of a health body", () => {
    expect(parseVersion({ ok: true, version: A })).toEqual(A);
  });
  it("rejects absent, empty and malformed versions", () => {
    for (const b of [null, {}, { version: null }, { version: { sha: "", startedAt: "x" } }, { version: { sha: 1, startedAt: "x" } }, { version: { sha: "abc" } }]) {
      expect(parseVersion(b)).toBeNull();
    }
  });
});

describe("formatVersion", () => {
  it("shows the sha and a readable date", () => {
    const s = formatVersion(A, "es");
    expect(s.startsWith("07e984f · ")).toBe(true);
    expect(s.length).toBeGreaterThan(14);
  });
  it("falls back to the sha on a bad date", () => {
    expect(formatVersion({ sha: "dev", startedAt: "nope" })).toBe("dev");
  });
});

describe("resolveBuild", () => {
  const NOW = Date.parse("2026-11-09T18:00:30Z");
  it("takes the sha and start time from the env serve.mjs sets", () => {
    expect(resolveBuild({ MESA_BUILD_SHA: "07E984F", MESA_STARTED_AT: "2026-11-09T17:00:00Z" }, NOW, 10)).toEqual({ sha: "07e984f", startedAt: "2026-11-09T17:00:00.000Z" });
  });
  it("falls back to dev and the process start when unset or junk", () => {
    expect(resolveBuild({}, NOW, 30)).toEqual({ sha: "dev", startedAt: "2026-11-09T18:00:00.000Z" });
    expect(resolveBuild({ MESA_BUILD_SHA: "not a sha!", MESA_STARTED_AT: "later" }, NOW, 30)).toEqual({ sha: "dev", startedAt: "2026-11-09T18:00:00.000Z" });
  });
});
