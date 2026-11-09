// Small stroke icons from the approved mocks (Tickets, Salidas). currentColor only.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const IcChevRight = (p: P) => (
  <svg width="12" height="12" viewBox="0 0 12 12" {...base} strokeWidth={1.7} {...p}>
    <path d="M4 2.5L7.5 6 4 9.5" />
  </svg>
);
export const IcChevDown = (p: P) => (
  <svg width="12" height="12" viewBox="0 0 12 12" {...base} strokeWidth={1.7} {...p}>
    <path d="M2.5 4.5L6 8l3.5-3.5" />
  </svg>
);
export const IcBack = (p: P) => (
  <svg width="14" height="14" viewBox="0 0 16 16" {...base} strokeWidth={1.8} {...p}>
    <path d="M10 3L5 8l5 5" />
  </svg>
);
export const IcExpand = (p: P) => (
  <svg width="16" height="16" viewBox="0 0 16 16" {...base} strokeWidth={1.7} {...p}>
    <path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9" />
  </svg>
);
export const IcCollapse = (p: P) => (
  <svg width="16" height="16" viewBox="0 0 16 16" {...base} strokeWidth={1.7} {...p}>
    <path d="M13.5 6.5h-4v-4M9.5 6.5L14 2M2.5 9.5h4v4M6.5 9.5L2 14" />
  </svg>
);
export const IcPencil = (p: P) => (
  <svg width="14" height="14" viewBox="0 0 14 14" {...base} strokeWidth={1.6} {...p}>
    <path d="M9.5 2.5l2 2L5 11H3V9z" />
  </svg>
);
export const IcCheck = (p: P) => (
  <svg width="14" height="14" viewBox="0 0 14 14" {...base} strokeWidth={1.8} {...p}>
    <path d="M2.5 7.5l3 3 6-7" />
  </svg>
);
export const IcExternal = (p: P) => (
  <svg width="13" height="13" viewBox="0 0 14 14" {...base} strokeWidth={1.6} {...p}>
    <path d="M8 2h4v4M12 2L6.5 7.5M10 8.5V12H2V4h3.5" />
  </svg>
);
export const IcClip = (p: P) => (
  <svg width="16" height="16" viewBox="0 0 16 16" {...base} strokeWidth={1.6} {...p}>
    <path d="M13 7.5L8 12.5a3 3 0 01-4.3-4.3l5.3-5.3a2 2 0 012.8 2.8L6.6 10.9a1 1 0 01-1.4-1.4L10 4.6" />
  </svg>
);
export const IcCopy = (p: P) => (
  <svg width="14" height="14" viewBox="0 0 14 14" {...base} strokeWidth={1.6} {...p}>
    <rect x="4.5" y="4.5" width="7.5" height="7.5" rx="1.5" />
    <path d="M2 9.5V3a1 1 0 011-1h6.5" />
  </svg>
);
export const IcX = (p: P) => (
  <svg width="10" height="10" viewBox="0 0 10 10" {...base} strokeWidth={1.7} {...p}>
    <path d="M2 2l6 6M8 2L2 8" />
  </svg>
);
export const IcPlus = (p: P) => (
  <svg width="14" height="14" viewBox="0 0 14 14" {...base} strokeWidth={1.8} {...p}>
    <path d="M7 2v10M2 7h10" />
  </svg>
);
export const IcUndo = (p: P) => (
  <svg width="14" height="14" viewBox="0 0 16 16" {...base} strokeWidth={1.7} {...p}>
    <path d="M5 3L2 6l3 3" />
    <path d="M2 6h7.5a4.5 4.5 0 010 9H6" />
  </svg>
);
export const IcRetry = (p: P) => (
  <svg width="14" height="14" viewBox="0 0 16 16" {...base} strokeWidth={1.7} {...p}>
    <path d="M13.5 8A5.5 5.5 0 113 5" />
    <path d="M3 1.8V5h3.2" />
  </svg>
);
export const IcFile = (p: P) => (
  <svg width="14" height="14" viewBox="0 0 16 16" {...base} strokeWidth={1.6} {...p}>
    <path d="M4 1.5h5.5L13 5v9.5H4z" />
    <path d="M9.5 1.5V5H13" />
  </svg>
);
export const IcImage = (p: P) => (
  <svg width="14" height="14" viewBox="0 0 16 16" {...base} strokeWidth={1.6} {...p}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M2.5 11.5l3.5-3.5 3 3 2-2 2.5 2.5" />
  </svg>
);
export const IcClock = (p: P) => (
  <svg width="13" height="13" viewBox="0 0 14 14" {...base} strokeWidth={1.6} {...p}>
    <circle cx="7" cy="7" r="5.6" />
    <path d="M7 4v3.3l2.2 1.4" />
  </svg>
);
/** Engram: a small cylinder. */
export const IcEngram = (p: P) => (
  <svg width="14" height="14" viewBox="0 0 16 16" {...base} strokeWidth={1.6} {...p}>
    <ellipse cx="8" cy="4" rx="5.5" ry="2" />
    <path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
  </svg>
);
export const IcStar = ({ on, ...p }: P & { on?: boolean }) => (
  <svg className="sa-star" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={on ? undefined : { color: "var(--edge)" }} {...p}>
    <path
      d="M6 1l1.5 3.1 3.4.5-2.5 2.4.6 3.4L6 8.8 2.9 10.4l.6-3.4L1 4.6l3.4-.5z"
      fill={on ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={on ? 0 : 1.2}
      strokeLinejoin="round"
    />
  </svg>
);
/** 45 degree link stub from a memory row to the phrase it supports. */
export const IcStub = (p: P) => (
  <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden="true" {...p}>
    <path d="M1 1V4L6 9H17" fill="none" stroke="currentColor" strokeWidth={1.5} />
  </svg>
);

/** Semáforo swatches (shape carries the meaning, tint supports it). */
export const SwKeep = () => (
  <svg className="sm-sw" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
    <rect x="0" y="0" width="18" height="9" rx="2" style={{ fill: "var(--keep-tint)" }} />
    <path d="M1 11H17" style={{ stroke: "var(--keep-ink)" }} strokeWidth="2" />
    <g transform="translate(5,0)" style={{ color: "var(--keep-ink)" }}>
      <path d="M2 4V3a2 2 0 014 0v1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1" y="4" width="6" height="4" rx=".8" fill="currentColor" />
    </g>
  </svg>
);
export const SwRedo = () => (
  <svg className="sm-sw" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
    <rect x="0" y="0" width="18" height="9" rx="2" style={{ fill: "var(--redo-tint)" }} />
    <path d="M1 10.5q2-2 4 0t4 0 4 0 4 0" fill="none" style={{ stroke: "var(--redo-ink)" }} strokeWidth="1.5" />
  </svg>
);
export const SwDrop = () => (
  <svg className="sm-sw" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
    <rect x="0" y="1" width="18" height="10" rx="2" style={{ fill: "var(--drop-tint)" }} />
    <path d="M1 6H17" style={{ stroke: "var(--drop-ink)" }} strokeWidth="2" />
  </svg>
);
export const SwClear = () => (
  <svg className="sm-sw" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

/** Claude listening: a dot travels a short orange track (static under reduced motion via CSS). */
export const LiveTrack = ({ off }: { off?: boolean }) => (
  <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true">
    <path d="M2 5H26" fill="none" stroke={off ? "var(--ink)" : "var(--cl)"} strokeWidth="3" strokeLinecap="round" opacity=".35" strokeDasharray={off ? "1 5" : undefined} />
    {off ? null : <circle cx="5" cy="5" r="3.5" fill="var(--cl)" className="lb-travel" />}
  </svg>
);
