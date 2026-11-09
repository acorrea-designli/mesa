"use client";
// One shared source of install state for the banner and the /telefono entry. `beforeinstallprompt` can fire before
// any component mounts, so the listener is attached when this module loads in the browser and the event is kept.
// Some browsers (Opera, Samsung Internet, Chrome before its engagement checks) never fire it: after PROMPT_WAIT_MS
// `waited` turns true and the banner falls back to written steps for the detected browser.
import { useSyncExternalStore } from "react";
import { DISMISS_KEY, PHONE_QUERY, PROMPT_WAIT_MS, detectBrowser, detectPlatform, offerKind, type Browser, type Platform, type SwState } from "./install";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallState {
  ready: boolean;
  standalone: boolean;
  platform: Platform;
  browser: Browser;
  phoneSized: boolean;
  secure: boolean;
  hasPrompt: boolean;
  /** PROMPT_WAIT_MS passed since this page loaded. */
  waited: boolean;
  dismissedRaw: string | null;
  sw: SwState;
}

const SERVER: InstallState = {
  ready: false,
  standalone: false,
  platform: "other",
  browser: "other",
  phoneSized: false,
  secure: false,
  hasPrompt: false,
  waited: false,
  dismissedRaw: null,
  sw: "unknown",
};

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

/** Reads the service worker registration (PwaBoot registers it after the page loads, so this runs again later). */
export async function refreshSw() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    set({ sw: "unsupported" });
    return;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    set({ sw: !reg ? "none" : reg.active ? "active" : "registered" });
  } catch {
    set({ sw: "none" });
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const phone = window.matchMedia(PHONE_QUERY);
  state = {
    ready: true,
    standalone: isStandalone(),
    platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints),
    browser: detectBrowser(navigator.userAgent),
    phoneSized: phone.matches,
    secure: window.isSecureContext,
    hasPrompt: false,
    waited: false,
    dismissedRaw: readDismissed(),
    sw: "unknown",
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
  phone.addEventListener("change", () => set({ phoneSized: phone.matches }));
  window.setTimeout(() => {
    set({ waited: true });
    void refreshSw();
  }, PROMPT_WAIT_MS);
  void refreshSw();
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

/** "Mostrar el aviso otra vez": forgets the dismiss so the banner can come back. */
export function resetInstallDismiss() {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* private mode */
  }
  set({ dismissedRaw: null });
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
