"use client";
// Interactive shared components: split approve button, tabs, sheet, toasts, theme toggle.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { confirmPick, rise, riseSheet } from "@/lib/motion";
import type { Source } from "@/lib/domain/types";
import { SourceDot } from "../line/Line";
import { cx } from "./primitives";

// ---------- Split approve: "Aprobar y enviar vN | ▾" ----------
export interface SplitApproveProps {
  version: number;
  onSend: () => void; // sends with the 20 s undo window
  onSchedule: () => void; // opens the scheduler ("Programar…")
  disabled?: boolean;
  /** Phone dock: full width, 58px. */
  phone?: boolean;
  /** Open the menu upwards (phone dock). */
  up?: boolean;
  label?: string;
  kbd?: string;
}

export function SplitApprove({ version, onSend, onSchedule, disabled, phone, up, label = "Aprobar y enviar", kbd }: SplitApproveProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    if (menuRef.current) rise(menuRef.current);
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={cx("ap3", phone && "phone", up && "up")}>
      <button type="button" className="btn p ap3-main" disabled={disabled} onClick={onSend}>
        {label}
        <span className="ap-v">v{version}</span>
        {kbd ? <span className="kbd" aria-hidden="true">{kbd}</span> : null}
      </button>
      <button
        type="button"
        className="btn p ap3-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Más formas de enviar"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <span ref={menuRef} className="ap-menu" role="menu" id={menuId}>
          <button type="button" role="menuitemradio" aria-checked="true" onClick={() => (setOpen(false), onSend())}>
            <b>Enviar en 20 s</b>
            <small>Con Deshacer, como siempre</small>
          </button>
          <button type="button" role="menuitemradio" aria-checked="false" onClick={() => (setOpen(false), onSchedule())}>
            <b>Programar…</b>
            <small>Elige día y hora de salida</small>
          </button>
        </span>
      ) : null}
    </span>
  );
}

// ---------- Tabs ----------
export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
  source?: Source;
}

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  trailing,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          className="tab"
          aria-selected={t.key === value}
          onClick={(e) => {
            confirmPick(e.currentTarget);
            onChange(t.key);
          }}
        >
          {t.source ? <SourceDot source={t.source} size={8} /> : null}
          {t.label}
          {t.count !== undefined ? <span>{t.count}</span> : null}
        </button>
      ))}
      {trailing}
    </div>
  );
}

// ---------- Sheet (phone bottom sheet; centred dialog on desktop) ----------
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    if (sheetRef.current) riseSheet(sheetRef.current, scrimRef.current);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    sheetRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div ref={scrimRef} className="scrim" onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <span className="grab" aria-hidden="true" />
        <h2>{title}</h2>
        {children}
      </div>
    </>
  );
}

// ---------- Toasts ----------
export interface ToastInput {
  text: string;
  action?: { label: string; onClick: () => void };
  /** ms; default 5000. */
  duration?: number;
}
interface ToastItem extends ToastInput {
  id: number;
}

const ToastCtx = createContext<(t: ToastInput) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

function ToastView({ t, onDone }: { t: ToastItem; onDone: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) rise(ref.current);
    const id = window.setTimeout(() => onDone(t.id), t.duration ?? 5000);
    return () => window.clearTimeout(id);
  }, [t, onDone]);
  return (
    <div ref={ref} className="toast" role="status">
      <span>{t.text}</span>
      {t.action ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            t.action?.onClick();
            onDone(t.id);
          }}
        >
          {t.action.label}
        </button>
      ) : null}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: ToastInput) => setItems((xs) => [...xs, { ...t, id: ++seq.current }]), []);
  const done = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <ToastView key={t.id} t={t} onDone={done} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Theme toggle ----------
export const THEME_KEY = "mesa-theme";

/** Inline script for <head>: applies the saved theme before first paint. */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    // Sync with the theme the boot script applied before hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* private mode: theme still applies for this page */
    }
  };
  return (
    <button type="button" className={cx("nav", className)} onClick={toggle} aria-pressed={dark}>
      {dark ? "Tema: Grafito" : "Tema: Tokio"}
    </button>
  );
}
