// Stall probe (t206): a worker thread that watches the main thread's heartbeat and, when it stops, writes a line to stderr
// straight from the worker (fs.writeSync, no help from the blocked loop) saying how long the thread has been stuck, what
// tracked synchronous call it is inside (sync-mark.ts: a SQLite statement or a spawn, with its SQL or command) and how much
// CPU the whole process used meanwhile. "idle CPU, in sqlite" is a lock or a disk wait; "idle CPU, no tracked call" is the
// OS holding the process (disk, page faults, antivirus, suspend); "busy CPU" is JavaScript. The worker is unref'd and runs
// from a code string so the bundler never touches it (worker.unref() lets the process exit without it).
import { Worker } from "node:worker_threads";
import { DETAIL_BYTES, DETAIL_OFFSET, KINDS, markState } from "./sync-mark";

export const PROBE_EVERY_MS = 500;
export const PROBE_STALL_MS = 2_000;

const WORKER_SOURCE = `
const fs = require("node:fs");
const { workerData } = require("node:worker_threads");
const { sab, kinds, detailOffset, detailBytes, everyMs, stallMs, fd } = workerData;
const nums = new Float64Array(sab, 0, 3);
const detail = new Uint8Array(sab, detailOffset, detailBytes);
const write = (s) => { try { fs.writeSync(fd, s + "\\n"); } catch {} };
let reported = 0; // ms of the last report, 0 = none
let stalledSince = 0; // heartbeat the stall started after
let cpuOk = process.cpuUsage();
setInterval(() => {
  const now = Date.now();
  const beat = nums[1];
  if (!beat) return;
  const gap = now - beat;
  if (gap < stallMs) {
    if (reported) write("[mesa] main thread responsive again after about " + ((beat - stalledSince) / 1000).toFixed(1) + "s");
    reported = 0; cpuOk = process.cpuUsage();
    return;
  }
  if (reported && now - reported < 10000) return; // one line at detection, then every 10 s
  const cpu = process.cpuUsage(cpuOk);
  const cpuMs = Math.round((cpu.user + cpu.system) / 1000);
  let where = "no tracked sync call";
  const start = nums[0];
  if (start) {
    let s = "";
    for (let i = 0; i < detailBytes && detail[i]; i++) s += String.fromCharCode(detail[i]);
    where = "in " + kinds[nums[2]] + " for " + ((now - start) / 1000).toFixed(1) + "s: " + s;
  }
  write("[mesa] main thread unresponsive for " + (gap / 1000).toFixed(1) + "s (process cpu +" + cpuMs + "ms since the last beat); " + where);
  if (!reported) stalledSince = beat;
  reported = now;
}, everyMs);
`;

const g = globalThis as unknown as { __mesaStallProbe?: { worker: Worker; beat: NodeJS.Timeout } };

/** Start the probe once per process. `fd` is where the worker writes (stderr by default). */
export function startStallProbe(o: { fd?: number; everyMs?: number; stallMs?: number } = {}): void {
  if (g.__mesaStallProbe) return;
  const m = markState();
  const everyMs = o.everyMs ?? PROBE_EVERY_MS;
  m.nums[1] = Date.now();
  const beat = setInterval(() => {
    m.nums[1] = Date.now();
  }, Math.max(50, Math.floor(everyMs / 2)));
  beat.unref();
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { sab: m.sab, kinds: [...KINDS], detailOffset: DETAIL_OFFSET, detailBytes: DETAIL_BYTES, everyMs, stallMs: o.stallMs ?? PROBE_STALL_MS, fd: o.fd ?? 2 },
  });
  worker.unref();
  worker.on("error", (err) => console.warn("[mesa] stall probe stopped", err));
  g.__mesaStallProbe = { worker, beat };
}

/** Stop the probe (tests). */
export async function stopStallProbe(): Promise<void> {
  const p = g.__mesaStallProbe;
  if (!p) return;
  clearInterval(p.beat);
  await p.worker.terminate();
  delete g.__mesaStallProbe;
  markState().nums[1] = 0;
}
