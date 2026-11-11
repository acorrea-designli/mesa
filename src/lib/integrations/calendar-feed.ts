// Reading Andrés's private iCal (ICS) feed, server side (t112). The address is a secret: it comes from
// MESA_GCAL_ICS_URL (.env.local), is used only to fetch, and appears in no log, no error, no health note and no API
// response. Every failure here is reported with a fixed phrase that does not include the address.
import { isSandbox } from "../env";

/** The environment as a plain map: tests pass a few variables, production passes process.env. */
export type Env = Record<string, string | undefined>;

export interface FeedConfig {
  /** The address, validated. Never log or return it. */
  url: string;
  ownerEmail: string | null;
}

export type FeedConfigState = { state: "off" } | { state: "invalid" } | { state: "ready"; config: FeedConfig };

/** off: no variable (or sandbox / MESA_CALENDAR=off); invalid: set but not an https address; ready: poll it. */
export function feedConfig(env: Env = process.env): FeedConfigState {
  if (isSandbox(env as NodeJS.ProcessEnv)) return { state: "off" };
  const flag = env.MESA_CALENDAR?.trim().toLowerCase();
  if (flag === "off" || flag === "0" || flag === "false") return { state: "off" };
  const raw = env.MESA_GCAL_ICS_URL?.trim();
  if (!raw) return { state: "off" };
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return { state: "invalid" };
  } catch {
    return { state: "invalid" };
  }
  return { state: "ready", config: { url: raw, ownerEmail: env.MESA_GCAL_OWNER_EMAIL?.trim().toLowerCase() || null } };
}

/** The reason a read failed, in words that never contain the address. */
export class FeedError extends Error {
  constructor(
    readonly kind: "http" | "timeout" | "network" | "format" | "size",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FeedError";
  }
}

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string>; redirect: "follow" }) => Promise<Pick<Response, "ok" | "status" | "text" | "headers">>;

/** One GET of the feed. Throws a FeedError whose message is safe to store and show. */
export async function fetchFeed(config: FeedConfig, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<string> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(config.url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "text/calendar, text/plain;q=0.8, */*;q=0.5" }, redirect: "follow" });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new FeedError("timeout", "Google no respondió a tiempo");
    throw new FeedError("network", "sin conexión con Google");
  }
  if (!res.ok) {
    // Workspace can block the private address: 403/404 are the usual answers.
    const blocked = res.status === 403 || res.status === 404 || res.status === 401;
    throw new FeedError("http", blocked ? `Google no entrega el calendario (HTTP ${res.status})` : `Google respondió HTTP ${res.status}`, res.status);
  }
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new FeedError("size", "el calendario es demasiado grande");
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new FeedError("size", "el calendario es demasiado grande");
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new FeedError("format", "la respuesta no es un calendario iCal");
  return text;
}
