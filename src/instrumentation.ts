// Runs once when the Next.js server starts (Node runtime only).
// Starts the sweeper that applies time-driven salida transitions every second:
// undo window over -> release (wakes the owner), schedule reached, expiry.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startSweeper } = await import("./lib/wake/sweeper");
  startSweeper();
}
