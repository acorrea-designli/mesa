"use client";
// "Saltar": take an item out of Hoy without acting on it. The server marks it done with waitOn none and
// skippedAt, so no sweeper or GitHub upsert brings it back; a genuinely new message still arrives. Like
// features/ignore/useIgnore.ts: the call, router.refresh and a toast with Deshacer (unskip to the station
// and waitOn the item had).
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useToast } from "@/components/ui/interactive";
import { skipToast, type SkipTarget } from "./model";

async function send(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export function useSkip() {
  const router = useRouter();
  const toast = useToast();

  const skip = useCallback(
    async (t: SkipTarget) => {
      const base = `/api/items/${encodeURIComponent(t.id)}`;
      try {
        await send(`${base}/skip`);
      } catch {
        toast({ text: "No se pudo saltar" });
        return;
      }
      router.refresh();
      toast({
        text: "Saltado: sale de Hoy",
        duration: 8000,
        action: {
          label: "Deshacer",
          onClick: () =>
            void send(`${base}/unskip`, { station: t.station, waitOn: t.waitOn })
              .then(() => router.refresh())
              .catch(() => toast({ text: "No se pudo deshacer" })),
        },
      });
    },
    [router, toast],
  );

  /** The batch bar's Saltar: one skip call per item (no batch route), then one toast whose Deshacer restores each skipped item. */
  const skipMany = useCallback(
    async (targets: SkipTarget[]) => {
      const res = await Promise.allSettled(targets.map((t) => send(`/api/items/${encodeURIComponent(t.id)}/skip`)));
      const done = targets.filter((_, i) => res[i]?.status === "fulfilled");
      const failed = targets.length - done.length;
      if (done.length) router.refresh();
      toast({
        text: skipToast(done.length, failed),
        duration: 8000,
        action: done.length
          ? {
              label: "Deshacer",
              onClick: () =>
                void Promise.all(done.map((t) => send(`/api/items/${encodeURIComponent(t.id)}/unskip`, { station: t.station, waitOn: t.waitOn })))
                  .then(() => router.refresh())
                  .catch(() => {
                    router.refresh();
                    toast({ text: "No se pudo deshacer" });
                  }),
            }
          : undefined,
      });
      return { ok: done.length, failed };
    },
    [router, toast],
  );

  return { skip, skipMany };
}
