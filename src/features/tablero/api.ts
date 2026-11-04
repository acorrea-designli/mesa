// Client calls for Tablero: single and batch moves, "Dárselo a Claude", "+ Tarea".
import type { Station, Task } from "@/lib/domain/types";

export interface StationMove {
  id: string;
  station: Station;
}
export interface DispatchOut {
  task: Task;
  ticket: { id: string; ref: string };
  created: boolean;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  return data as T;
}

export const tableroApi = {
  move: (id: string, station: Station) => post<Task>(`/api/tasks/${encodeURIComponent(id)}/move`, { station }),
  moveMany: (ids: string[], station: Station) => post<{ tasks: Task[]; previous: StationMove[] }>("/api/tasks/batch", { action: "move", ids, station }),
  restore: (moves: StationMove[]) => post<{ tasks: Task[]; previous: StationMove[] }>("/api/tasks/batch", { action: "restore", moves }),
  dispatch: (id: string) => post<DispatchOut>(`/api/tasks/${encodeURIComponent(id)}/dispatch`, {}),
  dispatchMany: (ids: string[]) => post<{ results: DispatchOut[]; skipped: { id: string; reason: string }[] }>("/api/tasks/batch", { action: "dispatch", ids }),
  create: (input: { title: string; excerpt?: string; project?: string; noteOnly: boolean }) =>
    post<Task & { ticket: { id: string; ref: string } | null }>("/api/tasks", { source: "claude", ...input }),
};

/** "3 tarjetas" / "1 tarjeta" */
export const cardsLabel = (n: number) => `${n} ${n === 1 ? "tarjeta" : "tarjetas"}`;

/** Toast after "Dárselas a Claude": "2 pedidos a Claude · t21, t22 · 1 de muestra no se envía". */
export function dispatchToast(results: Pick<DispatchOut, "created" | "ticket">[], skipped: number): string {
  const made = results.filter((r) => r.created);
  const parts: string[] = [];
  if (made.length) parts.push(`${made.length} ${made.length === 1 ? "pedido" : "pedidos"} a Claude · ${made.map((r) => r.ticket.ref).join(", ")}`);
  const already = results.length - made.length;
  if (already) parts.push(`${already} ya ${already === 1 ? "estaba" : "estaban"} con Claude`);
  if (skipped) parts.push(`${skipped} de muestra no se ${skipped === 1 ? "envía" : "envían"}`);
  return parts.join(" · ") || "Nada que enviar a Claude";
}
