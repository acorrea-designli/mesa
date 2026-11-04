"use client";
// Stand-in for lane C's `useLive` (src/lib/live/useLive.ts, SSE on /api/stream).
// Until it lands on main this polls: the callback runs every 5 s while the tab is
// visible, and on focus. Swap the import for lane C's hook when it merges.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export interface LiveEvent {
  entityType: string;
  entityId: string;
  kind: string;
}

export function useLive(cb: (e: LiveEvent) => void, intervalMs = 5000): void {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") ref.current({ entityType: "poll", entityId: "", kind: "poll" });
    };
    const id = window.setInterval(tick, intervalMs);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, [intervalMs]);
}

/** Refresh the server components on every live event. Returns a manual refresh. */
export function useLiveRefresh(): () => void {
  const router = useRouter();
  useLive(() => router.refresh());
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
