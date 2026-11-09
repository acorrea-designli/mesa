// Countdown for the pairing QR, pure so it is unit tested.

/** "9:41" for the time left, or null once it is over. */
export function timeLeft(expiresAt: string, now: number): string | null {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
