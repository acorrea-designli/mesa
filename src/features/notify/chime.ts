// A short two-note chime and the longer "Hoy" sound (hoyTone.ts), both made with WebAudio (nothing bundled, nothing remote).
// Browsers keep an AudioContext suspended until the page has had a user gesture (or the site is allowed
// to autoplay). A chime asked for while suspended first tries resume(), which succeeds without a gesture
// when the site may autoplay; if the context stays suspended the chime is skipped (the notification
// still shows) and the Sonido control shows "blocked" until a chime plays or a click unlocks audio.
import { HOY_ATTACK, HOY_FLOOR, HOY_NOTES, HOY_PARTIALS, hoyPartialGain } from "./hoyTone";
import { setSoundBlocked } from "./prefs";

/** How long a chime waits for resume() before it gives up and reports blocked. */
export const RESUME_WAIT_MS = 300;

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) {
      const c = new Ctor();
      // A click that unlocks audio clears the blocked mark right away, not only at the next chime.
      c.onstatechange = () => {
        if (c.state === "running") setSoundBlocked(false);
      };
      ctx = c;
    }
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call once per tab: unlocks audio on the first user gestures. Returns the cleanup. */
export function primeAudio(): () => void {
  const unlock = () => {
    const c = audio();
    if (!c || c.state === "running") return;
    void c.resume().catch(() => undefined);
  };
  const events = ["pointerdown", "keydown"] as const;
  events.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
  return () => events.forEach((e) => window.removeEventListener(e, unlock));
}

/** Resolves true when the context is running, trying resume() for up to RESUME_WAIT_MS if it is not. */
async function running(c: AudioContext): Promise<boolean> {
  const isRunning = () => c.state === "running"; // re-read: the state changes across the await
  if (isRunning()) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([c.resume(), new Promise<void>((done) => (timer = setTimeout(done, RESUME_WAIT_MS)))]);
  } catch {
    /* resume refused */
  } finally {
    clearTimeout(timer);
  }
  return isRunning();
}

function play(c: AudioContext): void {
  const t0 = c.currentTime;
  [880, 1175].forEach((hz, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = hz;
    const start = t0 + i * 0.16;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.32);
  });
}

/** The "Hoy" sound: the notes of hoyTone.ts, each a fundamental and two overtones with the same envelope as the WAV. */
function playHoy(c: AudioContext): void {
  const t0 = c.currentTime;
  for (const n of HOY_NOTES) {
    const start = t0 + n.at;
    for (const [mult, amp] of HOY_PARTIALS) {
      const peak = hoyPartialGain(n, amp);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = n.hz * mult;
      gain.gain.setValueAtTime(HOY_FLOOR, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(peak, HOY_FLOOR), start + HOY_ATTACK);
      gain.gain.exponentialRampToValueAtTime(HOY_FLOOR, start + n.dur);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + n.dur + 0.02);
    }
  }
}

export type Tone = "chime" | "hoy";

/**
 * Plays a tone ("chime" by default, "hoy" for what arrives in Hoy); never throws. A suspended context is resumed first;
 * if it stays suspended the control shows "blocked". Resolves true when the sound was started (the caller then makes the
 * banner silent), false when it was not (blocked, no WebAudio): the OS sound is the fallback.
 */
export function chime(tone: Tone = "chime"): Promise<boolean> {
  return (async () => {
    try {
      const c = audio();
      if (!c) return false; // no WebAudio at all: nothing to unblock, the notification still shows
      if (await running(c)) {
        if (tone === "hoy") playHoy(c);
        else play(c);
        setSoundBlocked(false);
        return true;
      }
      setSoundBlocked(true);
      return false;
    } catch {
      /* no audio: the notification still shows */
      return false;
    }
  })();
}

/** "Probar sonido": the Hoy sound, started from a click (which also unlocks audio). */
export const testHoy = (): Promise<boolean> => chime("hoy");
