// The server-side notifier (t33): the desktop notifier's job done on the PC, so the phone is told with the app closed.
//
// It scans the waiting set (tickets in "Te espera", salidas to sign, pending permissions) and asks the same pure
// decide() as the desktop which entries are new. It scans on every relevant change (debounced) and every 30 s.
// The seen keys and the time of the last scan are persisted, so a restart within 10 minutes scans normally (what
// entered waiting meanwhile is news) and an older one is a silent baseline (nothing floods after a long outage).
// While any Mesa tab reports looking, new keys are remembered and nothing is sent, except a meeting reminder (t112: ten
// minutes before a meeting he has not declined; it carries the meeting's title and ignores the quiet rule and the
// baseline). Never started in the sandbox.
import { decide, HOY_TAG, shouldBaseline } from "@/features/notify/decide";
import { isSandbox } from "../env";
import { subscribeChanges } from "../live/bus";
import { repos, type Repos } from "../repo";
import { collectWaiting } from "./collect";
import { vapidConfig } from "./config";
import { lookingRegistry, type LookingRegistry } from "./looking";
import { TEST_PAYLOAD } from "./payload";
import { deliver, webPushSender, type DeliverResult, type Sender } from "./send";

export const SCAN_DEBOUNCE_MS = 400;
export const TICK_MS = 30_000;
const TYPES = new Set(["ticket", "salida", "review", "approval", "item", "calendar"]);

export interface ScanDeps {
  repos: Repos;
  sender: Sender;
  looking: Pick<LookingRegistry, "isLooking">;
}

export interface ScanResult {
  /** The scan was a silent baseline (nothing sent whatever entered waiting). */
  baseline: boolean;
  /** A visible tab was looking: new keys were remembered, nothing sent. */
  quiet: boolean;
  /** Entries chosen to send. */
  shown: number;
  delivery: DeliverResult;
}

/** One scan: decide, persist, then send. The seen keys are saved before sending, so a crash never repeats a push. */
export async function scanOnce(deps: ScanDeps, now = Date.now()): Promise<ScanResult> {
  const { repos: r, sender, looking } = deps;
  const seen = r.push.seen();
  const baseline = shouldBaseline(r.push.lastScan(), now);
  const quiet = looking.isLooking(now);
  const waiting = collectWaiting(r, baseline ? null : seen, new Date(now));
  const d = decide({ seen, waiting, now, baseline, quiet, hoy: true });
  r.push.saveScan(d.seen, now);

  const delivery: DeliverResult = { sent: 0, removed: 0, failed: 0 };
  for (const s of d.show) {
    // What arrived in Hoy is one push per scan (the decision already batched it) under one tag, so a newer one alerts again.
    const payload = { title: s.title, url: s.url, tag: s.hoy ? HOY_TAG : s.key, ...(s.meeting ? { body: s.body } : {}) };
    const res = await deliver(r.push, sender, r.push.list(), payload, new Date(now));
    delivery.sent += res.sent;
    delivery.removed += res.removed;
    delivery.failed += res.failed;
  }
  return { baseline, quiet, shown: d.show.length, delivery };
}

/** "Probar aviso": a test push to one device (the one that asked). Nothing is sent when the endpoint is unknown. */
export function sendTest(r: Repos, sender: Sender, endpoint: string): Promise<DeliverResult> {
  const sub = r.push.get(endpoint);
  return deliver(r.push, sender, sub ? [sub] : [], TEST_PAYLOAD);
}

const g = globalThis as unknown as { __mesaPush?: { stop(): void } };

/** Start the notifier. Idempotent across hot reloads; a no-op without VAPID keys or in the sandbox. */
export function startPushNotifier(): void {
  if (g.__mesaPush) return;
  if (isSandbox()) return;
  if (!vapidConfig()) {
    console.info("[mesa] push: disabled (set MESA_VAPID_PUBLIC_KEY, MESA_VAPID_PRIVATE_KEY and MESA_VAPID_SUBJECT; `pnpm push:keys` makes a pair)");
    return;
  }
  const sender = pushSender();
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        try {
          await scanOnce({ repos: repos(), sender, looking: lookingRegistry() });
        } catch (err) {
          console.error("[mesa] push scan failed", err);
        }
      } while (again);
    } finally {
      running = false;
    }
  };
  const poke = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), SCAN_DEBOUNCE_MS);
  };

  const off = subscribeChanges((c) => {
    if (TYPES.has(c.entityType)) poke();
  });
  const tick = setInterval(() => void run(), TICK_MS);
  tick.unref();
  g.__mesaPush = {
    stop() {
      off();
      clearInterval(tick);
      if (timer) clearTimeout(timer);
      delete g.__mesaPush;
    },
  };
  console.info("[mesa] push: on");
  void run();
}

/** The production sender (a failing one when there are no keys). Used by the API routes. */
export function pushSender(): Sender {
  const cfg = vapidConfig();
  if (!cfg) return async () => ({ ok: false, status: null, message: "push is not configured" });
  return webPushSender(cfg);
}
