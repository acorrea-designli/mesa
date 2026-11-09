// The "Hoy" sound (t63): what plays when something new arrives in Hoy. One definition, two renderers:
// WebAudio in the tab (chime.ts) and a WAV file for the phone (scripts/render-hoy-tone.mjs ->
// public/sounds/mesa-hoy.wav), so the phone can ring with the same tone. Pure and import-free on purpose:
// the render script loads this file directly with Node's type stripping, so keep it to erasable syntax.
//
// The motif is an original rising bell figure in C major (G4 C5 E5, then a long G5 that rings out with a soft
// C6 above it), about 1.8 s, nothing like the 0.5 s two-note chime. Every note is a fundamental plus two
// partials with a fast attack and an exponential decay.

export interface HoyNote {
  /** Fundamental (Hz). */
  hz: number;
  /** Start (seconds from the beginning). */
  at: number;
  /** Time from the start to silence (seconds). */
  dur: number;
  /** Peak amplitude of the fundamental (0..1). */
  gain: number;
}

export const HOY_NOTES: readonly HoyNote[] = [
  { hz: 392.0, at: 0, dur: 0.5, gain: 0.26 }, // G4
  { hz: 523.25, at: 0.17, dur: 0.5, gain: 0.26 }, // C5
  { hz: 659.25, at: 0.34, dur: 0.6, gain: 0.27 }, // E5
  { hz: 783.99, at: 0.58, dur: 1.2, gain: 0.3 }, // G5, the long ring
  { hz: 1046.5, at: 0.58, dur: 1.0, gain: 0.09 }, // C6 shimmer over it
];

/** Overtones of every note as [multiple of the fundamental, relative amplitude]. */
export const HOY_PARTIALS: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 0.32],
  [3, 0.1],
];

/** Seconds for a note to reach its peak. */
export const HOY_ATTACK = 0.015;
/** The floor of the exponential envelopes (WebAudio cannot ramp to 0). */
export const HOY_FLOOR = 0.0001;
/** Master level of the rendered file, so the sum of the notes never clips. */
export const HOY_MASTER = 0.8;
export const HOY_SAMPLE_RATE = 44100;

/** Seconds until the last note is silent. */
export const hoyDuration = (): number => Math.max(...HOY_NOTES.map((n) => n.at + n.dur));

/** The envelope of a note at time `t` (seconds from its own start): the curve WebAudio draws with exponential ramps. */
export function hoyEnvelope(n: Pick<HoyNote, "dur" | "gain">, t: number): number {
  if (t < 0 || t >= n.dur) return 0;
  if (t < HOY_ATTACK) return HOY_FLOOR * Math.pow(n.gain / HOY_FLOOR, t / HOY_ATTACK);
  return n.gain * Math.pow(HOY_FLOOR / n.gain, (t - HOY_ATTACK) / (n.dur - HOY_ATTACK));
}

const PARTIAL_NORM = HOY_PARTIALS.reduce((sum, [, a]) => sum + a, 0);

/** The mix before the master scale. */
function mix(sampleRate: number): Float32Array {
  const total = Math.ceil((hoyDuration() + 0.05) * sampleRate);
  const out = new Float32Array(total);
  for (const n of HOY_NOTES) {
    const from = Math.floor(n.at * sampleRate);
    const to = Math.min(total, Math.ceil((n.at + n.dur) * sampleRate));
    for (let i = from; i < to; i++) {
      const t = i / sampleRate - n.at;
      const env = hoyEnvelope(n, t);
      let v = 0;
      for (const [mult, amp] of HOY_PARTIALS) v += amp * Math.sin(2 * Math.PI * n.hz * mult * t);
      out[i] = (out[i] ?? 0) + (env * v) / PARTIAL_NORM;
    }
  }
  return out;
}

let scale: number | null = null;

/** The factor that brings the loudest point of the mix to HOY_MASTER. WebAudio multiplies its gains by it too. */
export function hoyScale(): number {
  if (scale === null) {
    let peak = 0;
    for (const v of mix(HOY_SAMPLE_RATE)) peak = Math.max(peak, Math.abs(v));
    scale = peak > 0 ? HOY_MASTER / peak : 1;
  }
  return scale;
}

/** Peak of one partial of a note, as the player sets it (and as the file mixes it). */
export const hoyPartialGain = (n: Pick<HoyNote, "gain">, amp: number): number => (n.gain * amp * hoyScale()) / PARTIAL_NORM;

/** The whole sound as mono samples in [-1, 1]. Deterministic: the same call gives the same numbers. */
export function renderHoy(sampleRate: number = HOY_SAMPLE_RATE): Float32Array {
  const out = mix(sampleRate);
  const k = hoyScale();
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * k;
  return out;
}

/** 16-bit PCM mono WAV bytes of `samples`. */
export function encodeWav(samples: Float32Array, sampleRate: number = HOY_SAMPLE_RATE): Uint8Array {
  const data = samples.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return new Uint8Array(buf);
}
