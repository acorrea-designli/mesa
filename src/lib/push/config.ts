// VAPID keys for Web Push come from the environment only (MESA_VAPID_PUBLIC_KEY, MESA_VAPID_PRIVATE_KEY,
// MESA_VAPID_SUBJECT). Never in the repo: `pnpm push:keys` prints a fresh pair for .env.local.
// Missing or invalid values mean push is disabled (the phone UI says so); nothing else breaks.
import { isSandbox } from "../env";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** mailto: or https: URL, as the Web Push protocol asks. */
  subject: string;
}

/** Why push is off: no (or bad) keys, or the sandbox board, where nothing leaves. */
export type PushOff = "no_keys" | "sandbox";

export type PushStatus = { enabled: true; publicKey: string } | { enabled: false; reason: PushOff };

const B64URL = /^[A-Za-z0-9_-]+$/;

export function vapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.MESA_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.MESA_VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.MESA_VAPID_SUBJECT?.trim() ?? "";
  if (!B64URL.test(publicKey) || !B64URL.test(privateKey)) return null;
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

export function pushStatus(env: NodeJS.ProcessEnv = process.env): PushStatus {
  if (isSandbox(env)) return { enabled: false, reason: "sandbox" };
  const cfg = vapidConfig(env);
  return cfg ? { enabled: true, publicKey: cfg.publicKey } : { enabled: false, reason: "no_keys" };
}
