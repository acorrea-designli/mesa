// Install-prompt rules, pure so they are unit tested (the UI is InstallPrompt.tsx).
// Android/Chrome fire `beforeinstallprompt`; iOS Safari has no such event, so it gets a short written guide.

export const DISMISS_KEY = "mesa:install-dismissed-at";
export const REOFFER_AFTER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Platform = "ios" | "other";

/** iPhone, iPad and iPadOS 13+ (which reports itself as a Mac with a touch screen). */
export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return "ios";
  return "other";
}

/** Was the banner dismissed less than 14 days ago? `raw` is the stored ISO date or epoch ms (junk reads as not dismissed). */
export function recentlyDismissed(raw: string | null, now = Date.now()): boolean {
  if (!raw) return false;
  const at = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(at)) return false;
  return now - at < REOFFER_AFTER_DAYS * DAY_MS && now >= at;
}

export interface OfferInput {
  standalone: boolean;
  platform: Platform;
  /** A `beforeinstallprompt` event is waiting (Chrome, Edge, Android). */
  hasPrompt: boolean;
  dismissedRaw: string | null;
  now?: number;
}

/** What the banner shows: the native prompt, the iOS guide, or nothing (installed, dismissed, or not installable). */
export function offerKind(i: OfferInput): "prompt" | "ios" | null {
  if (i.standalone) return null;
  if (recentlyDismissed(i.dismissedRaw, i.now)) return null;
  if (i.hasPrompt) return "prompt";
  if (i.platform === "ios") return "ios";
  return null;
}
