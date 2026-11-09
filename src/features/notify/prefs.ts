"use client";
// The browser-notification switch for this browser: the permission the browser holds plus
// Andrés's own on/off preference (localStorage, shared by every Mesa tab). Used by the rail
// control and by the notifier, so both react to a click in any tab.
import { useSyncExternalStore } from "react";
import { browserStorage, readBlocked, readSound, writeBlocked, writeSound } from "./sound";

export const PREF_KEY = "mesa.notify.pref";
const EVENT = "mesa:notify-pref";

/** unsupported: no Notification API · default: not asked yet · on / off: permission granted · denied: blocked in the browser. */
export type NotifyState = "unsupported" | "default" | "on" | "off" | "denied";

function read(): NotifyState {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") return "unsupported";
  const p = window.Notification.permission;
  if (p === "denied") return "denied";
  if (p === "default") return "default";
  try {
    return window.localStorage.getItem(PREF_KEY) === "off" ? "off" : "on";
  } catch {
    return "on";
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function useNotifyState(): NotifyState {
  return useSyncExternalStore(subscribe, read, () => "unsupported");
}

function setPref(value: "on" | "off") {
  try {
    window.localStorage.setItem(PREF_KEY, value);
  } catch {
    /* private mode: the choice lasts until the page closes */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Click on the rail control. The permission prompt only ever comes from here, never on load. */
export async function toggleNotify(state: NotifyState): Promise<void> {
  if (state === "default") {
    const p = await window.Notification.requestPermission();
    if (p === "granted") setPref("on");
    else window.dispatchEvent(new Event(EVENT));
  } else if (state === "off") setPref("on");
  else if (state === "on") setPref("off");
}

// ----- sound (the chime that goes with a notification; default on) -----

const SOUND_EVENT = "mesa:notify-sound";
let soundOverride: boolean | null = null; // set only when localStorage cannot be written: lasts until the page closes

function readSoundNow(): boolean {
  return soundOverride ?? readSound(browserStorage());
}

function subscribeSound(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(SOUND_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(SOUND_EVENT, cb);
  };
}

/** Whether the chime is on, shared by every tab through localStorage. */
export function useSoundOn(): boolean {
  return useSyncExternalStore(subscribeSound, readSoundNow, () => true);
}

/** Whether the notifier should play the chime now. */
export function soundOn(): boolean {
  return readSoundNow();
}

const BLOCKED_EVENT = "mesa:notify-sound-blocked";
let blockedOverride: boolean | null = null; // set only when localStorage cannot be written: lasts until the page closes

function readBlockedNow(): boolean {
  return blockedOverride ?? readBlocked(browserStorage());
}

function subscribeBlocked(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(BLOCKED_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(BLOCKED_EVENT, cb);
  };
}

/** Whether the last chime was blocked by the browser's autoplay policy, shared by every tab. */
export function useSoundBlocked(): boolean {
  return useSyncExternalStore(subscribeBlocked, readBlockedNow, () => false);
}

/** Records (or clears) that the browser blocked the chime. Never throws. */
export function setSoundBlocked(blocked: boolean): void {
  try {
    if (readBlockedNow() === blocked) return;
    blockedOverride = writeBlocked(browserStorage(), blocked) ? null : blocked;
    window.dispatchEvent(new Event(BLOCKED_EVENT));
  } catch {
    /* no window or storage: the chime itself must not fail */
  }
}

export function toggleSound(): void {
  const next = !readSoundNow();
  soundOverride = writeSound(browserStorage(), next) ? null : next;
  window.dispatchEvent(new Event(SOUND_EVENT));
}
