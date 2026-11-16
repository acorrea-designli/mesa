// Salidas B: one card at a time, free order, queue strip (newest first) and the Historial (t204).
import type { Metadata } from "next";
import { loadSalidas } from "@/features/salidas/read";
import { SalidasScreen } from "@/features/salidas/SalidasScreen";
import { repos } from "@/lib/repo";
import "@/features/salidas/salidas.css";

export const metadata: Metadata = { title: "Salidas" };

export default async function SalidasPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s } = await searchParams;
  const r = repos();
  r.sweep();
  return <SalidasScreen data={loadSalidas(r, new Date(), s)} initial={s} />;
}
