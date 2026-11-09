// "Copiar" on a Slack salida: put exactly the text the card shows on the clipboard. Pure: the browser pieces
// (Clipboard API, selecting the text block) are passed in so the fallback chain is unit tested.

export type CopyResult = "copied" | "selected" | "failed";

export interface CopyDeps {
  /** navigator.clipboard; absent on an insecure origin or an old browser. */
  clipboard?: { writeText(text: string): Promise<void> } | null;
  /** Fallback: select the visible text so Andrés can copy it by hand. Returns whether it could. */
  select?: () => boolean;
}

/** The Clipboard API first; when it is missing or refuses, select the displayed text; otherwise fail. Never alters the text. */
export async function copyExactText(text: string, deps: CopyDeps): Promise<CopyResult> {
  if (!text) return "failed";
  if (deps.clipboard) {
    try {
      await deps.clipboard.writeText(text);
      return "copied";
    } catch {
      /* permission denied or the page is not focused: fall through to the selection */
    }
  }
  try {
    return deps.select?.() ? "selected" : "failed";
  } catch {
    return "failed";
  }
}

/** The short toast for each outcome. */
export const COPY_TOAST: Record<CopyResult, string> = {
  copied: "Texto copiado",
  selected: "Texto seleccionado · cópialo con Ctrl+C",
  failed: "No se pudo copiar el texto",
};
