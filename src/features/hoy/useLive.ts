"use client";
// Live updates for Hoy and Tablero: refresh on every change pushed by /api/stream (SSE,
// src/lib/live/useLive.ts), coalesced to one router.refresh() per burst. A light
// /api/health ping tells the phone when the tunnel to the PC is down ("Sin conexión con tu PC").
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { refreshIfUp, useLive as useLiveStream } from "@/lib/live/useLive";

const HEALTH_MS = 15_000;
const DEBOUNCE_MS = 250;

export interface Connection {
  offline: boolean;
  /** When the PC last answered ("10:30"), for the offline notice. */
  lastOk: Date | null;
  /** When it stopped answering. */
  downSince: Date | null;
  retry: () => void;
}

/** Calls `onChange` (default: router.refresh) whenever something changes on the board. */
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
  const offlineRef = useRef(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        refreshIfUp(() => {
          if (cb.current) cb.current();
          else router.refresh();
        }),
      DEBOUNCE_MS,
    );
  }, [router]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useLiveStream(refresh);

  const ping = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const wasOffline = offlineRef.current;
      offlineRef.current = false;
      setState({ offline: false, lastOk: new Date(), downSince: null });
      if (wasOffline) refresh();
    } catch {
      offlineRef.current = true;
      setState((s) => (s.offline ? s : { ...s, offline: true, downSince: new Date() }));
    }
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    const run = () => alive && document.visibilityState === "visible" && void ping();
    const id = window.setInterval(run, HEALTH_MS);
    const offline = () => {
      offlineRef.current = true;
      setState((s) => ({ ...s, offline: true, downSince: s.downSince ?? new Date() }));
    };
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
  }, [ping]);

  return { ...state, retry: () => void ping() };
}
