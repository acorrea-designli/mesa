"use client";
// Live updates for screens. Subscribes to GET /api/stream (SSE) and calls `cb` for every
// change. When the stream cannot be opened (old browser, proxy that buffers), it falls back
// to calling `cb` every 5 s with { entityType: "*", kind: "poll" }, so callers can always
// just refresh. Use useLiveRefresh() for the common "router.refresh() on any change" case.
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export interface LiveChange {
  entityType: string;
  entityId: string;
  kind: string;
}

export interface LiveOptions {
  /** Only these entity types (item, task, ticket, salida, approval, review, source, …). */
  entityTypes?: string[];
  /** Fallback polling interval when SSE is unavailable. */
  pollMs?: number;
}

const POLL: LiveChange = { entityType: "*", entityId: "", kind: "poll" };
const MAX_ERRORS_BEFORE_POLL = 3;

export function useLive(cb: (c: LiveChange) => void, opts: LiveOptions = {}): void {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  const types = opts.entityTypes?.join(",") ?? "";
  const pollMs = opts.pollMs ?? 5000;

  useEffect(() => {
    const wanted = types ? new Set(types.split(",")) : null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let es: EventSource | null = null;
    let errors = 0;
    const startPolling = () => {
      es?.close();
      es = null;
      if (!poll) poll = setInterval(() => ref.current(POLL), pollMs);
    };
    if (typeof EventSource === "undefined") startPolling();
    else {
      es = new EventSource("/api/stream");
      es.addEventListener("ready", () => {
        errors = 0;
      });
      es.addEventListener("change", (ev) => {
        try {
          const c = JSON.parse((ev as MessageEvent<string>).data) as LiveChange;
          if (!wanted || wanted.has(c.entityType)) ref.current(c);
        } catch {
          /* ignore malformed frames */
        }
      });
      es.onerror = () => {
        errors += 1;
        if (errors >= MAX_ERRORS_BEFORE_POLL) startPolling();
      };
    }
    return () => {
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [types, pollMs]);
}

/** router.refresh() on changes, coalesced so a burst of writes refreshes once. */
export function useLiveRefresh(opts: LiveOptions & { debounceMs?: number } = {}): void {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wait = opts.debounceMs ?? 250;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useLive(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), wait);
  }, opts);
}
