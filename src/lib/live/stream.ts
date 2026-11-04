// Server-Sent Events for the UI: one `change` event per LiveChange, a heartbeat comment
// every 15 s so proxies and the phone tunnel keep the connection open, and cleanup on
// client disconnect. EventSource reconnects by itself (retry: 3 s).
import { subscribeChanges, type LiveChange } from "./bus";

export const HEARTBEAT_MS = 15_000;

const enc = new TextEncoder();
export const sseFrame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export function liveResponse(signal: AbortSignal, heartbeatMs = HEARTBEAT_MS): Response {
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (s: string) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = subscribeChanges((c: LiveChange) => send(sseFrame("change", c)));
      const beat = setInterval(() => send(`: ping ${Date.now()}\n\n`), heartbeatMs);
      cleanup = () => {
        if (!open) return;
        open = false;
        clearInterval(beat);
        unsubscribe();
        signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      signal.addEventListener("abort", cleanup);
      send(`retry: 3000\n\n${sseFrame("ready", { at: new Date().toISOString() })}`);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
