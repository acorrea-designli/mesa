"use client";
// One small context menu per screen for row and card actions ("Ignorar proyecto «X»").
// Opens from the overflow button (anchored under it) or from a right click / long press /
// the context-menu key (at the pointer, or under the focused element). Reuses the split
// button's .ap-menu look; fixed positioned so a scrolling list or a clipped cell never cuts it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { rise } from "@/lib/motion";

export interface MenuAction {
  label: string;
  detail?: string;
  onSelect: () => void;
}

interface OpenMenu {
  x: number;
  y: number;
  /** Right-align the menu with the anchor (an overflow button at a card's right edge). */
  alignRight: boolean;
  /** Anchor height: flipping above an anchor clears it. */
  anchorH: number;
  actions: MenuAction[];
  label: string;
  returnFocus: HTMLElement | null;
}

const W = 260;
const GAP = 6;

export function useActionMenu() {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const current = useRef<OpenMenu | null>(null);
  useEffect(() => {
    current.current = menu;
  }, [menu]);

  const close = useCallback((focus = true) => {
    const back = current.current?.returnFocus;
    setMenu(null);
    if (focus) back?.focus();
  }, []);

  /** Open under an element (overflow button): its left edge ("start") or right edge ("end"). */
  const openFrom = useCallback((el: HTMLElement, label: string, actions: MenuAction[], align: "start" | "end" = "start") => {
    const r = el.getBoundingClientRect();
    setMenu({ x: align === "end" ? r.right : r.left, y: r.bottom + GAP, alignRight: align === "end", anchorH: r.height, actions, label, returnFocus: el });
  }, []);

  /** onContextMenu handler: at the pointer, or under the element for the keyboard (x = y = 0). */
  const onContext = useCallback(
    (label: string, actions: MenuAction[]) => (e: ReactMouseEvent<HTMLElement>) => {
      if (!actions.length) return;
      e.preventDefault();
      const el = e.currentTarget;
      if (e.clientX === 0 && e.clientY === 0) {
        const r = el.getBoundingClientRect();
        setMenu({ x: r.left + 16, y: r.bottom + GAP, alignRight: false, anchorH: r.height, actions, label, returnFocus: el });
      } else setMenu({ x: e.clientX, y: e.clientY, alignRight: false, anchorH: 0, actions, label, returnFocus: el });
    },
    [],
  );

  // Place it (no state: it is measured first), keep it on screen (phones are 390px wide),
  // flip it above when there is no room below, then rise and focus the first action.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(W, vw - 16);
    let left = menu.alignRight ? menu.x - w : menu.x;
    left = Math.max(8, Math.min(left, vw - w - 8));
    let top = menu.y;
    if (top + h > vh - 8) top = Math.max(8, menu.y - h - (menu.anchorH ? 2 * GAP + menu.anchorH : GAP));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${w}px`;
    el.style.visibility = "visible";
    rise(el);
    el.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) close(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
        if (next) {
          e.preventDefault();
          next.focus();
        }
      }
      if (e.key === "Tab") close(false);
    };
    const away = () => close(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("touchstart", down);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", away);
    window.addEventListener("scroll", away, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("touchstart", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", away, true);
    };
  }, [menu, close]);

  const node: ReactNode = menu ? (
    <div
      ref={ref}
      className="ap-menu ig-menu"
      role="menu"
      aria-label={menu.label}
      style={{ left: 0, top: 0, visibility: "hidden" }}
    >
      {menu.actions.map((a) => (
        <button
          key={a.label}
          type="button"
          role="menuitem"
          onClick={() => {
            close();
            a.onSelect();
          }}
        >
          <b>{a.label}</b>
          {a.detail ? <small>{a.detail}</small> : null}
        </button>
      ))}
    </div>
  ) : null;

  return { openFrom, onContext, close, node, open: Boolean(menu) };
}

/** The "⋯" overflow trigger. */
export function MoreButton({ className, label, onOpen }: { className?: string; label: string; onOpen: (el: HTMLElement) => void }) {
  return (
    <button type="button" className={className ? `ig-more ${className}` : "ig-more"} aria-label={label} aria-haspopup="menu" onClick={(e) => onOpen(e.currentTarget)}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="3" cy="7" r="1.4" fill="currentColor" />
        <circle cx="7" cy="7" r="1.4" fill="currentColor" />
        <circle cx="11" cy="7" r="1.4" fill="currentColor" />
      </svg>
    </button>
  );
}
