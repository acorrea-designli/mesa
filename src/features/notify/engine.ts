"use client";
// The notifier of one Mesa tab: reads the waiting set, asks decide() what is new, shows it.
//
// Several tabs may be open, so these are shared through the browser (localStorage):
//   - `seen`: the keys already handled; read, decided and written under a lock, so every tab
//     may scan on its own pokes (a tab whose stream is down still gets the news from the others)
//     and each entry is still shown once.
//   - the time of the last successful scan by any tab: a load shortly after it (a reload, a Mesa
//     restart that hard-reloads the tab) starts with a normal scan, so what entered waiting in
//     between is shown; an older or missing record means a first enable or a long-closed
//     browser, and the first scan is a silent baseline. A running tab keeps the record fresh.
//   - "someone is looking": a visible, focused tab beats in localStorage; while it does (or this
//     tab is itself visible and focused) new entries are remembered but not shown, because the
//     screen updates live.
import { chime, primeAudio } from "./chime";
import { fetchWaiting } from "./collect";
import { decide, shouldBaseline, type Seen, type Shown } from "./decide";
import { deviceHoldsPush } from "@/features/push/device";
import { soundOn } from "./prefs";

const SEEN_KEY = "mesa.notify.seen";
const LOOKING_KEY = "mesa.notify.looking";
const SCAN_KEY = "mesa.notify.lastScan";
const SEEN_LOCK = "mesa-notify-seen";
const DEBOUNCE_MS = 400;
const BEAT_MS = 2000;
const STALE_MS = 6000;

const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  },
  del(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* private mode */
    }
  },
};

const tabId = Math.random().toString(36).slice(2, 10);
const looking = () => document.visibilityState === "visible" && document.hasFocus();

function loadSeen(memory: Seen): Seen {
  const raw = store.get(SEEN_KEY);
  if (raw === null) return memory;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Seen) : {};
  } catch {
    return {};
  }
}

function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request(name, fn) : fn();
}

export interface Engine {
  /** A change arrived (SSE frame, reconnect or poll tick): rescan soon. */
  poke(): void;
  stop(): void;
}

export function startNotifier(navigate: (url: string) => void): Engine {
  let stopped = false;
  let running = false;
  let again = false;
  let healthy = false; // the last scan read the lists (and there has been one)
  let timer: ReturnType<typeof setTimeout> | null = null;
  let memorySeen: Seen = {}; // when localStorage is unavailable
  const sandbox = document.documentElement.dataset.env === "sandbox";

  // Until one scan succeeds the mode stays what the load decided: a failed baseline is retried as a baseline.
  const record = store.get(SCAN_KEY);
  let mode: "baseline" | "normal" = shouldBaseline(record === null ? null : Number(record), Date.now()) ? "baseline" : "normal";

  // A device that holds a push subscription is told by the server (push), so the page stays quiet: no double on one device.
  const canShow = () => !stopped && !deviceHoldsPush() && typeof window.Notification !== "undefined" && window.Notification.permission === "granted";
  const show = (s: Shown) => {
    if (!canShow()) return;
    try {
      // The banner goes away on its own (Andrés, t38: "el banner se queda hasta que le doy dismiss"); Mesa keeps the item.
      const n = new window.Notification(s.title, { body: s.body, tag: s.key, requireInteraction: false });
      window.setTimeout(() => n.close(), 10_000);
      n.onclick = () => {
        window.focus();
        navigate(s.url);
        n.close();
      };
    } catch {
      /* some platforms only allow notifications from a service worker */
    }
  };

  const othersLooking = () => {
    const [id, ts] = (store.get(LOOKING_KEY) ?? "").split(":");
    return Boolean(id) && Date.now() - Number(ts) < STALE_MS;
  };

  const scan = async () => {
    try {
      await withLock(SEEN_LOCK, async () => {
        const seen = loadSeen(memorySeen);
        const waiting = await fetchWaiting(mode === "normal" ? seen : null);
        if (stopped) return;
        const d = decide({ seen, waiting, now: Date.now(), baseline: mode === "baseline", quiet: looking() || othersLooking(), sandbox });
        memorySeen = d.seen;
        store.set(SEEN_KEY, JSON.stringify(d.seen));
        store.set(SCAN_KEY, String(Date.now()));
        mode = "normal";
        healthy = true;
        d.show.forEach(show);
        // One chime per batch, from the tab that showed it (every tab scans; the seen lock lets one show each entry).
        if (d.show.length > 0 && !stopped && soundOn() && canShow()) chime();
      });
    } catch {
      /* a list could not be read: keep what we had, the next change retries */
      healthy = false;
    }
  };

  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        if (!stopped) await scan();
      } while (again && !stopped);
    } finally {
      running = false;
    }
  };

  // ----- who is looking, and the scan record -----
  const beat = () => {
    if (looking()) store.set(LOOKING_KEY, `${tabId}:${Date.now()}`);
    else if ((store.get(LOOKING_KEY) ?? "").startsWith(`${tabId}:`)) store.del(LOOKING_KEY);
    // A tab that is up to date keeps the record fresh: nothing entered waiting that it did not see
    // (every change pokes it), so a reload within minutes still scans normally.
    if (healthy) store.set(SCAN_KEY, String(Date.now()));
  };
  const beatTimer = setInterval(beat, BEAT_MS);
  window.addEventListener("focus", beat);
  window.addEventListener("blur", beat);
  document.addEventListener("visibilitychange", beat);
  beat();
  const unprime = primeAudio();

  // The first scan: a baseline (what already waits is not news) or, after a reload, a normal one.
  void run();

  return {
    poke() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), DEBOUNCE_MS);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearInterval(beatTimer);
      unprime();
      window.removeEventListener("focus", beat);
      window.removeEventListener("blur", beat);
      document.removeEventListener("visibilitychange", beat);
      store.del(SCAN_KEY); // switched off: enabling again later is a first enable, a silent baseline
      if ((store.get(LOOKING_KEY) ?? "").startsWith(`${tabId}:`)) store.del(LOOKING_KEY);
    },
  };
}
