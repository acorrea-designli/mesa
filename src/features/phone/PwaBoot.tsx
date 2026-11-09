"use client";
// Service worker lifecycle. Production builds register /sw.js (scope /); in dev any old registration and its
// caches are removed, so a stale worker never serves yesterday's shell while `next dev` is running.
import { useEffect } from "react";

const CACHE_PREFIX = "mesa-sw-";

export function PwaBoot() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister()));
      void caches?.keys().then((ks) => ks.filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => void caches.delete(k)));
      return;
    }
    let cancelled = false;
    const boot = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const sw = (await navigator.serviceWorker.ready).active ?? reg.active;
        if (cancelled || !sw) return;
        // The shell's own hashed JS/CSS/fonts, so the app opens from the cache once the network is gone.
        const urls = performance
          .getEntriesByType("resource")
          .map((e) => new URL(e.name, location.href))
          .filter((u) => u.origin === location.origin && u.pathname.startsWith("/_next/static/"))
          .map((u) => u.pathname + u.search);
        sw.postMessage({ type: "cache-assets", urls });
      } catch {
        /* no service worker (insecure origin, private mode): the app still works online */
      }
    };
    if (document.readyState === "complete") void boot();
    else window.addEventListener("load", () => void boot(), { once: true });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
