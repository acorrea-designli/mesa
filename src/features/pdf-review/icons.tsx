// Tool icons of the PDF review view: 16px stroke icons, currentColor only (same idiom as features/salidas/icons.tsx).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const IcHighlight = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9.5 2.5l4 4-5.5 5.5H5V9z" />
    <path d="M2.5 14h11" />
  </svg>
);
export const IcPin = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 3.5h10v7H8.5L6 13v-2.5H3z" />
  </svg>
);
export const IcRect = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="4" width="11" height="8" rx="1" />
  </svg>
);
export const IcEllipse = (p: P) => (
  <svg {...base} {...p}>
    <ellipse cx="8" cy="8" rx="5.5" ry="4" />
  </svg>
);
export const IcArrow = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 13L13 3M7 3h6v6" />
  </svg>
);
export const IcSend = (p: P) => (
  <svg {...base} {...p}>
    <path d="M2.5 8l11-5-4.5 11-1.8-4.7z" />
  </svg>
);
