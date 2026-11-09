// Client calls for Hoy: "Abrir tarea y pasar a Claude" over one or many items.
import type { DispatchOut } from "../tablero/api";

export interface DispatchItemsOut {
  /** The ticket.batch id; null when the lead was woken by a plain ticket.created (one new ticket) or not at all. */
  batchId: string | null;
  results: DispatchOut[];
  skipped: { id: string; reason: string }[];
}

export const hoyApi = {
  /** Each item's card (made when it has none) is handed to Claude as one batch. */
  dispatchItems: async (itemIds: string[]): Promise<DispatchItemsOut> => {
    const res = await fetch("/api/tasks/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dispatch_items", itemIds }) });
    const data = (await res.json().catch(() => null)) as (DispatchItemsOut & { error?: { message?: string } }) | null;
    if (!res.ok || !data) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
    return data;
  },
};
