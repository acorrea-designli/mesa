// Line band geometry (pure, unit tested). Coordinates follow the approved mock
// (.impeccable/mocks/screens/hoy.html): a 1256 x 236 SVG with four source lines
// through five station capsules. Station x positions scale with the width; bends,
// tick spacing and text stay at fixed px so lines keep their 45 degree bends.
import { SOURCES, STATIONS, type Source, type Station } from "../../lib/domain/types";

export const BAND_W = 1256;
export const BAND_H = 236;
const X0 = 44;
const X1_FROM_RIGHT = 44; // lines end at width - 44 (1212 in the mock)
const MOCK_CAPS = [256, 500, 744, 988, 1200];
export const CAP_W = 40;
export const CAP_TOP = 62;
export const CAP_H = 148;
export const TICK_STEP = 36;
export const TICK_R = 5;
export const RING_R = 8.5;
/** Most interchange rings drawn per station; extra pairs count into "+N". */
export const MAX_RINGS = 2;

/** Lines top to bottom. */
export const LINE_ORDER: readonly Source[] = ["github", "slack", "claude", "basecamp"];
export const LINE_Y: Record<Source, number> = { github: 100, slack: 124, claude: 148, basecamp: 172 };

/**
 * Signature bends (45 degrees, 24 px): GitHub climbs just before Todo, Basecamp
 * drops just before En curso. `beforeCap` is the station the bend leads into and
 * `gap` how far before that capsule's centre the bend ends.
 */
const BENDS: Partial<Record<Source, { beforeCap: number; gap: number; dy: number }>> = {
  github: { beforeCap: 1, gap: 16, dy: -24 },
  basecamp: { beforeCap: 2, gap: 20, dy: 24 },
};

export interface BandItem {
  id: string;
  source: Source;
  station: Station;
  /** Items sharing a task with another source become an interchange. */
  taskId?: string | null;
}

export interface BandTick {
  id: string;
  source: Source;
  station: Station;
  x: number;
  y: number;
}

export interface BandRing {
  /** The two items joined by the interchange (upper line first). */
  ids: [string, string];
  station: Station;
  upper: { source: Source; x: number; y: number };
  lower: { source: Source; x: number; y: number };
}

export interface BandMore {
  source: Source;
  station: Station;
  x: number;
  y: number;
  n: number;
}

export interface BandLayout {
  width: number;
  caps: { station: Station; x: number }[];
  lines: { source: Source; d: string }[];
  ticks: BandTick[];
  rings: BandRing[];
  more: BandMore[];
}

/** Station capsule centres for a band of `width` px. */
export function capCenters(width: number = BAND_W): number[] {
  const k = (width - X0 - X1_FROM_RIGHT) / (BAND_W - X0 - X1_FROM_RIGHT);
  // The last capsule stays 56 px from the edge so every line ends inside it.
  return MOCK_CAPS.map((x, i) => (i === MOCK_CAPS.length - 1 ? width - 56 : X0 + (x - X0) * k));
}

function bendOf(source: Source, caps: number[]) {
  const b = BENDS[source];
  if (!b) return null;
  const end = (caps[b.beforeCap] ?? 0) - b.gap;
  return { from: end - Math.abs(b.dy), to: end, dy: b.dy };
}

/** y of a line at x (follows its 45 degree bend). */
export function lineY(source: Source, x: number, caps: number[] = capCenters()): number {
  const base = LINE_Y[source];
  const b = bendOf(source, caps);
  if (!b || x <= b.from) return base;
  if (x >= b.to) return base + b.dy;
  return base + ((x - b.from) / (b.to - b.from)) * b.dy;
}

/** SVG path of a line from the left edge to `xEnd` (default: the end of the band). */
export function linePath(source: Source, width: number = BAND_W, xEnd?: number): string {
  const caps = capCenters(width);
  const end = Math.min(xEnd ?? width - X1_FROM_RIGHT, width - X1_FROM_RIGHT);
  const y = LINE_Y[source];
  const b = bendOf(source, caps);
  const r = (n: number) => Math.round(n * 10) / 10;
  if (!b || end <= b.from) return `M${X0} ${y}H${r(end)}`;
  if (end < b.to) return `M${X0} ${y}H${r(b.from)}L${r(end)} ${r(lineY(source, end, caps))}`;
  return `M${X0} ${y}H${r(b.from)}l${Math.abs(b.dy)} ${b.dy}H${r(end)}`;
}

/** The station segment where its ticks sit: between the previous capsule and its own. */
export function segment(i: number, caps: number[]): { left: number; right: number; start: number } {
  const capX = caps[i] ?? 0;
  const left = i === 0 ? X0 : (caps[i - 1] ?? 0) + CAP_W / 2;
  const right = capX - CAP_W / 2;
  return { left, right, start: left + (i === 0 ? 52 : 40) };
}

/** Split a station's items into interchange pairs (two sources on one task) and single ticks. */
export function pairUp(items: BandItem[]): { pairs: [BandItem, BandItem][]; singles: BandItem[] } {
  const byTask = new Map<string, BandItem[]>();
  for (const it of items) if (it.taskId) byTask.set(it.taskId, [...(byTask.get(it.taskId) ?? []), it]);
  const paired = new Set<string>();
  const pairs: [BandItem, BandItem][] = [];
  for (const group of byTask.values()) {
    const first = group[0];
    const other = first && group.find((g) => g.source !== first.source);
    if (!first || !other) continue;
    const [a, b] = LINE_ORDER.indexOf(first.source) < LINE_ORDER.indexOf(other.source) ? [first, other] : [other, first];
    pairs.push([a, b]);
    paired.add(a.id).add(b.id);
  }
  return { pairs, singles: items.filter((i) => !paired.has(i.id)) };
}

/**
 * Lay out a band: lines, capsules, one tick per item in the segment before its
 * station, interchange rings joined by a 45 degree connector near the capsule,
 * and "+N" where a line runs out of room.
 */
export function layoutBand(items: BandItem[], width: number = BAND_W): BandLayout {
  const caps = capCenters(width);
  const ticks: BandTick[] = [];
  const rings: BandRing[] = [];
  const more: BandMore[] = [];

  STATIONS.forEach((station, si) => {
    const seg = segment(si, caps);
    const here = items.filter((i) => i.station === station);
    const { pairs, singles } = pairUp(here);
    // Rightmost room per line: shrinks as rings take space near the capsule.
    const limit: Record<Source, number> = Object.fromEntries(
      SOURCES.map((s) => {
        let l = seg.right - 24;
        const b = bendOf(s, caps);
        if (b && b.from > seg.left && b.from < seg.right) l = Math.min(l, b.from - 12);
        return [s, l];
      }),
    ) as Record<Source, number>;
    const extra: Record<Source, number> = Object.fromEntries(SOURCES.map((s) => [s, 0])) as Record<Source, number>;

    pairs.forEach(([a, b], j) => {
      if (j >= MAX_RINGS) {
        extra[a.source] += 1;
        extra[b.source] += 1;
        return;
      }
      // A later pair sits left of everything the earlier connectors crossed.
      const span = Math.abs(LINE_Y[b.source] - LINE_Y[a.source]);
      const ux = j === 0 ? seg.right - 32 : Math.min(limit[a.source] + 12, limit[b.source] + 12 + span);
      if (ux - span < seg.start - 12) {
        extra[a.source] += 1;
        extra[b.source] += 1;
        return;
      }
      const uy = lineY(a.source, ux, caps);
      const ly = lineY(b.source, ux, caps);
      const lx = ux - Math.abs(ly - uy); // 45 degrees down and left
      rings.push({ ids: [a.id, b.id], station, upper: { source: a.source, x: ux, y: uy }, lower: { source: b.source, x: lx, y: ly } });
      // Keep ticks clear of the rings and of the connector where it crosses the lines between them.
      const from = LINE_ORDER.indexOf(a.source);
      const to = LINE_ORDER.indexOf(b.source);
      for (const s of LINE_ORDER.slice(from, to + 1)) {
        const cross = ux - Math.abs(lineY(s, ux, caps) - uy);
        limit[s] = Math.min(limit[s], cross - 24);
      }
    });

    for (const source of LINE_ORDER) {
      const mine = singles.filter((i) => i.source === source);
      const n = mine.length + extra[source];
      if (!n) continue;
      const offset = (LINE_ORDER.indexOf(source) % 2) * (TICK_STEP / 2);
      const first = seg.start + offset;
      const room = Math.max(0, Math.floor((limit[source] - first) / TICK_STEP) + 1);
      const overflow = n > room;
      const shown = overflow ? Math.max(0, room - 1) : mine.length;
      mine.slice(0, shown).forEach((it, k) => {
        const x = first + k * TICK_STEP;
        ticks.push({ id: it.id, source, station, x, y: lineY(source, x, caps) });
      });
      if (overflow && room > 0) {
        const x = first + shown * TICK_STEP;
        more.push({ source, station, x, y: lineY(source, x, caps), n: n - shown });
      }
    }
  });

  return {
    width,
    caps: STATIONS.map((station, i) => ({ station, x: caps[i] ?? 0 })),
    lines: LINE_ORDER.map((source) => ({ source, d: linePath(source, width) })),
    ticks,
    rings,
    more,
  };
}

/** Where the solid part of the lines ends for a selected station (just past its capsule). */
export function solidEnd(station: Station, width: number = BAND_W): number {
  return (capCenters(width)[STATIONS.indexOf(station)] ?? 0) + 44;
}

// ---------- phone corridor ----------

/** Phone corridor (telefono.html frame 1): 388 x 136, the selected station at x 200..234. */
export const CORR_W = 388;
export const CORR_H = 136;
export const CORR_CAP_X = 200;
export const CORR_CAP_W = 34;
export const CORR_Y: Record<Source, number> = { github: 46, slack: 62, claude: 78, basecamp: 94 };
const CORR_START = 44;
const CORR_STEP = 32;
const CORR_LIMIT = 180;

export interface CorridorLayout {
  ticks: BandTick[];
  rings: BandRing[];
  more: BandMore[];
}

/** Ticks of the selected station only, laid along the lines that run into its capsule. */
export function layoutCorridor(items: BandItem[]): CorridorLayout {
  const ticks: BandTick[] = [];
  const rings: BandRing[] = [];
  const more: BandMore[] = [];
  const { pairs, singles } = pairUp(items);
  const limit: Record<Source, number> = Object.fromEntries(SOURCES.map((s) => [s, CORR_LIMIT])) as Record<Source, number>;
  const extra: Record<Source, number> = Object.fromEntries(SOURCES.map((s) => [s, 0])) as Record<Source, number>;

  pairs.forEach(([a, b], j) => {
    if (j >= MAX_RINGS) {
      extra[a.source] += 1;
      extra[b.source] += 1;
      return;
    }
    const ux = 164 - j * CORR_STEP;
    const uy = CORR_Y[a.source];
    const ly = CORR_Y[b.source];
    const lx = ux - (ly - uy);
    rings.push({ ids: [a.id, b.id], station: a.station, upper: { source: a.source, x: ux, y: uy }, lower: { source: b.source, x: lx, y: ly } });
    limit[a.source] = Math.min(limit[a.source], ux - 20);
    limit[b.source] = Math.min(limit[b.source], lx - 20);
  });

  for (const source of LINE_ORDER) {
    const mine = singles.filter((i) => i.source === source);
    const n = mine.length + extra[source];
    if (!n) continue;
    const first = CORR_START + (LINE_ORDER.indexOf(source) % 2) * (CORR_STEP / 2);
    const room = Math.max(0, Math.floor((limit[source] - first) / CORR_STEP) + 1);
    const overflow = n > room;
    const shown = overflow ? Math.max(0, room - 1) : mine.length;
    mine.slice(0, shown).forEach((it, k) => ticks.push({ id: it.id, source, station: it.station, x: first + k * CORR_STEP, y: CORR_Y[source] }));
    if (overflow && room > 0) more.push({ source, station: mine[0]?.station ?? "inbox", x: first + shown * CORR_STEP, y: CORR_Y[source], n: n - shown });
  }
  return { ticks, rings, more };
}
