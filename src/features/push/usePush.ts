"use client";
// Web Push on this device (t33): one shared store for the /telefono card, the "Ajustes" row and the page-load sync.
//
// The permission is requested through the service worker registration (`pushManager.subscribe`), the path that works on
// Android Chrome and Opera: their pages cannot `new Notification()`, and `Notification.requestPermission()` from a page
// has ended "bloqueadas" there. Every page load re-syncs the current subscription to the server (an upsert), so a phone
// whose Access session expired while the worker tried to re-POST is repaired the next time Mesa opens. A subscription
// made with other VAPID keys (the PC's keys changed) is dropped and made again, with no prompt because the permission stays.
import { useSyncExternalStore } from "react";
import { detectPlatform } from "@/features/phone/install";
import { markDevicePush } from "./device";
import { pushState, sameKey, testResult, urlBase64ToBytes, type Permission, type PushInputs, type PushState, type ServerPush, type TestResult } from "./state";

const READY_WAIT_MS = 4000;

export interface PushSnapshot extends PushInputs {
  endpoint: string | null;
  busy: boolean;
  /** The last result of a click (an error or the test), for the card to show. */
  message: string | null;
  testResult: TestResult | null;
}

const INITIAL: PushSnapshot = { api: false, ios: false, standalone: false, worker: "unknown", permission: "prompt", server: "loading", subscribed: null, endpoint: null, busy: false, message: null, testResult: null };

let snap: PushSnapshot = INITIAL;
const listeners = new Set<() => void>();
const emit = (patch: Partial<PushSnapshot>) => {
  snap = { ...snap, ...patch };
  listeners.forEach((l) => l());
};

export const subscribePush = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
export const getPushSnapshot = () => snap;
const getServerSnapshot = () => INITIAL;

export function usePush(): { snap: PushSnapshot; state: PushState } {
  const s = useSyncExternalStore(subscribePush, getPushSnapshot, getServerSnapshot);
  return { snap: s, state: pushState(s) };
}

const hasApi = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

async function worker(): Promise<ServiceWorkerRegistration | null> {
  const wait = new Promise<null>((r) => setTimeout(() => r(null), READY_WAIT_MS));
  try {
    return await Promise.race([navigator.serviceWorker.ready, wait]);
  } catch {
    return null;
  }
}

async function permissionOf(reg: ServiceWorkerRegistration): Promise<Permission> {
  try {
    return await reg.pushManager.permissionState({ userVisibleOnly: true });
  } catch {
    const p = Notification.permission;
    return p === "default" ? "prompt" : p;
  }
}

async function serverStatus(): Promise<{ server: ServerPush; publicKey: string | null }> {
  try {
    const res = await fetch("/api/push", { cache: "no-store" });
    if (!res.ok) return { server: "error", publicKey: null };
    const b = (await res.json()) as { enabled: boolean; publicKey?: string; reason?: string };
    if (b.enabled && b.publicKey) return { server: "enabled", publicKey: b.publicKey };
    return { server: b.reason === "sandbox" ? "sandbox" : "no_keys", publicKey: null };
  } catch {
    return { server: "error", publicKey: null };
  }
}

const post = (url: string, method: string, body: unknown) =>
  fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true });

function keysOf(sub: PushSubscription) {
  const j = sub.toJSON();
  return { endpoint: sub.endpoint, keys: { p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "" } };
}

/** Upsert this device's subscription on the server. Best effort: a failure is retried on the next page load. */
async function syncSubscription(sub: PushSubscription): Promise<boolean> {
  try {
    const label = navigator.userAgent.slice(0, 80);
    return (await post("/api/push/subscription", "POST", { ...keysOf(sub), label })).ok;
  } catch {
    return false;
  }
}

/** What the last refresh learned, so a tap can call `subscribe` at once: a permission prompt needs the tap's user activation, which awaits can lose. */
let ctx: { reg: ServiceWorkerRegistration; publicKey: string } | null = null;
let refreshing: Promise<void> | null = null;
const currentCtx = () => ctx;

/** Read the facts of this device and re-sync the subscription. Safe to call often (one runs at a time). */
export function refreshPush(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const ios = detectPlatform(navigator.userAgent, navigator.maxTouchPoints) === "ios";
    const base = { api: hasApi(), ios, standalone: isStandalone() };
    const { server, publicKey } = await serverStatus();
    if (!base.api) {
      markDevicePush(false);
      emit({ ...base, server });
      return;
    }
    emit({ ...base, server });
    const reg = await worker();
    if (!reg) {
      ctx = null;
      markDevicePush(false);
      emit({ worker: "none", subscribed: false, endpoint: null });
      return;
    }
    const permission = await permissionOf(reg);
    let sub = await reg.pushManager.getSubscription().catch(() => null);
    if (sub && server === "enabled" && publicKey && !sameKey(sub.options.applicationServerKey, publicKey)) {
      // The PC's VAPID keys changed: this subscription can never receive again.
      await post("/api/push/subscription", "DELETE", { endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
      sub = null;
    }
    if (sub && server === "enabled" && permission === "granted") await syncSubscription(sub);
    const usable = Boolean(sub) && server === "enabled" && permission === "granted";
    markDevicePush(usable);
    ctx = server === "enabled" && publicKey ? { reg, publicKey } : null;
    emit({ worker: "ready", permission, subscribed: Boolean(sub), endpoint: sub?.endpoint ?? null });
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Turn the avisos on. Must run from a tap: the browser asks for the permission inside `subscribe`. */
export async function enablePush(): Promise<void> {
  emit({ busy: true, message: null, testResult: null });
  try {
    if (!currentCtx()) await refreshPush(); // a tap before the first refresh finished: rare, the prompt may then need a second tap
    const c = currentCtx();
    if (!c) return;
    const sub = await c.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(c.publicKey) });
    if (!(await syncSubscription(sub))) {
      await sub.unsubscribe().catch(() => undefined);
      emit({ message: "Mesa no guardó este teléfono. Intenta de nuevo." });
    }
  } catch (err) {
    const denied = (err as { name?: string })?.name === "NotAllowedError";
    emit({ message: denied ? "No se concedió el permiso de avisos." : "No pude activar los avisos. Intenta de nuevo." });
  } finally {
    await refreshPush();
    emit({ busy: false });
  }
}

/** Turn the avisos off on this device: forget the subscription in the browser and on the server. */
export async function disablePush(): Promise<void> {
  emit({ busy: true, message: null, testResult: null });
  try {
    const reg = await worker();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      await post("/api/push/subscription", "DELETE", { endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    }
  } finally {
    await refreshPush();
    emit({ busy: false });
  }
}

/** "Probar aviso": a push to this device only. */
export async function testPush(): Promise<void> {
  const endpoint = snap.endpoint;
  if (!endpoint) return;
  emit({ busy: true, message: null, testResult: null });
  try {
    const res = await post("/api/push/test", "POST", { endpoint });
    const r = testResult(res.status);
    emit({ testResult: r });
    if (r === "gone") await refreshPush();
  } catch {
    emit({ testResult: "unreachable" });
  } finally {
    emit({ busy: false });
  }
}

// ----- who is looking: a visible, focused tab beats so the server sends no push meanwhile -----

const BEAT_MS = 3000;
const tab = Math.random().toString(36).slice(2, 12);
const looking = () => document.visibilityState === "visible" && document.hasFocus();

/** Start the beat (returns the stop function). Beats only while Mesa can send pushes. */
export function startLookingBeat(): () => void {
  let last: boolean | null = null;
  const send = (value: boolean) => void post("/api/push/looking", "POST", { tab, looking: value }).catch(() => undefined);
  const tick = () => {
    if (snap.server !== "enabled") return;
    const now = looking();
    // A tab that looks beats on every tick (each beat lives 8 s); one that stopped says so once.
    if (now) send(true);
    else if (last) send(false);
    last = now;
  };
  const timer = window.setInterval(tick, BEAT_MS);
  const onChange = () => tick();
  window.addEventListener("focus", onChange);
  window.addEventListener("blur", onChange);
  document.addEventListener("visibilitychange", onChange);
  const onHide = () => {
    if (snap.server === "enabled" && last) send(false);
  };
  window.addEventListener("pagehide", onHide);
  tick();
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", onChange);
    window.removeEventListener("blur", onChange);
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("pagehide", onHide);
  };
}
