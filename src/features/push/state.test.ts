import { describe, expect, it } from "vitest";
import { pushCopy, pushState, sameKey, testResult, unblockSteps, urlBase64ToBytes, type PushInputs } from "./state";

const ok: PushInputs = { api: true, ios: false, standalone: true, worker: "ready", permission: "prompt", server: "enabled", subscribed: false };
const st = (over: Partial<PushInputs> = {}) => pushState({ ...ok, ...over });

describe("pushState", () => {
  it("off when nothing is set up yet, on when subscribed with the permission", () => {
    expect(st()).toBe("off");
    expect(st({ permission: "granted", subscribed: true })).toBe("on");
  });

  it("a subscription without the permission is not on (the browser revoked it)", () => {
    expect(st({ permission: "prompt", subscribed: true })).toBe("off");
  });

  it("blocked when the permission is denied, whatever was subscribed", () => {
    expect(st({ permission: "denied" })).toBe("blocked");
    expect(st({ permission: "denied", subscribed: true })).toBe("blocked");
  });

  it("iPhone outside the installed app asks to install first, before anything else", () => {
    expect(st({ ios: true, standalone: false })).toBe("ios_install");
    expect(st({ ios: true, standalone: false, api: false })).toBe("ios_install");
    expect(st({ ios: true, standalone: true })).toBe("off");
  });

  it("unsupported without the Web Push APIs", () => {
    expect(st({ api: false })).toBe("unsupported");
  });

  it("no keys on the PC (or the sandbox) beats the permission", () => {
    expect(st({ server: "no_keys", permission: "denied" })).toBe("no_keys");
    expect(st({ server: "sandbox" })).toBe("no_keys");
  });

  it("server_error when Mesa did not answer", () => {
    expect(st({ server: "error" })).toBe("server_error");
  });

  it("loading until the server, the worker and the subscription are read", () => {
    expect(st({ server: "loading" })).toBe("loading");
    expect(st({ worker: "unknown" })).toBe("loading");
    expect(st({ subscribed: null })).toBe("loading");
  });

  it("no_worker when no service worker came up", () => {
    expect(st({ worker: "none" })).toBe("no_worker");
  });
});

describe("pushCopy", () => {
  it("offers the right action", () => {
    expect(pushCopy("off", "opera").action).toBe("enable");
    expect(pushCopy("on", "opera").action).toBe("disable");
    for (const s of ["blocked", "unsupported", "no_keys", "ios_install", "loading"] as const) expect(pushCopy(s, "opera").action).toBeUndefined();
  });

  it("blocked on Opera says candado, Notificaciones, Permitir", () => {
    const hint = pushCopy("blocked", "opera").hint ?? "";
    expect(hint).toMatch(/candado/);
    expect(hint).toMatch(/Notificaciones/);
    expect(hint).toMatch(/Permitir/);
    expect(unblockSteps("opera")).toBe(hint);
    expect(unblockSteps("chrome")).not.toBe(unblockSteps("opera"));
  });

  it("names the env variables when the PC has no keys, and the home-screen step on iPhone", () => {
    expect(pushCopy("no_keys", "chrome").hint).toContain("MESA_VAPID_PUBLIC_KEY");
    expect(pushCopy("ios_install", "safari").hint).toMatch(/Agregar a inicio/);
  });
});

describe("keys", () => {
  // 65-byte uncompressed P-256 point, as a VAPID public key is: first byte 0x04.
  const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : (i * 7) % 256));
  const b64url = Buffer.from(bytes).toString("base64url");

  it("decodes a base64url VAPID key", () => {
    expect([...urlBase64ToBytes(b64url)]).toEqual([...bytes]);
  });

  it("recognises a subscription made with the same key, and not another", () => {
    expect(sameKey(bytes.buffer.slice(0), b64url)).toBe(true);
    const other = Buffer.from(Uint8Array.from(bytes, (v) => v ^ 1)).toString("base64url");
    expect(sameKey(bytes.buffer.slice(0), other)).toBe(false);
    expect(sameKey(null, b64url)).toBe(false);
  });
});

describe("testResult", () => {
  it("maps the status of POST /api/push/test", () => {
    expect(testResult(200)).toBe("sent");
    expect(testResult(404)).toBe("gone");
    expect(testResult(409)).toBe("no_keys");
    expect(testResult(502)).toBe("refused");
    expect(testResult(500)).toBe("unreachable");
  });
});
