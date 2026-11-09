"use client";
// The live "Uso" block of the rail and of the phone's Ajustes sheet: polls GET /api/usage (the latest statusLine
// snapshot Mesa saved) and shows it with UsageBlock. A failed request or an empty Mesa reads "sin dato", never an error.
import { useEffect, useState } from "react";
import type { UsageView } from "@/lib/domain/usage";
import { UsageBlock } from "./UsageBlock";

const POLL_MS = 30_000;
const EMPTY: UsageView = { state: "none", age: "", model: "", windows: [] };

export function UsageLine({ onDetail }: { onDetail?: (href: string) => void }) {
  const [view, setView] = useState<UsageView>(EMPTY);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/usage", { cache: "no-store", signal: AbortSignal.timeout(6000) });
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as { view?: UsageView };
        if (alive && body.view) setView(body.view);
      } catch {
        if (alive) setView(EMPTY);
      }
    };
    const first = window.setTimeout(() => void load(), 0);
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  return <UsageBlock view={view} onDetail={onDetail} />;
}
