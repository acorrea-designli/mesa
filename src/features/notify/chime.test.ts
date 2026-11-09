import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESUME_WAIT_MS } from "./chime";
import { BLOCKED_KEY } from "./sound";

type State = "running" | "suspended";

// A window with only what the chime touches: an AudioContext whose behaviour the test sets, and a localStorage.
function setup(opts: { state: State; resume: "runs" | "hangs" | "rejects" }) {
  const store: Record<string, string> = {};
  const made = { oscillators: 0, resumes: 0 };
  class FakeAudio {
    state: State = opts.state;
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
    resume() {
      made.resumes++;
      if (opts.resume === "rejects") return Promise.reject(new Error("NotAllowedError"));
      if (opts.resume === "hangs") return new Promise<void>(() => undefined);
      this.state = "running";
      return Promise.resolve();
    }
    createOscillator() {
      made.oscillators++;
      const o = { type: "", frequency: { value: 0 }, connect: (x: unknown) => x, start() {}, stop() {} };
      return o;
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x };
    }
  }
  vi.stubGlobal("window", {
    AudioContext: FakeAudio,
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v) },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  });
  return { store, made };
}

// chime() is fire-and-forget: let its promise chain and the resume wait settle.
const settle = async () => {
  await vi.advanceTimersByTimeAsync(RESUME_WAIT_MS + 50);
};

describe("chime", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("plays when the context is running and clears a blocked mark", async () => {
    const { store, made } = setup({ state: "running", resume: "runs" });
    store[BLOCKED_KEY] = "1";
    const { chime } = await import("./chime");
    chime();
    await settle();
    expect(made.oscillators).toBe(2);
    expect(store[BLOCKED_KEY]).toBe("0");
  });

  it("resumes a suspended context and plays when it runs (site allowed to autoplay)", async () => {
    const { store, made } = setup({ state: "suspended", resume: "runs" });
    const { chime } = await import("./chime");
    chime();
    await settle();
    expect(made.resumes).toBe(1);
    expect(made.oscillators).toBe(2);
    expect(store[BLOCKED_KEY]).not.toBe("1");
  });

  it("records blocked, plays nothing and never throws when the context stays suspended", async () => {
    const { store, made } = setup({ state: "suspended", resume: "hangs" });
    const { chime } = await import("./chime");
    expect(() => chime()).not.toThrow();
    await settle();
    expect(made.oscillators).toBe(0);
    expect(store[BLOCKED_KEY]).toBe("1");
  });

  it("a rejected resume counts as blocked", async () => {
    const { store, made } = setup({ state: "suspended", resume: "rejects" });
    const { chime } = await import("./chime");
    chime();
    await settle();
    expect(made.oscillators).toBe(0);
    expect(store[BLOCKED_KEY]).toBe("1");
  });

  it("does nothing without WebAudio", async () => {
    vi.stubGlobal("window", {});
    const { chime } = await import("./chime");
    expect(() => chime()).not.toThrow();
    await settle();
  });
});
