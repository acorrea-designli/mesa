"use client";
// The version this page loaded and whether the server has moved on since. The first good /api/health answer after
// the page loads is "loaded"; later answers (every CHECK_MS while visible, on visibilitychange and on reconnect) are
// compared with it. Nothing reloads by itself, so an open draft is never lost: the banner asks.
import { useSyncExternalStore } from "react";
import { compareVersion, parseVersion, type Version } from "./version";

const CHECK_MS = 30_000;

interface VersionState {
  loaded: Version | null;
  /** The newer build the server reported, or null while it matches. */
  newer: Version | null;
  /** The newer build the person chose "Luego" for, so the banner stays away until an even newer one. */
  postponed: string | null;
}

const SERVER: VersionState = { loaded: null, newer: null, postponed: null };
let state: VersionState = SERVER;
let started = false;
const listeners = new Set<() => void>();

function set(patch: Partial<VersionState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const keyOf = (v: Version) => `${v.sha}@${v.startedAt}`;

async function check() {
  if (document.visibilityState === "hidden") return;
  try {
    // redirect "manual": an expired Access session answers a redirect we must not follow; it is just "no answer" here.
    const res = await fetch("/api/health", { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return;
    const current = parseVersion(await res.json());
    if (!current) return;
    if (!state.loaded) return void set({ loaded: current });
    set({ newer: compareVersion(state.loaded, current) === "changed" ? current : null });
  } catch {
    /* PC unreachable: the tunnel strip says so; the version is checked again next time */
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  void check();
  window.setInterval(() => void check(), CHECK_MS);
  document.addEventListener("visibilitychange", () => void check());
  window.addEventListener("online", () => void check());
}

const subscribe = (l: () => void) => {
  start();
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function postponeNewVersion() {
  if (state.newer) set({ postponed: keyOf(state.newer) });
}

/** Asks the service worker for its own update, then reloads (the shell is network-first, so the new build loads). */
export async function reloadForNewVersion() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    /* no service worker: a plain reload is enough */
  }
  window.location.reload();
}

export function useVersion() {
  const s = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER,
  );
  const showBanner = s.newer !== null && s.postponed !== keyOf(s.newer);
  return { loaded: s.loaded, newer: s.newer, showBanner };
}
