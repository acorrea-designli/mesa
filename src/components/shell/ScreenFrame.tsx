import type { ReactNode } from "react";

/** Temporary frame for screens that lanes A and B have not built yet. */
export function ScreenFrame({ title, meta, children }: { title: string; meta?: string; children?: ReactNode }) {
  return (
    <>
      <header className="screen-head">
        <h1>{title}</h1>
        {meta ? <span>{meta}</span> : null}
      </header>
      <section className="screen-body">{children}</section>
    </>
  );
}
