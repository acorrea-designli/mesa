import { describe, expect, it } from "vitest";
import { normalizePublicUrl, publicUrl } from "./public-url";

describe("MESA_PUBLIC_URL", () => {
  it("keeps the https origin and drops path and trailing slash", () => {
    expect(normalizePublicUrl("https://mesa.example.com")).toBe("https://mesa.example.com");
    expect(normalizePublicUrl(" https://mesa.example.com/ ")).toBe("https://mesa.example.com");
    expect(normalizePublicUrl("https://mesa.example.com/pair?c=x")).toBe("https://mesa.example.com");
  });
  it("is null for unset, http, junk and hosts without a domain", () => {
    for (const v of [undefined, "", "  ", "http://mesa.example.com", "mesa.example.com", "https://localhost", "not a url"]) {
      expect(normalizePublicUrl(v), String(v)).toBeNull();
    }
  });
  it("reads the env", () => {
    expect(publicUrl({ MESA_PUBLIC_URL: "https://mesa.example.com" })).toBe("https://mesa.example.com");
    expect(publicUrl({})).toBeNull();
  });
});
