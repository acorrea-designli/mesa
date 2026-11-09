// Semana: the week's done work, by project then kind.
import type { Metadata } from "next";
import { SemanaView } from "@/features/semana/SemanaView";
import { loadSemana } from "@/features/semana/read";
import { weekQuery } from "@/lib/api/schemas";
import { tokenSummary } from "@/lib/integrations/transcripts";
import { repos } from "@/lib/repo";
import "@/features/semana/semana.css";

export const metadata: Metadata = { title: "Semana" };
export const dynamic = "force-dynamic";

export default async function SemanaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // A bad value in the URL falls back to the current week / all projects instead of an error page.
  const parsed = weekQuery.safeParse({ semana: first(raw.semana), proyecto: first(raw.proyecto) });
  const r = repos();
  r.sweep();
  const data = loadSemana(r, parsed.success ? parsed.data : {});
  // Tokens spent are today's and this week's, so the detail only belongs on the current week.
  return <SemanaView data={data} usage={data.week.current ? { tokens: tokenSummary(r.db) } : undefined} />;
}
