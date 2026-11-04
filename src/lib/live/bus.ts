// Live change notifications for the UI (GET /api/stream). Server only.
// Sources of changes:
//  - every successful mutating API request (route() in src/lib/api/http.ts calls publishRequest),
//  - wake events (a session posted a version, Andrés answered, a salida was released, …),
//  - server-side writes that do not go through the API (GitHub ingest and Project sync).
import { EventEmitter } from "node:events";
import { onWake } from "../wake/wake";

export interface LiveChange {
  entityType: string; // item | task | ticket | salida | approval | review | source | agent | sweep | …
  entityId: string; // "" when the change is to a collection
  kind: string; // created | updated | deleted | move | sync | answered | released | …
}

const g = globalThis as unknown as { __mesaLive?: EventEmitter };
function bus(): EventEmitter {
  if (!g.__mesaLive) {
    g.__mesaLive = new EventEmitter();
    g.__mesaLive.setMaxListeners(0);
  }
  return g.__mesaLive;
}

export function publishChange(c: LiveChange): void {
  bus().emit("change", c);
}

/** Listen to every change, wake events included. Returns the unsubscribe function. */
export function subscribeChanges(fn: (c: LiveChange) => void): () => void {
  bus().on("change", fn);
  const offWake = onWake((e) => fn({ entityType: e.entityType, entityId: e.entityId, kind: e.kind }));
  return () => {
    bus().off("change", fn);
    offWake();
  };
}

const ENTITY: Record<string, string> = {
  items: "item",
  tasks: "task",
  tickets: "ticket",
  salidas: "salida",
  approvals: "approval",
  reviews: "review",
  sources: "source",
  team: "agent",
  handoffs: "handoff",
  actions: "action",
  chips: "chip",
  engram: "engram",
  sweep: "sweep",
  github: "github",
  "ignored-projects": "ignored_project",
};

// Plumbing that changes nothing a screen shows.
const QUIET = new Set(["wait", "sessions", "stream", "health"]);

/** Derive the change from a mutating API request: /api/<collection>/<id>/<action…>. */
export function changeFromRequest(method: string, url: string): LiveChange | null {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const parts = new URL(url, "http://local").pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || !parts[1] || QUIET.has(parts[1])) return null;
  const entityType = ENTITY[parts[1]] ?? parts[1];
  const rest = parts.slice(2).map(decodeURIComponent);
  if (parts[1] === "items" && rest[0] === "upsert") return { entityType, entityId: "", kind: "upsert" };
  const verb = method === "POST" ? "created" : method === "DELETE" ? "deleted" : "updated";
  if (!rest.length) return { entityType, entityId: "", kind: verb };
  return { entityType, entityId: rest[0] ?? "", kind: rest.slice(1).join(".") || verb };
}

/** Called by route() after a successful request. */
export function publishRequest(req: Request, status: number): void {
  if (status >= 400) return;
  const c = changeFromRequest(req.method, req.url);
  if (c) publishChange(c);
}
