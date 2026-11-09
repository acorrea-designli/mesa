import { describe, expect, it } from "vitest";
import { gateSalidaEvent, isSimulated, simulatedPermalink } from "./sandbox";

const s = { id: "sa_1", source: "slack" as const, permalink: null };

describe("gateSalidaEvent", () => {
  it("live: a real send passes with its permalink; simulated is refused", () => {
    expect(gateSalidaEvent(false, s, { type: "sent", permalink: "https://x/1" })).toEqual({ ok: true, event: { type: "sent", permalink: "https://x/1" } });
    expect(gateSalidaEvent(false, s, { type: "sent", simulated: true })).toMatchObject({ ok: false, code: "not_sandbox" });
    expect(gateSalidaEvent(false, s, { type: "sent", simulated: false, permalink: "https://x/1" })).toMatchObject({ ok: true });
  });

  it("sandbox: sent needs simulated and gets a fake permalink, whatever was passed", () => {
    expect(gateSalidaEvent(true, s, { type: "sent", permalink: "https://slack.com/x" })).toMatchObject({ ok: false, code: "sandbox" });
    expect(gateSalidaEvent(true, s, { type: "sent" })).toMatchObject({ ok: false, code: "sandbox" });
    expect(gateSalidaEvent(true, s, { type: "sent", simulated: true })).toEqual({ ok: true, event: { type: "sent", permalink: "sandbox://slack/sa_1" } });
    expect(gateSalidaEvent(true, s, { type: "sent", simulated: true, permalink: "https://slack.com/x" })).toEqual({
      ok: true,
      event: { type: "sent", permalink: "sandbox://slack/sa_1" },
    });
  });

  it("drafted follows the same rule as sent: simulated only in sandbox, with a fake permalink", () => {
    expect(gateSalidaEvent(false, s, { type: "drafted" })).toEqual({ ok: true, event: { type: "drafted" } });
    expect(gateSalidaEvent(false, s, { type: "drafted", simulated: true })).toMatchObject({ ok: false, code: "not_sandbox" });
    expect(gateSalidaEvent(true, s, { type: "drafted" })).toMatchObject({ ok: false, code: "sandbox" });
    expect(gateSalidaEvent(true, s, { type: "drafted", simulated: true })).toEqual({ ok: true, event: { type: "drafted", permalink: "sandbox://slack/sa_1" } });
  });

  it("sandbox: delete and restore only for simulated sends; live is unaffected", () => {
    const real = { ...s, permalink: "https://basecamp.com/1" };
    const fake = { ...s, permalink: simulatedPermalink(s) };
    for (const type of ["request_delete", "deleted", "request_restore", "restored"] as const) {
      expect(gateSalidaEvent(true, real, { type })).toMatchObject({ ok: false, code: "sandbox" });
      expect(gateSalidaEvent(true, fake, { type })).toEqual({ ok: true, event: { type } });
      expect(gateSalidaEvent(false, real, { type })).toEqual({ ok: true, event: { type } });
    }
  });

  it("leaves every other event alone in both modes", () => {
    for (const sandbox of [true, false]) {
      expect(gateSalidaEvent(sandbox, s, { type: "approve", version: 1 })).toEqual({ ok: true, event: { type: "approve", version: 1 } });
      expect(gateSalidaEvent(sandbox, s, { type: "failed", error: "x" })).toMatchObject({ ok: true });
    }
  });

  it("recognises simulated permalinks", () => {
    expect(isSimulated({ permalink: "sandbox://github/sa_2" })).toBe(true);
    expect(isSimulated({ permalink: "https://github.com/x" })).toBe(false);
    expect(isSimulated({ permalink: null })).toBe(false);
  });
});
