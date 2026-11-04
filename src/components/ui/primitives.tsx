// Presentational primitives shared by every screen. Server-safe (no hooks).
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import type { Source } from "@/lib/domain/types";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const srcClass = (s?: Source | null) => (s ? `src-${s}` : undefined);

// ---------- Btn ----------
export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  size?: "md" | "sm" | "phone";
  kbd?: string;
}

export function Btn({ variant = "secondary", size = "md", kbd, className, children, type = "button", ...rest }: BtnProps) {
  return (
    <button
      type={type}
      className={cx("btn", variant === "primary" && "p", size === "sm" && "sm", size === "phone" && "phone", className)}
      {...rest}
    >
      {children}
      {kbd ? <span className="kbd" aria-hidden="true">{kbd}</span> : null}
    </button>
  );
}

// ---------- Chip / LinkChip ----------
export function Chip({
  source,
  variant,
  children,
  className,
  href,
}: {
  source?: Source;
  /** plain: edge on porcelain. ref: ink-bordered @ ticket reference. */
  variant?: "plain" | "ref";
  children: ReactNode;
  className?: string;
  href?: string;
}) {
  const cls = cx("chip", srcClass(source), variant, className);
  return href ? (
    <a className={cls} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <span className={cls}>{children}</span>
  );
}

export function LinkChip({ source, children, href }: { source?: Source; children: ReactNode; href?: string }) {
  const cls = cx("lk", srcClass(source));
  return href ? (
    <a className={cls} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <span className={cls}>{children}</span>
  );
}

// ---------- Status tag ----------
/** you = solid ink ("Te espera" / "Por enviar" only). ok = clean. cl = waits on Claude. off = offline. */
export type StatusTone = "you" | "ok" | "cl" | "off" | "plain";

export function StatusTag({ tone = "plain", children, icon }: { tone?: StatusTone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={cx("st", tone !== "plain" && tone)}>
      {icon}
      {children}
    </span>
  );
}

// ---------- Kind line ("Salida · Slack") ----------
export function Kind({ source, children }: { source: Source; children: ReactNode }) {
  return (
    <div className={cx("kind", srcClass(source))}>
      <i style={{ background: "var(--c)" }} aria-hidden="true" />
      {children}
    </div>
  );
}

// ---------- Label ----------
export function Label({ children, as: Tag = "div", style }: { children: ReactNode; as?: "div" | "h3" | "span"; style?: CSSProperties }) {
  return (
    <Tag className="k" style={style}>
      {children}
    </Tag>
  );
}

// ---------- Context quote / exact text ----------
export function ContextQuote({ children }: { children: ReactNode }) {
  return <blockquote className="ctx">{children}</blockquote>;
}

/** The outgoing message exactly as it will be sent; the destination line enters from the top. */
export function ExactText({ source, children, ...rest }: { source: Source; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("msg", srcClass(source))} {...rest}>
      {children}
    </div>
  );
}

// ---------- Alert ----------
export function Alert({ children, actions, icon }: { children: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="alert" role="status">
      {icon}
      <p>{children}</p>
      {actions ? <div style={{ display: "flex", gap: 8 }}>{actions}</div> : null}
    </div>
  );
}

export { cx };
