import { describe, expect, it } from "vitest";
import { BLOCKED_KEY, SOUND_KEY, readBlocked, readSound, writeBlocked, writeSound, type PrefStorage } from "./sound";

const memory = (initial: Record<string, string> = {}): PrefStorage & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
};

const broken: PrefStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("sound preference", () => {
  it("is on by default", () => {
    expect(readSound(memory())).toBe(true);
    expect(readSound(null)).toBe(true);
  });

  it("only an explicit off silences it", () => {
    expect(readSound(memory({ [SOUND_KEY]: "off" }))).toBe(false);
    expect(readSound(memory({ [SOUND_KEY]: "on" }))).toBe(true);
    expect(readSound(memory({ [SOUND_KEY]: "garbage" }))).toBe(true);
  });

  it("round-trips through storage", () => {
    const s = memory();
    expect(writeSound(s, false)).toBe(true);
    expect(s.data[SOUND_KEY]).toBe("off");
    expect(readSound(s)).toBe(false);
    expect(writeSound(s, true)).toBe(true);
    expect(readSound(s)).toBe(true);
  });

  it("never throws when localStorage does: reads as on, a write reports failure", () => {
    expect(readSound(broken)).toBe(true);
    expect(writeSound(broken, false)).toBe(false);
    expect(writeSound(null, false)).toBe(false);
  });
});

describe("sound blocked flag", () => {
  it("is not blocked by default or when storage is unreadable", () => {
    expect(readBlocked(memory())).toBe(false);
    expect(readBlocked(null)).toBe(false);
    expect(readBlocked(broken)).toBe(false);
    expect(readBlocked(memory({ [BLOCKED_KEY]: "garbage" }))).toBe(false);
  });

  it("round-trips through storage", () => {
    const s = memory();
    expect(writeBlocked(s, true)).toBe(true);
    expect(readBlocked(s)).toBe(true);
    expect(writeBlocked(s, false)).toBe(true);
    expect(readBlocked(s)).toBe(false);
  });

  it("a write reports failure instead of throwing", () => {
    expect(writeBlocked(broken, true)).toBe(false);
    expect(writeBlocked(null, true)).toBe(false);
  });
});
