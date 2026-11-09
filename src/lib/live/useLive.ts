"use client";
// Live updates for screens. Subscribes to GET /api/stream (SSE) and calls `cb` for every
// change. Use useLiveRefresh() for the common "router.refresh() on any change" case.
//
// A failed stream never makes the tab navigate. router.refresh() falls back to a hard browser
// navigation when its fetch fails, so while Mesa is unreachable (a restart) no callback runs:
// the hook closes the stream and probes GET /api/health until it answers, then reopens the
// stream and delivers ONE change ({ entityType: "*", kind: "reconnect" }) so screens catch up on
// what they missed. If the stream cannot be held although the server is healthy (a proxy that
// buffers, an old browser), it falls back to a poll: every `pollMs` it checks /api/health and,
// only when that answers, calls `cb` with { entityType: "*", kind: "poll" }.
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
const RECONNECT: LiveChange = { entityType: "*", entityId: "", kind: "reconnect" };
/** The server answers but the stream failed again this many times in a row: poll instead. */
const MAX_HEALTHY_FAILS = 3;
const PROBE_FIRST_MS = 500;
const PROBE_MAX_MS = 4000;
const PROBE_TIMEOUT_MS = 4000;

/** True when the server answers /api/health with 2xx. Never throws. */
export async function serverUp(): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch("/api/health", { cache: "no-store", signal: ctl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `refresh` (a router.refresh()) only if the server answers right now. A refresh queued by
 * a debounce can fire just after Mesa went away, and a failed router.refresh() navigates the tab
 * to the browser error page; dropped here, the stream's reconnect change refreshes later.
 */
export function refreshIfUp(refresh: () => void): void {
  void serverUp().then((up) => {
    if (up) refresh();
  });
}

export function useLive(cb: (c: LiveChange) => void, opts: LiveOptions = {}): void {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  const types = opts.entityTypes?.join(",") ?? "";
  const pollMs = opts.pollMs ?? 5000;

  useEffect(() => {
    const wanted = types ? new Set(types.split(",")) : null;
    let stopped = false;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let probeTimer: ReturnType<typeof setTimeout> | null = null;
    let probing = false;
    let down = false; // the stream failed and has not been reopened yet
    let healthyFails = 0; // stream failures in a row while the server answered
    let delay = PROBE_FIRST_MS;

    const scheduleProbe = (ms: number) => {
      if (probeTimer) clearTimeout(probeTimer);
      probeTimer = setTimeout(() => void probe(), ms);
    };

    const startPolling = () => {
      if (poll) return;
      down = false;
      poll = setInterval(() => {
        void serverUp().then((up) => {
          if (up && !stopped) ref.current(POLL);
        });
      }, pollMs);
    };

    const open = () => {
      if (stopped) return;
      const src = new EventSource("/api/stream");
      es = src;
      src.addEventListener("ready", () => {
        healthyFails = 0;
        delay = PROBE_FIRST_MS;
        if (down) {
          down = false;
          ref.current(RECONNECT); // whatever happened while it was gone: refresh once
        }
      });
      src.addEventListener("change", (ev) => {
        try {
          const c = JSON.parse((ev as MessageEvent<string>).data) as LiveChange;
          if (!wanted || wanted.has(c.entityType)) ref.current(c);
        } catch {
          /* ignore malformed frames */
        }
      });
      // The browser would retry by itself, and a CLOSED stream (non-200) never would: either way
      // take over, so the tab is never left with neither a stream nor a probe.
      src.onerror = () => {
        if (es !== src) return;
        src.close();
        es = null;
        down = true;
        scheduleProbe(0);
      };
    };

    async function probe() {
      if (stopped || probing || !down) return;
      probing = true;
      const up = await serverUp();
      probing = false;
      if (stopped || !down) return;
      if (!up) {
        scheduleProbe(delay);
        delay = Math.min(delay * 2, PROBE_MAX_MS);
        return;
      }
      delay = PROBE_FIRST_MS;
      healthyFails += 1;
      if (healthyFails > MAX_HEALTHY_FAILS) startPolling();
      else open();
    }

    // A timer in a background tab may run late; these make the probe timely when the tab wakes up.
    const wake = () => {
      if (down && !poll) scheduleProbe(0);
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);

    if (typeof EventSource === "undefined") startPolling();
    else open();

    return () => {
      stopped = true;
      es?.close();
      if (poll) clearInterval(poll);
      if (probeTimer) clearTimeout(probeTimer);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
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
    timer.current = setTimeout(() => refreshIfUp(() => router.refresh()), wait);
  }, opts);
}
