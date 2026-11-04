// Tickets A: list + thread.
import type { Metadata } from "next";
import { loadTickets } from "@/features/tickets/read";
import { TicketsScreen } from "@/features/tickets/TicketsScreen";
import { repos } from "@/lib/repo";
import "@/features/salidas/salidas.css";
import "@/features/tickets/tickets.css";

export const metadata: Metadata = { title: "Tickets" };

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ t?: string; tab?: string; new?: string }> }) {
  const q = await searchParams;
  const r = repos();
  r.sweep();
  const data = loadTickets(r, { tab: q.tab, selected: q.t, creating: q.new === "1" });
  return <TicketsScreen data={data} explicit={Boolean(q.t)} />;
}
