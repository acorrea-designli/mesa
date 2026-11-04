import { json, route } from "@/lib/api/http";
import { githubWorker } from "@/lib/integrations/github-worker";

export const dynamic = "force-dynamic";

/**
 * POST /api/github/sync -> { ingest, project } runs a full pass now: notifications (still
 * conditional), review requests, Project push and pull. Shares a pass already in flight.
 */
export const POST = route(async () => json(await githubWorker().run({ force: true })));
