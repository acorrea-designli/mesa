"use client";
// Live updates for Hoy and Tablero. Fallback until lane C's src/lib/live/useLive.ts
// (SSE on /api/stream) lands: refresh every 5 s and watch /api/health so the phone
// knows when the tunnel to the PC is down ("Sin conexión con tu PC").
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 5000;

export interface Connection {
  offline: boolean;
  /** When the PC last answered ("10:30"), for the offline notice. */
  lastOk: Date | null;
  /** When it stopped answering. */
  downSince: Date | null;
  retry: () => void;
}

/** Calls `onChange` (default: router.refresh) on every tick while the PC answers. */
export function useLive(onChange?: () => void): Connection {
  const router = useRouter();
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  }, [onChange]);
  const [state, setState] = useState<{ offline: boolean; lastOk: Date | null; downSince: Date | null }>({
    offline: false,
    lastOk: null,
    downSince: null,
  });

  const tick = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setState((s) => ({ offline: false, lastOk: new Date(), downSince: s.offline ? null : s.downSince }));
      if (cb.current) cb.current();
      else router.refresh();
    } catch {
      setState((s) => (s.offline ? s : { ...s, offline: true, downSince: new Date() }));
    }
  }, [router]);

  useEffect(() => {
    let alive = true;
    const run = () => alive && document.visibilityState === "visible" && void tick();
    const id = window.setInterval(run, POLL_MS);
    const offline = () => setState((s) => ({ ...s, offline: true, downSince: s.downSince ?? new Date() }));
    window.addEventListener("online", run);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", run);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener("online", run);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", run);
    };
  }, [tick]);

  return { ...state, retry: () => void tick() };
}
