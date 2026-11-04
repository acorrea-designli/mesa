import { json, route } from "@/lib/api/http";
import { githubEnabled } from "@/lib/integrations/github-worker";
import { readProjectSettings } from "@/lib/integrations/github-project";

export const dynamic = "force-dynamic";

/** GET /api/github/status -> { enabled, project, github, githubProject } (settings + source rows). */
export const GET = route((_req, r) =>
  json({
    enabled: githubEnabled(),
    project: readProjectSettings(r.db),
    github: r.sources.get("github"),
    githubProject: r.sources.get("github_project"),
  }),
);
