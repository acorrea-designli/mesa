#!/usr/bin/env node
// Draws the BrandMark (src/components/line/Line.tsx) into the PWA icons under public/, with no dependencies:
// a small supersampled rasterizer and a PNG writer. Tokio light colours (src/styles/tokens.css).
//   node scripts/make-icons.mjs
// icon-192.png, icon-512.png (purpose any), icon-maskable-512.png (mark inside the 80% safe circle),
// apple-touch-icon.png (180, opaque: iOS rounds it itself).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const OUT = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "public");

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const GND = rgb("#eceae5");
const INK = rgb("#1c1d21");
const GH = rgb("#e60012");
const SL = rgb("#00a3a8");

// BrandMark geometry, viewBox 0 0 28 28: round-capped 3.5 strokes and an open ring.
const HALF = 1.75;
const GH_LINE = [[3, 21], [12, 21], [19, 14], [25, 14]];
const SL_LINE = [[3, 14], [25, 14]];
const RING = { cx: 19, cy: 14, r: 3.2, stroke: 2 };
// Centre of the mark's bounding box and its width (stroke included), to centre and scale it.
const BOX = { cx: 14, cy: 16.3, w: 25.5 };

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const onPolyline = (x, y, pts) => pts.slice(1).some((p, i) => distToSegment(x, y, pts[i], p) <= HALF);

/** Colour of the mark at a point in viewBox units, or null for background. Later layers paint over earlier ones. */
function markColor(x, y) {
  const d = Math.hypot(x - RING.cx, y - RING.cy);
  if (d <= RING.r + RING.stroke / 2) return d >= RING.r - RING.stroke / 2 ? INK : GND;
  if (onPolyline(x, y, SL_LINE)) return SL;
  if (onPolyline(x, y, GH_LINE)) return GH;
  return null;
}

function render(size, fraction) {
  const scale = (fraction * size) / BOX.w; // pixels per viewBox unit
  const N = 4; // 4x4 samples per pixel
  const px = Buffer.alloc(size * size * 3);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0;
      for (let sj = 0; sj < N; sj++) {
        for (let si = 0; si < N; si++) {
          const x = BOX.cx + (i + (si + 0.5) / N - size / 2) / scale;
          const y = BOX.cy + (j + (sj + 0.5) / N - size / 2) / scale;
          const c = markColor(x, y) ?? GND;
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const o = (j * size + i) * 3;
      px[o] = Math.round(r / (N * N));
      px[o + 1] = Math.round(g / (N * N));
      px[o + 2] = Math.round(b / (N * N));
    }
  }
  return px;
}

function png(size, rgbData) {
  const chunk = (type, data) => {
    const t = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    rgbData.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync(OUT, { recursive: true });
const files = [
  ["icon-192.png", 192, 0.66],
  ["icon-512.png", 512, 0.66],
  ["icon-maskable-512.png", 512, 0.58], // the whole mark stays inside the central 80% circle
  ["apple-touch-icon.png", 180, 0.66],
];
for (const [name, size, fraction] of files) {
  writeFileSync(join(OUT, name), png(size, render(size, fraction)));
  console.log(`public/${name} ${size}x${size}`);
}
