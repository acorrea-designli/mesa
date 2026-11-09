// Web Push on this device, pure (the UI is PushControl.tsx, the browser calls are in usePush.ts).
// What the control shows comes from five facts: what the browser can do, whether Mesa can send (VAPID keys),
// what the push permission is, and whether this device holds a subscription.
import type { Browser } from "@/features/phone/install";

export type ServerPush = "loading" | "enabled" | "no_keys" | "sandbox" | "error";

/** The browser's push permission as the page or the service worker reports it. */
export type Permission = "granted" | "denied" | "prompt";

export interface PushInputs {
  /** serviceWorker + PushManager + Notification all exist. */
  api: boolean;
  ios: boolean;
  /** Running as an installed app (home-screen icon), not a browser tab. */
  standalone: boolean;
  /** "none": no service worker registered or ready (development, or a browser that refused it). */
  worker: "unknown" | "none" | "ready";
  permission: Permission;
  server: ServerPush;
  /** null until the subscription was read. */
  subscribed: boolean | null;
}

export type PushState =
  | "loading"
  | "ios_install" // iPhone/iPad in Safari: push only works from the home-screen app (iOS 16.4+)
  | "unsupported" // this browser has no Web Push
  | "no_worker" // the service worker is not there (yet)
  | "no_keys" // the PC has no VAPID keys (or is the sandbox)
  | "server_error" // Mesa did not answer
  | "blocked" // the permission is denied: only the person can undo it, in the browser's settings
  | "off"
  | "on";

export function pushState(i: PushInputs): PushState {
  if (i.ios && !i.standalone) return "ios_install";
  if (!i.api) return "unsupported";
  if (i.server === "loading") return "loading";
  if (i.server === "no_keys" || i.server === "sandbox") return "no_keys";
  if (i.server === "error") return "server_error";
  if (i.worker === "unknown" || i.subscribed === null) return "loading";
  if (i.worker === "none") return "no_worker";
  if (i.permission === "denied") return "blocked";
  return i.subscribed && i.permission === "granted" ? "on" : "off";
}

export interface PushCopy {
  /** The one-line status. */
  status: string;
  /** What to do or why, when there is something to say. */
  hint?: string;
  /** The main button, when there is an action. */
  action?: "enable" | "disable";
}

const UNBLOCK: Record<Browser, string> = {
  opera: "Toca el candado junto a la dirección, luego Notificaciones, y elige Permitir. Si no ves el candado: menú de Opera, Ajustes, Ajustes del sitio, Notificaciones, y permite este sitio. Luego vuelve aquí.",
  chrome: "Toca el candado junto a la dirección, luego Permisos o Notificaciones, y elige Permitir. En la app instalada: mantén pulsado su ícono, Info de la app, Notificaciones. Luego vuelve aquí.",
  samsung: "Toca el menú, Ajustes, Sitios y descargas, Notificaciones, y permite este sitio. Luego vuelve aquí.",
  edge: "Toca el candado junto a la dirección, luego Permisos, Notificaciones, y elige Permitir. Luego vuelve aquí.",
  firefox: "Toca el candado junto a la dirección, luego Editar ajustes del sitio, Notificaciones, y elige Permitir. Luego vuelve aquí.",
  safari: "En Ajustes del iPhone, Notificaciones, busca Mesa y permite las notificaciones. Luego vuelve aquí.",
  other: "Abre la configuración del sitio en tu navegador (el candado junto a la dirección), permite las notificaciones de Mesa y vuelve aquí.",
};

export const unblockSteps = (browser: Browser): string => UNBLOCK[browser];

export function pushCopy(state: PushState, browser: Browser): PushCopy {
  switch (state) {
    case "loading":
      return { status: "Revisando los avisos de este teléfono…" };
    case "ios_install":
      return { status: "Los avisos en iPhone solo funcionan con Mesa instalada.", hint: "Toca Compartir, luego Agregar a inicio, abre Mesa desde el ícono y vuelve aquí (iOS 16.4 o más nuevo)." };
    case "unsupported":
      return { status: "Este navegador no puede recibir avisos con la app cerrada.", hint: "Prueba con Chrome u Opera en Android, o con Mesa instalada en iPhone." };
    case "no_worker":
      return { status: "Mesa todavía no activó su servicio en este navegador.", hint: "Recarga la página. Solo funciona en la versión instalada o publicada, no en desarrollo." };
    case "no_keys":
      return { status: "Mesa no tiene claves para enviar avisos.", hint: "En la PC faltan MESA_VAPID_PUBLIC_KEY, MESA_VAPID_PRIVATE_KEY y MESA_VAPID_SUBJECT (pnpm push:keys). Luego reinicia Mesa." };
    case "server_error":
      return { status: "No pude consultar a Mesa.", hint: "Revisa que la PC esté encendida y vuelve a abrir esta pantalla." };
    case "blocked":
      return { status: "Los avisos están bloqueados para Mesa en este navegador.", hint: unblockSteps(browser) };
    case "off":
      return { status: "Los avisos están apagados en este teléfono.", action: "enable" };
    case "on":
      return { status: "Recibes avisos en este teléfono, también con la app cerrada.", hint: "No suenan mientras miras Mesa en cualquier pantalla.", action: "disable" };
  }
}

/** The applicationServerKey the browser wants: bytes from the VAPID public key (base64url). */
export function urlBase64ToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** True when a subscription was made with this key (after the PC's keys change, the phone must subscribe again). */
export function sameKey(subscriptionKey: ArrayBuffer | null | undefined, publicKey: string): boolean {
  if (!subscriptionKey) return false;
  const a = new Uint8Array(subscriptionKey);
  const b = urlBase64ToBytes(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export type TestResult = "sent" | "gone" | "refused" | "no_keys" | "unreachable";

export const TEST_COPY: Record<TestResult, string> = {
  sent: "Aviso enviado. Debería llegar en unos segundos.",
  gone: "El servicio de avisos ya no conoce este teléfono. Apaga y vuelve a activar los avisos.",
  refused: "El servicio de avisos no aceptó la prueba. Intenta de nuevo en un momento.",
  no_keys: "Mesa no tiene claves para enviar avisos.",
  unreachable: "No pude hablar con Mesa. Revisa la conexión con tu PC.",
};

/** HTTP status of POST /api/push/test -> result. */
export function testResult(status: number): TestResult {
  if (status === 200) return "sent";
  if (status === 404) return "gone";
  if (status === 409) return "no_keys";
  if (status === 502) return "refused";
  return "unreachable";
}
