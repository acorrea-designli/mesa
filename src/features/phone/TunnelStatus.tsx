"use client";
// Phone status strip: "vía túnel" / "sin túnel" / "Vuelve a entrar" (hidden on the PC itself and on desktop widths).
// "Vuelve a entrar" is an expired Cloudflare Access session: the health ping is redirected to the Access login, and
// the button reloads the page, which sends the phone through the login. While the PC is unreachable or the session
// is expired it also stops approve/send/answer on every screen: those buttons are the primary ones in .work, and
// nothing is queued offline (the service worker never stores a write).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { LineStub } from "@/components/line/Line";
import { LINK_LABEL, classifyPing, linkState, type Ping } from "./tunnel";

const PING_MS = 15_000;
const noop = () => () => {};

export function TunnelStatus() {
  const hostname = useSyncExternalStore(noop, () => window.location.hostname, () => "");
  const [ping, setPing] = useState<Ping>("ok");
  const state = linkState(hostname, ping);

  const probe = useCallback(async () => {
    let res: { status: number; type: string } | null = null;
    try {
      // redirect "manual": an expired Access session answers 302 to its login, which we must see as such, not follow.
      const r = await fetch("/api/health", { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(6000) });
      res = { status: r.status, type: r.type };
    } catch {
      res = null;
    }
    setPing(classifyPing(res));
  }, []);

  const local = state === "local";
  useEffect(() => {
    if (local) return;
    const first = window.setTimeout(() => void probe(), 0);
    const run = () => {
      if (document.visibilityState === "visible") void probe();
    };
    const lost = () => setPing("down");
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
  }, [local, probe]);

  // Down or signed out: mark the page and swallow primary-action clicks in the work area (never the "Reintentar" in an alert).
  const blocked = state === "down" || state === "login";
  useEffect(() => {
    const root = document.documentElement;
    if (blocked) root.dataset.link = state;
    else delete root.dataset.link;
    if (!blocked) return;
    const block = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.(".work .btn.p, .work button[type=submit]");
      if (el && !el.closest(".alert")) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("click", block, true);
    return () => document.removeEventListener("click", block, true);
  }, [blocked, state]);

  if (state === "local") return null;
  return (
    <div className="tn" data-state={state} role="status">
      {blocked ? (
        <svg width="32" height="14" viewBox="0 0 32 14" aria-hidden="true" style={{ flex: "none" }}>
          <path d="M2 7H11M21 7H30" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M13 11L19 3" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <LineStub source="ink" width={22} />
      )}
      <span className="tn-label">{LINK_LABEL[state]}</span>
      {state === "down" ? <span className="tn-note">Aprobar y responder vuelven con tu PC</span> : null}
      {state === "login" ? (
        <button type="button" className="tn-act" onClick={() => window.location.reload()}>
          Entrar
        </button>
      ) : null}
    </div>
  );
}
