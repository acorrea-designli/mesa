// Semana: the week's done work, drawn by day, kind and project, then listed by project.
import type { Metadata } from "next";
import { SemanaView } from "@/features/semana/SemanaView";
import { loadSemana } from "@/features/semana/read";
import { weekQuery } from "@/lib/api/schemas";
import { repos } from "@/lib/repo";
import "@/features/semana/semana.css";

export const metadata: Metadata = { title: "Semana" };
export const dynamic = "force-dynamic";

export default async function SemanaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // A bad value in the URL falls back to the current week / all projects instead of an error page.
  const parsed = weekQuery.safeParse({ semana: first(raw.semana), proyecto: first(raw.proyecto), dia: first(raw.dia) });
  const r = repos();
  r.sweep();
  const data = loadSemana(r, parsed.success ? parsed.data : {});
  return <SemanaView data={data} />;
}
