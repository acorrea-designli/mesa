// Client calls for Salidas. Every call returns the fresh SalidaDetail (or throws
// with the API's English error message, which the UI turns into a toast).
import type { Mark, SalidaDetail } from "@/lib/domain/types";
import type { EngramSearch } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

export async function call<T>(url: string, init?: { method?: string; body?: unknown; form?: FormData }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body !== undefined || init?.form ? "POST" : "GET"),
    headers: init?.form ? undefined : { "content-type": "application/json" },
    body: init?.form ?? (init?.body !== undefined ? JSON.stringify(init.body) : undefined),
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { message: string; code: string } } | null;
  if (!res.ok) throw new ApiError(data?.error?.message ?? res.statusText, res.status, data?.error?.code ?? "error");
  return data as T;
}

const S = (id: string) => `/api/salidas/${encodeURIComponent(id)}`;

export const salidaApi = {
  get: (id: string) => call<SalidaDetail>(S(id)),
  approve: (id: string, version: number) => call<SalidaDetail>(`${S(id)}/transition`, { body: { type: "approve", version } }),
  undo: (id: string) => call<SalidaDetail>(`${S(id)}/transition`, { body: { type: "undo" } }),
  deny: (id: string) => call<SalidaDetail>(`${S(id)}/transition`, { body: { type: "deny" } }),
  schedule: (id: string, at: string, version: number) => call<SalidaDetail>(`${S(id)}/transition`, { body: { type: "schedule", at, version } }),
  unschedule: (id: string) => call<SalidaDetail>(`${S(id)}/transition`, { body: { type: "unschedule" } }),
  retry: (id: string) => call<SalidaDetail>(`${S(id)}/transition`, { body: { type: "retry" } }),
  unqueue: (id: string) => call<SalidaDetail>(`${S(id)}/transition`, { body: { type: "unqueue" } }),
  requestDelete: (id: string) => call<SalidaDetail>(`${S(id)}/transition`, { body: { type: "request_delete" } }),
  requestRestore: (id: string) => call<SalidaDetail>(`${S(id)}/transition`, { body: { type: "request_restore" } }),
  select: (id: string, n: number) => call<SalidaDetail>(`${S(id)}/select`, { body: { n } }),
  star: (id: string, n: number, starred: boolean) => call<SalidaDetail>(`${S(id)}/versions/${n}`, { method: "PATCH", body: { starred } }),
  edit: (id: string, body: string) => call<SalidaDetail>(`${S(id)}/edit`, { body: { body } }),
  turn: (id: string, t: { body?: string; marks?: Mark[]; chipLabel?: string }) => call<SalidaDetail>(`${S(id)}/turns`, { body: t }),
  cancelTurn: (id: string, turnId: string) => call<SalidaDetail>(`${S(id)}/turns/${encodeURIComponent(turnId)}/cancel`, { body: {} }),
};

/** Engram is read only and optional: any failure (server down, CLI missing) reads as offline. */
export async function searchEngram(q: string, project: string, limit = 5): Promise<EngramSearch> {
  try {
    const p = new URLSearchParams({ q, limit: String(limit) });
    if (project) p.set("project", project);
    const res = await fetch(`/api/engram/search?${p}`, { cache: "no-store" });
    if (!res.ok) return { status: "offline", observations: [] };
    const data = (await res.json()) as Partial<EngramSearch>;
    return { status: data.status === "connected" ? "connected" : "offline", observations: Array.isArray(data.observations) ? data.observations : [] };
  } catch {
    return { status: "offline", observations: [] };
  }
}
