// Names the synchronous calls that can hold the event loop (t206). node:sqlite statements and process spawns run on the
// loop thread and block it for as long as the OS makes them wait (a lock held by another connection up to busy_timeout,
// an fsync on a loaded disk, CreateProcess behind an antivirus). Each such call is wrapped in `syncMark`, which
//  - logs `[mesa] slow sync <kind> <ms>: <detail>` when it took SLOW_SYNC_MS or more, and
//  - publishes what the loop thread is inside right now in a SharedArrayBuffer, so the stall probe (a worker thread, see
//    startStallProbe) can say "main thread unresponsive for 12 s, in sqlite BEGIN IMMEDIATE" while the loop is still stuck.
// The state lives on globalThis: instrumentation and the route handlers are separate bundles in one process.

export const SLOW_SYNC_MS = 250;
export const KINDS = ["", "sqlite", "spawn"] as const;
export type SyncKind = (typeof KINDS)[number];

/** Layout of the shared buffer: [0] mark start (epoch ms, 0 = none), [1] heartbeat (epoch ms), [2] kind index; then DETAIL_BYTES. */
export const DETAIL_OFFSET = 3 * 8;
export const DETAIL_BYTES = 120;
export const MARK_BYTES = DETAIL_OFFSET + DETAIL_BYTES;

interface MarkState {
  sab: SharedArrayBuffer;
  nums: Float64Array;
  detail: Uint8Array;
  depth: number;
}
const gm = globalThis as unknown as { __mesaSyncMark?: MarkState };

export function markState(): MarkState {
  if (!gm.__mesaSyncMark) {
    const sab = new SharedArrayBuffer(MARK_BYTES);
    gm.__mesaSyncMark = { sab, nums: new Float64Array(sab, 0, 3), detail: new Uint8Array(sab, DETAIL_OFFSET, DETAIL_BYTES), depth: 0 };
  }
  return gm.__mesaSyncMark;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Run `fn` as a tracked synchronous call. Nested calls keep the outermost mark. */
export function syncMark<T>(kind: Exclude<SyncKind, "">, detail: string, fn: () => T): T {
  const m = markState();
  const t0 = Date.now();
  // Nothing between the depth increment and the try may throw (exec(undefined) must reach node's own error with depth intact),
  // so the publish below only touches a string and plain typed arrays, and is skipped for any other value.
  if (m.depth === 0 && typeof detail === "string") publish(m, kind, detail, t0);
  m.depth++;
  try {
    return fn();
  } finally {
    if (--m.depth === 0) m.nums[0] = 0;
    const ms = Date.now() - t0;
    if (ms >= SLOW_SYNC_MS) console.warn(`[mesa] slow sync ${kind} ${ms}ms: ${oneLine(String(detail)).slice(0, 160)}`);
  }
}

/** Copy the first DETAIL_BYTES of `detail` into the shared buffer, collapsing whitespace runs and trimming, without allocating. */
function publish(m: MarkState, kind: Exclude<SyncKind, "">, detail: string, t0: number): void {
  let n = 0;
  let space = true; // true while at the start or after a space: skips leading whitespace and collapses runs
  for (let i = 0; i < detail.length && n < DETAIL_BYTES; i++) {
    const c = detail.charCodeAt(i);
    if (c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029) {
      if (!space) m.detail[n++] = 32;
      space = true;
    } else {
      m.detail[n++] = c & 0x7f;
      space = false;
    }
  }
  if (space && n > 0) n--; // trailing space
  if (n < DETAIL_BYTES) m.detail[n] = 0;
  m.nums[2] = KINDS.indexOf(kind);
  m.nums[0] = t0;
}
