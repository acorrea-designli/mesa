// Tickets A: list + thread.
import type { Metadata, Viewport } from "next";
import { loadTickets } from "@/features/tickets/read";
import { TicketsScreen } from "@/features/tickets/TicketsScreen";
import { repos } from "@/lib/repo";
import "@/features/salidas/salidas.css";
import "@/features/tickets/tickets.css";

export const metadata: Metadata = { title: "Tickets" };

// The soft keyboard resizes the layout viewport (not only the visual one), so the sticky phone composer
// stays above it instead of behind it (Chrome on Android; iOS Safari ignores the hint and pans the page).
export const viewport: Viewport = { width: "device-width", initialScale: 1, interactiveWidget: "resizes-content" };

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ t?: string; p?: string; tab?: string; new?: string }> }) {
  const q = await searchParams;
  const r = repos();
  r.sweep();
  const data = loadTickets(r, { tab: q.tab, selected: q.t, pinned: q.p, creating: q.new === "1" });
  return <TicketsScreen data={data} explicit={Boolean(q.t)} pin={q.p} />;
}
