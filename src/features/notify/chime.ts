// A short two-note chime made with WebAudio (nothing bundled, nothing remote).
// Browsers keep an AudioContext suspended until the page has had a user gesture (or the site is allowed
// to autoplay). A chime asked for while suspended first tries resume(), which succeeds without a gesture
// when the site may autoplay; if the context stays suspended the chime is skipped (the notification
// still shows) and the Sonido control shows "blocked" until a chime plays or a click unlocks audio.
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

/** Plays the chime; never throws. A suspended context is resumed first; if it stays suspended the control shows "blocked". */
export function chime(): void {
  void (async () => {
    try {
      const c = audio();
      if (!c) return; // no WebAudio at all: nothing to unblock, the notification still shows
      if (await running(c)) {
        play(c);
        setSoundBlocked(false);
      } else {
        setSoundBlocked(true);
      }
    } catch {
      /* no audio: the notification still shows */
    }
  })();
}
