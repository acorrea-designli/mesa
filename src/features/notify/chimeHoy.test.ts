import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESUME_WAIT_MS } from "./chime";
import { HOY_NOTES, HOY_PARTIALS } from "./hoyTone";
import { BLOCKED_KEY } from "./sound";

type State = "running" | "suspended";

function setup(state: State, resume: "runs" | "hangs") {
  const store: Record<string, string> = {};
  const made = { oscillators: 0, freqs: [] as number[] };
  class FakeAudio {
    state: State = state;
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
    resume() {
      if (resume === "hangs") return new Promise<void>(() => undefined);
      this.state = "running";
      return Promise.resolve();
    }
    createOscillator() {
      made.oscillators++;
      const o = {
        type: "",
        frequency: {
          set value(v: number) {
            made.freqs.push(v);
          },
        },
        connect: (x: unknown) => x,
        start() {},
        stop() {},
      };
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

describe("chime('hoy') and testHoy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("plays every note of the Hoy sound with its overtones and resolves true", async () => {
    const { made } = setup("running", "runs");
    const { chime } = await import("./chime");
    await expect(chime("hoy")).resolves.toBe(true);
    expect(made.oscillators).toBe(HOY_NOTES.length * HOY_PARTIALS.length);
    expect(made.freqs).toContain(783.99);
    expect(made.freqs).not.toContain(1175);
  });

  it("the default chime still plays two notes and resolves true", async () => {
    const { made } = setup("running", "runs");
    const { chime } = await import("./chime");
    await expect(chime()).resolves.toBe(true);
    expect(made.oscillators).toBe(2);
  });

  it("resolves false and marks blocked when audio stays suspended (the OS sound stays on)", async () => {
    const { store, made } = setup("suspended", "hangs");
    const { chime } = await import("./chime");
    const played = chime("hoy");
    await vi.advanceTimersByTimeAsync(RESUME_WAIT_MS + 50);
    await expect(played).resolves.toBe(false);
    expect(made.oscillators).toBe(0);
    expect(store[BLOCKED_KEY]).toBe("1");
  });

  it("'Probar sonido' (testHoy) resumes a suspended context from the click and plays the Hoy sound", async () => {
    const { made } = setup("suspended", "runs");
    const { testHoy } = await import("./chime");
    await expect(testHoy()).resolves.toBe(true);
    expect(made.oscillators).toBe(HOY_NOTES.length * HOY_PARTIALS.length);
  });

  it("resolves false without WebAudio", async () => {
    vi.stubGlobal("window", {});
    const { chime } = await import("./chime");
    await expect(chime("hoy")).resolves.toBe(false);
  });
});
