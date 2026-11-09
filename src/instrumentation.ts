// Runs once when the Next.js server starts (Node runtime only).
// - The sweeper applies time-driven salida transitions every second (undo window over ->
//   release, schedule reached, expiry) and prunes wake events older than 7 days.
// - The push notifier (Web Push to the phone, src/lib/push) starts when the VAPID keys are set; never in sandbox.
// - The GitHub worker polls notifications and review requests and mirrors Tablero to the
//   GitHub Project (see src/lib/integrations/github-worker.ts for when it is enabled). It never
//   starts in sandbox (MESA_ENV=sandbox, docs/SANDBOX.md); the salida sweeper still runs there.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { isSandbox } = await import("./lib/env");
  if (isSandbox()) console.info("[mesa] SANDBOX: no GitHub worker, no Project sync, no sweep wake; salida sends are simulated");
  const { startSweeper } = await import("./lib/wake/sweeper");
  startSweeper();
  const { startGithubWorker } = await import("./lib/integrations/github-worker");
  startGithubWorker();
  const { startPushNotifier } = await import("./lib/push/notifier");
  startPushNotifier();
}
