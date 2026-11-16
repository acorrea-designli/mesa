// Files a Basecamp salida carries (t196): local paths on the destination, each with the size and SHA-256 Mesa measured
// when the salida was proposed. Pure: limits, labels and the check that the file on disk is still the one approved.

export interface SalidaFile {
  /** Absolute local path (the writer's scratch folder, data/uploads...). */
  path: string;
  /** Base name, what Basecamp shows and what the card lists. */
  name: string;
  size: number;
  /** Lowercase hex SHA-256 of the bytes at propose time: hook G5 passes the upload only if the file still hashes to this. */
  sha256: string;
}

export const MAX_SALIDA_FILES = 10;
/** Per file. The Basecamp MCP uploads through the lead's session, so keep it well under what a tool call can carry. */
export const MAX_SALIDA_FILE_BYTES = 25 * 1024 * 1024;

/** "412 KB", "3,4 MB": the size on the card. */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export type FileState = "ok" | "changed" | "missing";

/** Why a file cannot go out, in the Spanish the card shows; null when it is exactly the approved one. */
export const fileStateNote = (s: FileState): string | null =>
  s === "changed" ? "El archivo cambió después de proponerlo" : s === "missing" ? "El archivo ya no está en el disco" : null;

export const fileOpenHref = (salidaId: string, index: number) => `/api/salidas/${encodeURIComponent(salidaId)}/files/${index}`;
