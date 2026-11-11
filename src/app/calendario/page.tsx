// Calendario: today and the week from Andrés's Google Calendar (read only), the next meeting, and a free-text way to
// ask Claude for a meeting (it comes back as a calendar salida for his signature).
import type { Metadata } from "next";
import { CalendarView } from "@/features/calendar/CalendarView";
import { loadCalendar, parseCalendarQuery } from "@/features/calendar/read";
import { repos } from "@/lib/repo";
import "@/features/calendar/calendar.css";

export const metadata: Metadata = { title: "Calendario" };
export const dynamic = "force-dynamic";

export default async function CalendarioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const now = new Date();
  const r = repos();
  r.sweep();
  return <CalendarView data={loadCalendar(r, parseCalendarQuery(raw, now), now)} />;
}
