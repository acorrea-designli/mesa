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
  /** CSS selector of marks inside the same card (.us-panel) the bubble must never cover (the big figure, the number line). */
  avoid?: string;
  /** Where the bubble opens first: "up" (default) or "down", for a trigger that sits under the numbers it would cover (the key and "reinicia"). "down" never flips up. */
  side?: "up" | "down";
}

const GAP = 8;
const PAD = 8; // the vertical padding of .us-tipbox: the visible bubble is the box minus it

/**
 * Moves an open bubble off the marks it must not cover (`avoid`, looked up inside the nearest card). Above the trigger it
 * slides to the side of the mark with more room (the left of the big figure, usually), narrowing itself when even that
 * is short; below the trigger (no room above) it drops under the mark. The page's own numbers stay readable while the
 * bubble is open. `min` and `max` are the horizontal bounds the bubble must stay inside.
 */
function dodge(box: HTMLElement, avoid: string, min: number, max: number) {
  const scope = box.closest(".us-panel") ?? document;
  const marks = Array.from(scope.querySelectorAll(avoid)).map((el) => el.getBoundingClientRect()).filter((m) => m.width > 0);
  const px = (name: string) => parseFloat(box.style.getPropertyValue(name)) || 0;
  const hits = (m: DOMRect, r: DOMRect) => r.left < m.right + GAP && r.right > m.left - GAP && r.top + PAD < m.bottom && r.bottom - PAD > m.top;
  const slide = (by: number) => box.style.setProperty("--dx", `${Math.round(px("--dx") + by)}px`);
  for (const m of marks) {
    let r = box.getBoundingClientRect();
    if (!hits(m, r)) continue;
    if (box.dataset.side === "down") {
      box.style.setProperty("--dy", `${Math.round(px("--dy") + m.bottom + GAP - (r.top + PAD))}px`);
      continue;
    }
    const leftRoom = m.left - GAP - min;
    const rightRoom = max - (m.right + GAP);
    const toLeft = Math.min(r.width, leftRoom) >= Math.min(r.width, rightRoom);
    const room = Math.floor(toLeft ? leftRoom : rightRoom);
    if (room < r.width) {
      box.style.setProperty("--maxw", `${Math.max(room, 0)}px`);
      r = box.getBoundingClientRect();
    }
    slide(toLeft ? m.left - GAP - r.right : m.right + GAP - r.left);
  }
}

export function Tip({ tip, children, className, btnClass, tabbable = true, style, pinned = false, avoid, side = "up" }: TipProps) {
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
    box.style.setProperty("--dy", "0px");
    box.style.removeProperty("--maxw");
    box.dataset.side = side;
    let r = box.getBoundingClientRect();
    if (side === "up" && r.top < 8) {
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
    if (avoid) dodge(box, avoid, min, max);
    // Opening below the page's own numbers: on a touch screen, bring a bubble that ends under the fold or the tab bar into view.
    if (side === "down" && !window.matchMedia("(hover: hover)").matches) {
      const over = box.getBoundingClientRect().bottom - PAD - (window.innerHeight - 72);
      if (over > 0) window.scrollBy(0, over);
    }
  }, [open, avoid, side]);

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
      <span ref={boxRef} className={`us-tipbox${open ? " open" : ""}`} data-side={side}>
        <span id={tipId} role="tooltip" className="us-tipbubble">
          {tip}
        </span>
      </span>
    </span>
  );
}
