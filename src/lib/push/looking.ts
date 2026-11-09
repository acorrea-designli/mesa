// "Someone is looking at Mesa": every visible, focused Mesa tab (desktop or phone) beats POST /api/push/looking a few
// seconds apart. While any beat is fresh the push notifier remembers new keys but sends nothing, the same quiet rule
// as the desktop notifier. In memory only: a restart forgets it, and the tabs beat again within seconds.

export const LOOKING_TTL_MS = 8000;
const MAX_TABS = 50;

export interface LookingRegistry {
  /** A tab reports whether it is looking now (looking=false clears it). */
  beat(tab: string, looking: boolean, now?: number): void;
  isLooking(now?: number): boolean;
}

export function createLooking(ttlMs = LOOKING_TTL_MS): LookingRegistry {
  const until = new Map<string, number>();
  const prune = (now: number) => {
    for (const [k, t] of until) if (t <= now) until.delete(k);
  };
  return {
    beat(tab, looking, now = Date.now()) {
      prune(now);
      if (!looking) {
        until.delete(tab);
        return;
      }
      if (!until.has(tab) && until.size >= MAX_TABS) return;
      until.set(tab, now + ttlMs);
    },
    isLooking(now = Date.now()) {
      prune(now);
      return until.size > 0;
    },
  };
}

const g = globalThis as unknown as { __mesaLooking?: LookingRegistry };

/** The process-wide registry (shared by the API route and the notifier across route bundles). */
export function lookingRegistry(): LookingRegistry {
  return (g.__mesaLooking ??= createLooking());
}
