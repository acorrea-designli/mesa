"use client";
// Live updates for Tickets and Salidas: lane C's SSE hook (src/lib/live/useLive.ts on
// /api/stream), which falls back to polling when the stream cannot be opened.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLive as useLiveStream, type LiveChange } from "@/lib/live/useLive";

export type LiveEvent = LiveChange;

/** Calls `cb` on every change on the board (`pollMs` only applies to the polling fallback). */
export function useLive(cb: (e: LiveEvent) => void, pollMs = 5000): void {
  useLiveStream(cb, { pollMs });
}

/** Refresh the server components on changes, coalesced per burst. Returns a manual refresh. */
export function useLiveRefresh(): () => void {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const later = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 250);
  }, [router]);
  useLiveStream(later);
  return router.refresh;
}

/**
 * The current time, ticking every `stepMs` while `active`. Starts from the server's
 * clock (`initial`) so the first client render matches the HTML.
 */
export function useNow(initial: string | number, active = true, stepMs = 1000): number {
  const [now, setNow] = useState(() => (typeof initial === "number" ? initial : Date.parse(initial)));
  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(id);
  }, [active, stepMs]);
  return now;
}
