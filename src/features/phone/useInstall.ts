"use client";
// One shared source of install state for the banner and the /telefono entry. `beforeinstallprompt` can fire before
// any component mounts, so the listener is attached when this module loads in the browser and the event is kept.
import { useSyncExternalStore } from "react";
import { DISMISS_KEY, detectPlatform, offerKind, type Platform } from "./install";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallState {
  ready: boolean;
  standalone: boolean;
  platform: Platform;
  hasPrompt: boolean;
  dismissedRaw: string | null;
}

const SERVER: InstallState = { ready: false, standalone: false, platform: "other", hasPrompt: false, dismissedRaw: null };

let state: InstallState = SERVER;
let deferred: InstallPromptEvent | null = null;
let started = false;
const listeners = new Set<() => void>();

const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function set(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  state = {
    ready: true,
    standalone: isStandalone(),
    platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints),
    hasPrompt: false,
    dismissedRaw: readDismissed(),
  };
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own banner instead of the browser's mini-infobar
    deferred = e as InstallPromptEvent;
    set({ hasPrompt: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    set({ hasPrompt: false, standalone: true });
  });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", () => set({ standalone: isStandalone() }));
}

// Catch the event even if no component has subscribed yet.
if (typeof window !== "undefined") start();

const subscribe = (l: () => void) => {
  start();
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function dismissInstall() {
  const now = new Date().toISOString();
  try {
    localStorage.setItem(DISMISS_KEY, now);
  } catch {
    /* private mode: it just comes back next visit */
  }
  set({ dismissedRaw: now });
}

/** Opens the browser's install dialog (Chrome/Edge/Android). Returns whether the app was installed. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const ev = deferred;
  deferred = null;
  set({ hasPrompt: false });
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  if (outcome === "dismissed") dismissInstall();
  return outcome === "accepted";
}

export function useInstall() {
  const s = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER,
  );
  return { ...s, offer: s.ready ? offerKind(s) : null };
}
