"use client";
// Mounted once in the shell. Renders nothing. On every page load it re-syncs this device's push subscription to the
// server (an upsert, so a worker re-POST that Access blocked is repaired), keeps the "in-page Notifier stays quiet on
// a subscribed device" flag current, and beats "someone is looking" while this tab is visible and focused.
import { useEffect } from "react";
import { refreshPush, startLookingBeat } from "./usePush";

const REFRESH_EVERY_MS = 30_000;

export function PushSync() {
  useEffect(() => {
    void refreshPush();
    const stopBeat = startLookingBeat();
    let last = Date.now();
    // Coming back to Mesa (after the permission was changed in the browser's settings, say) reads the facts again.
    const onFocus = () => {
      if (Date.now() - last < REFRESH_EVERY_MS) return;
      last = Date.now();
      void refreshPush();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      stopBeat();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);
  return null;
}
