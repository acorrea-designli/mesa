// Line language primitives: 6px round-capped strokes, 45/90 degree bends,
// open interchange rings, dotted = out of service. Colour = source only.
import type { CSSProperties } from "react";
import type { Source } from "@/lib/domain/types";

const LINE_VAR: Record<Source, string> = {
  github: "var(--gh)",
  slack: "var(--sl)",
  claude: "var(--cl)",
  basecamp: "var(--bc)",
};
export const lineColor = (s: Source | "ink") => (s === "ink" ? "var(--ink)" : LINE_VAR[s]);

/** Source dot used in rows and tabs. */
export function SourceDot({ source, size = 10 }: { source: Source; size?: number }) {
  return (
    <i
      className="dot"
      aria-hidden="true"
      style={{ width: size, height: size, background: LINE_VAR[source] } as CSSProperties}
    />
  );
}

/** Short horizontal stub of a source line (board cards, plan rows, phone tabs). */
export function LineStub({
  source,
  width = 22,
  dim = false,
  dotted = false,
  title,
}: {
  source: Source | "ink";
  width?: number;
  dim?: boolean;
  dotted?: boolean;
  title?: string;
}) {
  return (
    <svg width={width} height={6} viewBox={`0 0 ${width} 6`} aria-hidden={title ? undefined : true} role={title ? "img" : undefined} style={{ flex: "none", opacity: dim ? 0.35 : 1 }}>
      {title ? <title>{title}</title> : null}
      <path
        d={`M3 3H${width - 3}`}
        stroke={lineColor(source)}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={dotted ? "1 8" : undefined}
        fill="none"
      />
    </svg>
  );
}

/** Open interchange ring. */
export function Ring({ source = "ink", size = 13, on = false }: { source?: Source | "ink"; size?: number; on?: boolean }) {
  const r = size / 2 - 1.75;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flex: "none" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill={on ? "var(--raise)" : "var(--gnd)"} stroke={lineColor(source)} strokeWidth={2.5} />
    </svg>
  );
}

/** Line stub that ends in an interchange ring: the card stub for an item linked to two sources. */
export function Interchange({ from, to }: { from: Source; to: Source }) {
  return (
    <svg width={44} height={18} viewBox="0 0 44 18" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M3 5H16" stroke={LINE_VAR[from]} strokeWidth={5} strokeLinecap="round" fill="none" />
      <path d="M28 13H41" stroke={LINE_VAR[to]} strokeWidth={5} strokeLinecap="round" fill="none" />
      <path d="M18 5L26 13" stroke="var(--ink)" strokeWidth={2} fill="none" />
      <circle cx={18} cy={5} r={3.6} fill="var(--raise)" stroke="var(--ink)" strokeWidth={2.2} />
      <circle cx={26} cy={13} r={3.6} fill="var(--raise)" stroke="var(--ink)" strokeWidth={2.2} />
    </svg>
  );
}

/**
 * Ticket direction marker: the asker's line runs into the receiver's ring.
 * claude_asks = orange line -> ink ring ("Claude pregunta");
 * andres_asks = ink line -> orange ring ("Pediste").
 */
export function DirectionMarker({ direction, label }: { direction: "claude_asks" | "andres_asks"; label?: string }) {
  const line = direction === "claude_asks" ? "var(--cl)" : "var(--ink)";
  const ring = direction === "claude_asks" ? "var(--ink)" : "var(--cl)";
  const text = label ?? (direction === "claude_asks" ? "Claude pregunta" : "Pediste");
  return (
    <span className="tk-dir" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
      <svg width={30} height={14} viewBox="0 0 30 14" aria-hidden="true" style={{ flex: "none" }}>
        <path d="M3 7H19" stroke={line} strokeWidth={5} strokeLinecap="round" fill="none" />
        <circle cx={23} cy={7} r={4.5} fill="var(--raise)" stroke={ring} strokeWidth={2.5} />
      </svg>
      {text}
    </span>
  );
}

/** Service interrupted: a dotted line cut by a 45 degree slash. Never red. */
export function BrokenLine({ source, width = 26, title }: { source: Source; width?: number; title?: string }) {
  return (
    <svg width={width} height={14} viewBox={`0 0 ${width} 14`} role="img" aria-label={title ?? "Sin conexión"} style={{ flex: "none" }}>
      <path d={`M3 7H${width - 3}`} stroke={LINE_VAR[source]} strokeWidth={5} strokeLinecap="round" strokeDasharray="1 7" fill="none" />
      <path d={`M${width / 2 - 4} 12L${width / 2 + 4} 2`} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

/** Brand mark: a miniature of the line band (GitHub bends 45 degrees into Slack at a ring). */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" strokeWidth={3.5} strokeLinecap="round" aria-hidden="true">
      <path d="M3 21H12L19 14H25" stroke="var(--gh)" />
      <path d="M3 14H25" stroke="var(--sl)" />
      <circle cx={19} cy={14} r={3.2} fill="var(--gnd)" stroke="var(--ink)" strokeWidth={2} />
    </svg>
  );
}
