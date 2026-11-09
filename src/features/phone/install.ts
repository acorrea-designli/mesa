// Install-prompt rules, pure so they are unit tested (the UI is InstallPrompt.tsx and PhoneScreen.tsx).
// Android/Chrome fire `beforeinstallprompt` when their own installability and engagement checks pass, and sometimes
// never; iOS Safari has no such event. So there are three offers: the native prompt, the iOS guide, and, on a phone
// where the event did not arrive in time, a written guide for the browser menu.

export const DISMISS_KEY = "mesa:install-dismissed-at";
export const REOFFER_AFTER_DAYS = 14;
/** How long to wait for `beforeinstallprompt` before the manual guide takes its place. */
export const PROMPT_WAIT_MS = 3000;
/** Same breakpoint as the phone layout (src/styles). */
export const PHONE_QUERY = "(max-width: 720px)";
const DAY_MS = 24 * 60 * 60 * 1000;

export type Platform = "ios" | "other";

/** iPhone, iPad and iPadOS 13+ (which reports itself as a Mac with a touch screen). */
export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return "ios";
  return "other";
}

export type Browser = "opera" | "samsung" | "edge" | "firefox" | "chrome" | "safari" | "other";

/** The browser from the user agent. Order matters: Opera, Samsung and Edge all say "Chrome" too. */
export function detectBrowser(ua: string): Browser {
  if (/OPR\/|OPT\/|OPiOS|Opera/i.test(ua)) return "opera";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/EdgA?\/|EdgiOS/i.test(ua)) return "edge";
  if (/Firefox\/|FxiOS/i.test(ua)) return "firefox";
  if (/Chrome\/|CriOS/i.test(ua)) return "chrome";
  if (/Safari\//i.test(ua)) return "safari";
  return "other";
}

const BROWSER_LABEL: Record<Browser, string> = {
  opera: "Opera",
  samsung: "Samsung Internet",
  edge: "Edge",
  firefox: "Firefox",
  chrome: "Chrome",
  safari: "Safari",
  other: "otro navegador",
};

export const browserLabel = (b: Browser) => BROWSER_LABEL[b];

export interface Guide {
  /** Who it is for, as a label ("Opera", "iPhone"). */
  who: string;
  /** The steps in one sentence, plain text: labels match what the menus say, kept short because versions vary. */
  text: string;
}

const GUIDE_IOS: Guide = { who: "iPhone", text: "Toca Compartir y luego Agregar a inicio." };
const GUIDE_OPERA: Guide = { who: "Opera", text: "Toca el menú (⋮ o la O de Opera), luego Añadir a… y Pantalla de inicio." };
const GUIDE_SAMSUNG: Guide = { who: "Samsung Internet", text: "Toca el menú, luego Añadir página a y Pantalla de inicio." };
const GUIDE_ANDROID: Guide = { who: "Chrome y otros", text: "Toca ⋮ y luego Instalar app o Agregar a pantalla principal." };

/** The written steps for this device: the browser's own on a phone, every guide on a wide screen (the PC). */
export function guidesFor(platform: Platform, browser: Browser, phoneSized: boolean): Guide[] {
  if (platform === "ios") return [GUIDE_IOS];
  if (!phoneSized) return [GUIDE_ANDROID, GUIDE_OPERA, GUIDE_SAMSUNG, GUIDE_IOS];
  if (browser === "opera") return [GUIDE_OPERA];
  if (browser === "samsung") return [GUIDE_SAMSUNG];
  return [GUIDE_ANDROID];
}

/** Was the banner dismissed less than 14 days ago? `raw` is the stored ISO date or epoch ms (junk reads as not dismissed). */
export function recentlyDismissed(raw: string | null, now = Date.now()): boolean {
  if (!raw) return false;
  const at = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(at)) return false;
  return now - at < REOFFER_AFTER_DAYS * DAY_MS && now >= at;
}

export interface OfferInput {
  /** From the user agent; the manual guide words its steps for it. */
  browser?: Browser;
  standalone: boolean;
  platform: Platform;
  /** A `beforeinstallprompt` event is waiting (Chrome, Edge, Android). */
  hasPrompt: boolean;
  dismissedRaw: string | null;
  /** The window is phone-sized (PHONE_QUERY). */
  phoneSized?: boolean;
  /** PROMPT_WAIT_MS passed since the page loaded without the event arriving. */
  waited?: boolean;
  now?: number;
}

export type Offer = "prompt" | "ios" | "manual";

/**
 * What the banner shows: the native prompt, the iOS guide, the manual browser-menu guide, or nothing (installed,
 * dismissed, still waiting for the event, or a wide window where the browser's own install icon is enough).
 */
export function offerKind(i: OfferInput): Offer | null {
  if (i.standalone) return null;
  if (recentlyDismissed(i.dismissedRaw, i.now)) return null;
  if (i.hasPrompt) return "prompt";
  if (i.platform === "ios") return "ios";
  if (i.phoneSized && i.waited) return "manual";
  return null;
}

export type SwState = "unknown" | "unsupported" | "none" | "registered" | "active";

export interface DiagnosticInput extends OfferInput {
  secure: boolean;
  sw: SwState;
}

export interface DiagnosticRow {
  key: string;
  label: string;
  value: string;
}

const SW_LABEL: Record<SwState, string> = {
  unknown: "comprobando",
  unsupported: "este navegador no lo tiene",
  none: "no registrado",
  registered: "registrado, sin activar",
  active: "activo",
};

/** The install state as labelled rows, in Spanish, for /telefono. Facts about this device only; nothing secret. */
export function installDiagnostics(i: DiagnosticInput): DiagnosticRow[] {
  const dismissed = recentlyDismissed(i.dismissedRaw, i.now);
  return [
    { key: "standalone", label: "Instalada", value: i.standalone ? "sí, abierta como app" : "no, abierta en el navegador" },
    { key: "platform", label: "Dispositivo", value: i.platform === "ios" ? "iPhone o iPad" : "Android u otro" },
    { key: "browser", label: "Navegador", value: browserLabel(i.browser ?? "other") },
    { key: "phone", label: "Pantalla", value: i.phoneSized ? "de teléfono" : "ancha" },
    { key: "secure", label: "Conexión segura (https)", value: i.secure ? "sí" : "no" },
    { key: "hasPrompt", label: "Aviso de instalar del navegador", value: i.hasPrompt ? "disponible" : i.platform === "ios" ? "no existe en iPhone" : i.waited ? "no llegó" : "esperando" },
    { key: "dismissed", label: "Aviso de Mesa", value: dismissed ? "oculto" : "visible cuando se pueda" },
    { key: "sw", label: "Service worker", value: SW_LABEL[i.sw] },
  ];
}

export type InstallStatus = "installed" | "prompt" | "dismissed" | "ios" | "manual" | "waiting" | "wide";

/** The one-line state of /telefono's install section. `dismissed` wins over the guides so the way back is visible. */
export function installStatus(i: OfferInput): InstallStatus {
  if (i.standalone) return "installed";
  if (i.hasPrompt) return "prompt";
  if (recentlyDismissed(i.dismissedRaw, i.now)) return "dismissed";
  if (i.platform === "ios") return "ios";
  if (i.phoneSized && i.waited) return "manual";
  return i.phoneSized ? "waiting" : "wide";
}
