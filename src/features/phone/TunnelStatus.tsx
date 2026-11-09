"use client";
// Phone status strip: "vía túnel" / "sin túnel" (hidden on the PC itself and on desktop widths). While the PC is
// unreachable it also stops approve/send/answer on every screen: those buttons are the primary ones in .work, and
// nothing is queued offline (the service worker never stores a write).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LineStub } from "@/components/line/Line";
import { LINK_LABEL, linkState, pingReachable } from "./tunnel";

const PING_MS = 15_000;
const noop = () => () => {};

export function TunnelStatus() {
  const hostname = useSyncExternalStore(noop, () => window.location.hostname, () => "");
  const [reachable, setReachable] = useState(true);
  const downRef = useRef(false);
  const state = linkState(hostname, reachable);

  const ping = useCallback(async () => {
    let status: number | null = null;
    try {
      const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(6000) });
      status = res.status;
    } catch {
      status = null;
    }
    const ok = pingReachable(status);
    downRef.current = !ok;
    setReachable(ok);
  }, []);

  const local = state === "local";
  useEffect(() => {
    if (local) return;
    const first = window.setTimeout(() => void ping(), 0);
    const run = () => {
      if (document.visibilityState === "visible") void ping();
    };
    const lost = () => {
      downRef.current = true;
      setReachable(false);
    };
    const id = window.setInterval(run, PING_MS);
    window.addEventListener("online", run);
    window.addEventListener("offline", lost);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      window.removeEventListener("online", run);
      window.removeEventListener("offline", lost);
      document.removeEventListener("visibilitychange", run);
    };
  }, [local, ping]);

  // Down: mark the page and swallow primary-action clicks in the work area (never the "Reintentar" in an alert).
  useEffect(() => {
    const root = document.documentElement;
    if (state === "down") root.dataset.link = "down";
    else delete root.dataset.link;
    if (state !== "down") return;
    const block = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.(".work .btn.p, .work button[type=submit]");
      if (el && !el.closest(".alert")) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("click", block, true);
    return () => document.removeEventListener("click", block, true);
  }, [state]);

  if (state === "local") return null;
  return (
    <div className="tn" data-state={state} role="status">
      {state === "down" ? (
        <svg width="32" height="14" viewBox="0 0 32 14" aria-hidden="true" style={{ flex: "none" }}>
          <path d="M2 7H11M21 7H30" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M13 11L19 3" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <LineStub source="ink" width={22} />
      )}
      <span className="tn-label">{LINK_LABEL[state]}</span>
      {state === "down" ? <span className="tn-note">Aprobar y responder vuelven con tu PC</span> : null}
    </div>
  );
}
