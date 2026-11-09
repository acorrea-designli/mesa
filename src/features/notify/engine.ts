"use client";
// The notifier of one Mesa tab: reads the waiting set, asks decide() what is new, shows it.
//
// Several tabs may be open, so three things are shared through the browser:
//   - `seen` (localStorage): the keys already handled; read, decided and written under a lock.
//   - leadership: only one tab notifies (navigator.locks; without it a localStorage heartbeat).
//   - "someone is looking": a visible, focused tab beats in localStorage; while it does (or this
//     tab is itself visible and focused) new entries are remembered but not shown, because the
//     screen updates live.
import { fetchWaiting } from "./collect";
import { decide, type Seen, type Shown } from "./decide";

const SEEN_KEY = "mesa.notify.seen";
const LEADER_KEY = "mesa.notify.leader";
const LOOKING_KEY = "mesa.notify.looking";
const SEEN_LOCK = "mesa-notify-seen";
const LEADER_LOCK = "mesa-notifier";
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
  /** A change arrived (SSE frame or poll tick): rescan soon. */
  poke(): void;
  stop(): void;
}

export function startNotifier(navigate: (url: string) => void): Engine {
  let stopped = false;
  let leader = false;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let memorySeen: Seen = {}; // when localStorage is unavailable
  const sandbox = document.documentElement.dataset.env === "sandbox";

  const show = (s: Shown) => {
    if (stopped || typeof window.Notification === "undefined" || window.Notification.permission !== "granted") return;
    try {
      const n = new window.Notification(s.title, { body: s.body, tag: s.key });
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

  const scan = async (mode: "baseline" | "normal") => {
    try {
      await withLock(SEEN_LOCK, async () => {
        const seen = loadSeen(memorySeen);
        const waiting = await fetchWaiting(mode === "normal" ? seen : null);
        if (stopped) return;
        const d = decide({ seen, waiting, now: Date.now(), baseline: mode === "baseline", quiet: looking() || othersLooking(), sandbox });
        memorySeen = d.seen;
        store.set(SEEN_KEY, JSON.stringify(d.seen));
        d.show.forEach(show);
      });
    } catch {
      /* a list could not be read: keep what we had, the next change retries */
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
        if (!stopped && leader) await scan("normal");
      } while (again && !stopped);
    } finally {
      running = false;
    }
  };

  // ----- who is looking -----
  const beat = () => {
    if (looking()) store.set(LOOKING_KEY, `${tabId}:${Date.now()}`);
    else if ((store.get(LOOKING_KEY) ?? "").startsWith(`${tabId}:`)) store.del(LOOKING_KEY);
  };
  const beatTimer = setInterval(beat, BEAT_MS);
  window.addEventListener("focus", beat);
  window.addEventListener("blur", beat);
  document.addEventListener("visibilitychange", beat);
  beat();

  // ----- leadership -----
  const becomeLeader = () => {
    if (stopped || leader) return;
    leader = true;
    void run();
  };
  let releaseLock: (() => void) | null = null;
  const abort = new AbortController();
  let leaderTimer: ReturnType<typeof setInterval> | null = null;
  const claim = () => {
    const [id, ts] = (store.get(LEADER_KEY) ?? "").split(":");
    if (!id || id === tabId || Date.now() - Number(ts) > STALE_MS) {
      store.set(LEADER_KEY, `${tabId}:${Date.now()}`);
      becomeLeader();
    } else leader = false;
  };
  const startLeadership = () => {
    if (navigator.locks) {
      navigator.locks
        .request(LEADER_LOCK, { signal: abort.signal }, () => {
          becomeLeader();
          return new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
        })
        .catch(() => undefined);
    } else {
      claim();
      leaderTimer = setInterval(claim, BEAT_MS);
    }
  };

  // Baseline first (what already waits is not news), then take part in the leader election.
  void scan("baseline").then(() => {
    if (!stopped) startLeadership();
  });

  return {
    poke() {
      if (stopped || !leader) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), DEBOUNCE_MS);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearInterval(beatTimer);
      if (leaderTimer) clearInterval(leaderTimer);
      window.removeEventListener("focus", beat);
      window.removeEventListener("blur", beat);
      document.removeEventListener("visibilitychange", beat);
      abort.abort();
      releaseLock?.();
      if ((store.get(LEADER_KEY) ?? "").startsWith(`${tabId}:`)) store.del(LEADER_KEY);
      if ((store.get(LOOKING_KEY) ?? "").startsWith(`${tabId}:`)) store.del(LOOKING_KEY);
      leader = false;
    },
  };
}
