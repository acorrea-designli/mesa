"use client";
// A small tooltip for the marks on /uso. The trigger is a real button (focusable, 24 px or more to hit, 44 px on touch)
// and the bubble is a role="tooltip" it points to with aria-describedby. It opens on mouse hover, on tap (touch and pen),
// and on keyboard focus; it closes on pointer leave, a tap outside, blur and Escape. One tip is open at a time (a
// module-level store), and the bubble flips below the trigger or slides sideways so it always stays inside the viewport.
// The bubble sits outside the chart plot, so it never takes the plot's pointer events away from the crosshair.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import "./usage.css";

let current: string | null = null;
const subs = new Set<() => void>();
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
const setCurrent = (id: string | null) => {
  if (current === id) return;
  current = id;
  subs.forEach((f) => f());
};

export interface TipProps {
  /** The explanation: one or two short sentences. */
  tip: ReactNode;
  /** The visible mark or label; the button wraps it. */
  children: ReactNode;
  /** Classes of the wrapper (layout of the trigger). */
  className?: string;
  /** Classes of the button. */
  btnClass?: string;
  /** false when another trigger on the card carries the same tip: this one stays hover and tap only (out of the Tab order). */
  tabbable?: boolean;
  /** Pointer-only offset of the wrapper, for a trigger drawn over a mark (the pace tick). */
  style?: CSSProperties;
  /** Always open (the /kit gallery). */
  pinned?: boolean;
}

export function Tip({ tip, children, className, btnClass, tabbable = true, style, pinned = false }: TipProps) {
  const id = useId();
  const tipId = `${id}tip`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<HTMLSpanElement>(null);
  const how = useRef<string>("key");
  const cur = useSyncExternalStore(subscribe, () => current, () => null);
  const open = pinned || cur === id;

  const close = useCallback(() => {
    if (current === id) setCurrent(null);
  }, [id]);

  useEffect(() => close, [close]);

  // Close on a tap or click outside, and on Escape (the focus stays on the trigger).
  useEffect(() => {
    if (!open || pinned) return;
    const down = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [open, pinned, close]);

  // Keep the bubble inside the viewport: flip below when there is no room above, slide sideways at the edges.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!open || !box) return;
    box.style.setProperty("--dx", "0px");
    box.dataset.side = "up";
    let r = box.getBoundingClientRect();
    if (r.top < 8) {
      box.dataset.side = "down";
      r = box.getBoundingClientRect();
    }
    // Bounds: the viewport, narrowed to the /uso column (.us clips its x overflow, so the rail side must stay clear).
    const vw = document.documentElement.clientWidth;
    const col = box.closest(".us")?.getBoundingClientRect();
    const min = Math.max(0, col?.left ?? 0) + 8;
    const max = Math.min(vw, col?.right ?? vw) - 8;
    const dx = r.right > max ? max - r.right : 0;
    const shift = r.left + dx < min ? min - r.left : dx;
    box.style.setProperty("--dx", `${Math.round(shift)}px`);
  }, [open]);

  return (
    <span
      ref={rootRef}
      className={`us-tp${className ? ` ${className}` : ""}`}
      style={style}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setCurrent(id);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") close();
      }}
    >
      <button
        type="button"
        className={`us-tipbtn${btnClass ? ` ${btnClass}` : ""}`}
        aria-describedby={tipId}
        tabIndex={tabbable ? undefined : -1}
        onPointerDown={(e) => {
          how.current = e.pointerType;
        }}
        onClick={() => {
          // A mouse click keeps the hover tip open; a tap or Enter/Space toggles it.
          if (how.current === "mouse") setCurrent(id);
          else setCurrent(current === id ? null : id);
          how.current = "key";
        }}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) setCurrent(id);
        }}
        onBlur={close}
      >
        {children}
      </button>
      <span ref={boxRef} className={`us-tipbox${open ? " open" : ""}`} data-side="up">
        <span id={tipId} role="tooltip" className="us-tipbubble">
          {tip}
        </span>
      </span>
    </span>
  );
}
