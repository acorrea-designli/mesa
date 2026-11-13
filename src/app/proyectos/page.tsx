// Proyectos (t152): per client GitHub Project, every open PR with its status, its board issue and its Mesa ticket.
// Read from the SQLite cache the /proyectos reader fills (the same payload as GET /api/proyectos), never from GitHub.
import type { Metadata } from "next";
import { ProyectosView } from "@/features/proyectos/ProyectosView";
import { issuePrefixOf, parseQuery, screenModel } from "@/features/proyectos/model";
import { loadProjects } from "@/lib/integrations/projects-config";
import { blockerQuote, loadProjectsPayload } from "@/lib/integrations/projects-view";
import { repos } from "@/lib/repo";
import "@/features/proyectos/proyectos.css";

export const metadata: Metadata = { title: "Proyectos" };
export const dynamic = "force-dynamic";

export default async function ProyectosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = parseQuery(await searchParams);
  const r = repos();
  const config = loadProjects();
  // An unknown project key falls back to the first project rather than an error page.
  const known = !q.proyecto || config.projects.some((p) => p.key === q.proyecto);
  const query = known ? q : { ...q, proyecto: null, estacion: null, pr: null };
  const payload = loadProjectsPayload(r, query.proyecto, { config });
  const project = config.projects.find((p) => p.key === payload.view?.key);
  const sel = query.pr ? payload.view?.prs.find((p) => p.key === query.pr) : undefined;
  const screen = screenModel(payload, query, new Date(), {
    issuePrefix: issuePrefixOf(project?.issueKeys ?? []),
    issueRepo: project?.issueRepo ?? null,
    blockerQuote: sel?.mesa && sel.blocker ? blockerQuote(r.db, sel.mesa.id) : null,
  });
  return <ProyectosView key={`${payload.view?.key ?? ""}:${query.estacion ?? ""}:${query.vista}`} screen={screen} />;
}
