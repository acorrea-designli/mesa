"use client";
import qrcode from "qrcode-generator";
import { useMemo } from "react";

const QUIET = 4; // modules of quiet zone required by the spec

/** QR as inline SVG. Always dark modules on a light tile, in both themes: inverted codes fail on many scanners. */
export function QrCode({ text, size = 232, label }: { text: string; size?: number; label: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { d, n };
  }, [text]);
  const span = n + QUIET * 2;
  return (
    <svg className="tel-qr" width={size} height={size} viewBox={`${-QUIET} ${-QUIET} ${span} ${span}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-QUIET} y={-QUIET} width={span} height={span} fill="#fbfaf7" />
      <path d={d} fill="#1c1d21" />
    </svg>
  );
}
