"use client";
// Ignore / un-ignore a project from Hoy or Tablero, with the undo toast. Every write stamps
// lastInteractionAt server side and is published on /api/stream, so other open screens
// refresh too; this one refreshes right away.
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useToast } from "@/components/ui/interactive";
import type { IgnoredProject } from "@/lib/domain/ignore";
import type { IgnoredRow, IgnoreTarget } from "./model";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const add = (t: Pick<IgnoreTarget, "source" | "project" | "label"> | Pick<IgnoredRow, "source" | "project" | "label">) =>
  send("/api/ignored-projects", "POST", { source: t.source, project: t.project, label: t.label }) as Promise<{ ignored: IgnoredProject }>;
const remove = (id: string) => send(`/api/ignored-projects/${encodeURIComponent(id)}`, "DELETE") as Promise<IgnoredProject>;

export function useIgnore() {
  const router = useRouter();
  const toast = useToast();

  const ignore = useCallback(
    async (t: IgnoreTarget) => {
      try {
        const { ignored } = await add(t);
        router.refresh();
        toast({
          text: "Proyecto ignorado",
          duration: 8000,
          action: {
            label: "Deshacer",
            onClick: () =>
              void remove(ignored.id)
                .then(() => router.refresh())
                .catch(() => toast({ text: "No se pudo deshacer" })),
          },
        });
      } catch {
        toast({ text: "No se pudo ignorar el proyecto" });
      }
    },
    [router, toast],
  );

  /** Tablero batch bar: ignore every distinct project of the selection, one toast, one Deshacer. */
  const ignoreMany = useCallback(
    async (ts: IgnoreTarget[]) => {
      if (!ts.length) return;
      try {
        const rows = await Promise.all(ts.map((t) => add(t)));
        router.refresh();
        toast({
          text: rows.length === 1 ? "Proyecto ignorado" : `${rows.length} proyectos ignorados`,
          duration: 8000,
          action: {
            label: "Deshacer",
            onClick: () =>
              void Promise.all(rows.map((r) => remove(r.ignored.id)))
                .then(() => router.refresh())
                .catch(() => toast({ text: "No se pudo deshacer" })),
          },
        });
      } catch {
        toast({ text: "No se pudo ignorar el proyecto" });
      }
    },
    [router, toast],
  );

  const unignore = useCallback(
    async (r: IgnoredRow) => {
      try {
        await remove(r.id);
        router.refresh();
        toast({
          text: `«${r.label}» vuelve a Hoy`,
          action: {
            label: "Deshacer",
            onClick: () =>
              void add(r)
                .then(() => router.refresh())
                .catch(() => toast({ text: "No se pudo deshacer" })),
          },
        });
      } catch {
        toast({ text: "No se pudo dejar de ignorar" });
      }
    },
    [router, toast],
  );

  return { ignore, ignoreMany, unignore };
}
