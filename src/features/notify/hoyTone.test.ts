import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeWav, HOY_NOTES, HOY_SAMPLE_RATE, hoyDuration, hoyEnvelope, renderHoy } from "./hoyTone";

describe("the Hoy sound", () => {
  it("is a 1.2 to 2 s motif, longer and different from the 0.5 s two-note chime", () => {
    expect(hoyDuration()).toBeGreaterThanOrEqual(1.2);
    expect(hoyDuration()).toBeLessThanOrEqual(2);
    const hz = HOY_NOTES.map((n) => n.hz);
    expect(hz).not.toContain(880);
    expect(hz).not.toContain(1175);
    expect(new Set(hz).size).toBeGreaterThanOrEqual(4);
  });

  it("envelopes rise to the peak and decay to silence", () => {
    const n = { dur: 1, gain: 0.3 };
    expect(hoyEnvelope(n, -0.1)).toBe(0);
    expect(hoyEnvelope(n, 0.015)).toBeCloseTo(0.3, 5);
    expect(hoyEnvelope(n, 0.5)).toBeLessThan(0.3);
    expect(hoyEnvelope(n, 0.99)).toBeLessThan(0.001);
    expect(hoyEnvelope(n, 1)).toBe(0);
  });

  it("renders deterministically, without clipping, and ends quiet", () => {
    const a = renderHoy();
    const b = renderHoy();
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    expect(a.length / HOY_SAMPLE_RATE).toBeGreaterThan(hoyDuration());
    expect(a.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThanOrEqual(0.81);
    expect(Math.abs(a[a.length - 1] ?? 1)).toBeLessThan(0.001);
  });

  it("the WAV is 16-bit mono PCM", () => {
    const wav = encodeWav(renderHoy(), HOY_SAMPLE_RATE);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([1, 1, HOY_SAMPLE_RATE, 16]);
    expect(v.getUint32(40, true)).toBe(wav.length - 44);
  });

  it("public/sounds/mesa-hoy.wav is what the committed parameters render (run `pnpm tone:render` when this fails)", () => {
    const file = readFileSync(resolve(__dirname, "../../../public/sounds/mesa-hoy.wav"));
    expect(Buffer.from(encodeWav(renderHoy(), HOY_SAMPLE_RATE)).equals(file)).toBe(true);
  });
});
