"use client";
// One notifier per tab, mounted once in the shell. Renders nothing. It never refreshes the router.
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useLive } from "@/lib/live/useLive";
import { startNotifier, type Engine } from "./engine";
import { useNotifyState } from "./prefs";

const TYPES = ["ticket", "salida", "review", "approval"];

export function Notifier() {
  const on = useNotifyState() === "on";
  const router = useRouter();
  const nav = useRef(router.push);
  const engine = useRef<Engine | null>(null);
  useEffect(() => {
    nav.current = router.push;
  });

  useEffect(() => {
    if (!on) return;
    const e = startNotifier((url) => nav.current(url));
    engine.current = e;
    return () => {
      e.stop();
      engine.current = null;
    };
  }, [on]);

  // Debounced inside the engine; the poll fallback of useLive arrives here too.
  useLive(() => engine.current?.poke(), { entityTypes: TYPES });
  return null;
}
