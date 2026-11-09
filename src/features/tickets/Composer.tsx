"use client";
// Ticket composer: Markdown text, files by drag, paste and clip (removable chips
// with size), "@" opens a ticket picker (open tickets and this week's, with their
// direction line) and inserts ink-bordered ref chips, "/" opens actions.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { rise } from "@/lib/motion";
import { IcClip, IcCollapse, IcExpand, IcFile, IcImage, IcX } from "@/features/salidas/icons";
import type { PickTicket } from "./read";
import { DirLine } from "./bits";

export interface RefChip {
  target: string;
  label: string;
}

export interface ComposerState {
  text: string;
  files: File[];
  refs: RefChip[];
}

export function useComposer(initial = "") {
  const [state, setState] = useState<ComposerState>({ text: initial, files: [], refs: [] });
  // A stored draft coming back (drafts.ts): text and @refs only, files are never kept.
  const restore = useCallback((d: { text: string; refs: RefChip[] }) => setState((s) => ({ ...s, text: d.text, refs: d.refs })), []);
  return {
    state,
    restore,
    setText: (text: string) => setState((s) => ({ ...s, text })),
    addFiles: (files: File[]) => setState((s) => ({ ...s, files: [...s.files, ...files.filter((f) => !s.files.some((x) => x.name === f.name && x.size === f.size))] })),
    removeFile: (i: number) => setState((s) => ({ ...s, files: s.files.filter((_, j) => j !== i) })),
    addRef: (r: RefChip) => setState((s) => (s.refs.some((x) => x.target === r.target) ? s : { ...s, refs: [...s.refs, r] })),
    removeRef: (t: string) => setState((s) => ({ ...s, refs: s.refs.filter((x) => x.target !== t) })),
    reset: () => setState({ text: "", files: [], refs: [] }),
  };
}
export type Composer = ReturnType<typeof useComposer>;

export const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export interface SlashAction {
  key: string;
  label: string;
  hint?: string;
  run: () => void;
}

type Menu = { kind: "@" | "/"; q: string; start: number; i: number } | null;

export function ComposerBox({
  c,
  pick,
  actions,
  placeholder,
  label,
  children,
  onSubmit,
  rows = 3,
  autoFocus,
  menuAbove,
  focusMode,
  onToggleFocus,
}: {
  c: Composer;
  pick: PickTicket[];
  actions: SlashAction[];
  placeholder: string;
  label: string;
  children?: ReactNode; // right side of the bar (buttons)
  onSubmit?: () => void;
  rows?: number;
  autoFocus?: boolean;
  menuAbove?: boolean;
  /** The thread's focus mode (list folded into the rail). The expand control renders only when `onToggleFocus` is given. */
  focusMode?: boolean;
  onToggleFocus?: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [drag, setDrag] = useState(false);

  const options = useMemo(() => {
    if (!menu) return [];
    const q = menu.q.toLowerCase();
    if (menu.kind === "@")
      return pick
        .filter((t) => !c.state.refs.some((r) => r.target === t.ref))
        .filter((t) => !q || t.ref.toLowerCase().includes(q) || t.title.toLowerCase().includes(q))
        .slice(0, 6);
    return actions.filter((a) => !q || a.label.toLowerCase().includes(q) || a.key.includes(q)).slice(0, 8);
  }, [menu, pick, actions, c.state.refs]);

  useEffect(() => {
    if (menu && menuRef.current) rise(menuRef.current);
  }, [menu?.kind, menu]);

  const detect = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = /(^|\s)([@/])([\p{L}\p{N}_-]*)$/u.exec(before);
    if (!m) return setMenu(null);
    const kind = m[2] as "@" | "/";
    setMenu({ kind, q: m[3] ?? "", start: caret - (m[3]?.length ?? 0) - 1, i: 0 });
  };

  const choose = (i: number) => {
    if (!menu) return;
    const el = ta.current;
    const caret = el?.selectionStart ?? c.state.text.length;
    const text = c.state.text.slice(0, menu.start) + c.state.text.slice(caret);
    if (menu.kind === "@") {
      const t = options[i] as PickTicket | undefined;
      if (!t) return;
      c.addRef({ target: t.ref, label: t.title });
      c.setText(text);
    } else {
      const a = options[i] as SlashAction | undefined;
      if (!a) return;
      c.setText(text);
      a.run();
    }
    setMenu(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(menu.start, menu.start);
    });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu && options.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setMenu({ ...menu, i: (menu.i + d + options.length) % options.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(menu.i);
        return;
      }
    }
    if (menu && e.key === "Escape") {
      e.preventDefault();
      setMenu(null);
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  const picker = menu && options.length ? (
    <div ref={menuRef} className={menuAbove ? "tk-mention above" : "tk-mention"} role="listbox" aria-label={menu.kind === "@" ? "Referenciar ticket" : "Acciones"}>
      <div className="q">
        {menu.kind}
        <b>{menu.q}</b> · {menu.kind === "@" ? "tickets abiertos y de esta semana" : "acciones"}
      </div>
      {menu.kind === "@"
        ? (options as PickTicket[]).map((t, i) => (
            <div
              key={t.ref}
              className={i === menu.i ? "tk-mi on" : "tk-mi"}
              role="option"
              aria-selected={i === menu.i}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              <span className="id">{t.ref}</span>
              <DirLine direction={t.direction} />
              <span>{t.title}</span>
            </div>
          ))
        : (options as SlashAction[]).map((a, i) => (
            <div
              key={a.key}
              className={i === menu.i ? "tk-mi act on" : "tk-mi act"}
              role="option"
              aria-selected={i === menu.i}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              <span className="id">/{a.key}</span>
              <span>
                {a.label}
                {a.hint ? <small> · {a.hint}</small> : null}
              </span>
            </div>
          ))}
    </div>
  ) : null;

  return (
    <div
      className={["tk-reply", drag && "drag", onToggleFocus && "has-expand", c.state.text !== "" && "typed"].filter(Boolean).join(" ")}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDrag(false);
        c.addFiles([...e.dataTransfer.files]);
      }}
    >
      {onToggleFocus ? (
        // Shown while the composer has focus or text (CSS); the mouse press keeps the textarea focus and caret.
        <button
          className="ico-btn tk-expand"
          type="button"
          aria-pressed={Boolean(focusMode)}
          aria-label={focusMode ? "Contraer" : "Expandir la conversación"}
          title={focusMode ? "Contraer" : "Expandir la conversación"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleFocus}
        >
          {focusMode ? <IcCollapse /> : <IcExpand />}
        </button>
      ) : null}
      {c.state.refs.length || c.state.files.length ? (
        <div className="tk-atts">
          {c.state.refs.map((r) => (
            <span key={r.target} className="tk-att ref">
              <span className="at">@{r.target}</span> <span className="tk-att-t">{r.label}</span>
              <button className="x" type="button" aria-label={`Quitar @${r.target}`} onClick={() => c.removeRef(r.target)}>
                <IcX />
              </button>
            </span>
          ))}
          {c.state.files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="tk-att">
              {f.type.startsWith("image/") ? <IcImage /> : <IcFile />}
              <span className="tk-att-t">{f.name}</span> <small>{fmtSize(f.size)}</small>
              <button className="x" type="button" aria-label={`Quitar ${f.name}`} onClick={() => c.removeFile(i)}>
                <IcX />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {menuAbove ? picker : null}
      <textarea
        ref={ta}
        aria-label={label}
        placeholder={placeholder}
        rows={rows}
        value={c.state.text}
        autoFocus={autoFocus}
        onChange={(e) => {
          c.setText(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKey}
        onClick={(e) => detect(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => {
          setTimeout(() => setMenu(null), 120);
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length) {
            e.preventDefault();
            c.addFiles(files);
          }
        }}
      />
      {menuAbove ? null : picker}
      <div className="tk-bar">
        <button className="ico-btn" type="button" aria-label="Adjuntar archivo" onClick={() => fileIn.current?.click()}>
          <IcClip />
        </button>
        <input
          ref={fileIn}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            c.addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <span className="hint">
          <span className="hint-files">Archivos · </span>
          <b>@</b> tickets · <b>/</b> acciones
        </span>
        {children ? <div className="acts">{children}</div> : null}
      </div>
    </div>
  );
}
