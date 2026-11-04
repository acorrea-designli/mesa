// Runs once when the Next.js server starts (Node runtime only).
// - The sweeper applies time-driven salida transitions every second (undo window over ->
//   release, schedule reached, expiry) and prunes wake events older than 7 days.
// - The GitHub worker polls notifications and review requests and mirrors Tablero to the
//   GitHub Project (see src/lib/integrations/github-worker.ts for when it is enabled).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startSweeper } = await import("./lib/wake/sweeper");
  startSweeper();
  const { startGithubWorker } = await import("./lib/integrations/github-worker");
  startGithubWorker();
}
