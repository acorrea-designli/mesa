// The "Sonido" preference of the notifications: pure, over any Storage-like object so it can be tested.
// Default on; only an explicit "off" silences. Every access is guarded: localStorage can throw
// (private mode, blocked storage) and the choice then simply lasts until the page closes.

export const SOUND_KEY = "mesa.notify.sound";

export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's localStorage, or null when it is not reachable. */
export function browserStorage(): PrefStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** True unless the stored value is "off" (missing, unreadable or unknown values mean on). */
export function readSound(storage: PrefStorage | null): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

// The browser refused to play the chime (autoplay policy: the audio context stayed suspended).
// Shared by every tab like the preference; the Sonido control shows it until a chime plays.
export const BLOCKED_KEY = "mesa.notify.soundBlocked";

/** True only when the last chime was blocked (missing, unreadable or unknown values mean not blocked). */
export function readBlocked(storage: PrefStorage | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(BLOCKED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Stores the blocked flag; returns false when it could not be stored. */
export function writeBlocked(storage: PrefStorage | null, blocked: boolean): boolean {
  if (!storage) return false;
  try {
    storage.setItem(BLOCKED_KEY, blocked ? "1" : "0");
    return true;
  } catch {
    return false;
  }
}

/** Stores the choice; returns false when it could not be stored. */
export function writeSound(storage: PrefStorage | null, on: boolean): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SOUND_KEY, on ? "on" : "off");
    return true;
  } catch {
    return false;
  }
}
