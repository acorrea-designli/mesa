import type { SandboxCopy } from "@/lib/sandbox/copy";
import "./sandbox.css";

const when = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * MESA_ENV=sandbox: a dashed ink frame around the whole viewport and a tab at the top that names it.
 * Dashed reads as "not real" (DESIGN.md: lines carry source only, so no source colours). It takes no
 * layout space and no pointer events, so every screen works exactly as on the live board. On the phone the
 * tab sits on the bottom tab bar instead, where it covers no header.
 */
export function SandboxBand({ copy }: { copy: SandboxCopy | null }) {
  const origin = copy ? (copy.from === "live" ? `copia de live · ${when(copy.copiedAt)}` : `datos de muestra · ${when(copy.copiedAt)}`) : null;
  return (
    <>
      <div className="sbx-frame" aria-hidden="true" />
      <div className="sbx-tab" role="note" aria-label="Sandbox: nada de lo que hagas aquí sale de Mesa">
        <b>SANDBOX</b>
        <span className="sbx-long">{origin ? `· ${origin} ` : ""}· nada sale de aquí</span>
        <span className="sbx-short">· nada sale de aquí</span>
      </div>
    </>
  );
}
