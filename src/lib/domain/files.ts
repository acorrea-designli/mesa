// Files attached to a Slack or Basecamp message, as the sweeper records them in an item's meta.files
// ([{id | sgid, name, mime, url?}], .claude/skills/mesa-sweep/SKILL.md). Pure: the chip on Hoy, Tablero and the ticket header.

export interface ItemFile {
  /** Slack file id, or the Basecamp sgid / attachable id. */
  id: string;
  name: string;
  mime: string;
  url: string | null;
}

export interface FilesChip {
  kind: "imagen" | "adjunto";
  /** "imagen", "adjunto", or either with the count when there is more than one ("imagen · 2"). */
  label: string;
  count: number;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Reads meta.files tolerantly: anything that is not an object is skipped, ids fall back to sgid. */
export function metaFiles(meta: Record<string, unknown> | null | undefined): ItemFile[] {
  const raw = meta?.files;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f): ItemFile[] => {
    if (!f || typeof f !== "object") return [];
    const o = f as Record<string, unknown>;
    return [{ id: str(o.id) || str(o.sgid), name: str(o.name), mime: str(o.mime), url: str(o.url) || null }];
  });
}

/** "imagen" when every file is an image, "adjunto" otherwise; null when there are no files. */
export function filesChip(files: readonly Pick<ItemFile, "mime">[]): FilesChip | null {
  if (!files.length) return null;
  const kind = files.every((f) => f.mime.toLowerCase().startsWith("image/")) ? "imagen" : "adjunto";
  return { kind, label: files.length > 1 ? `${kind} · ${files.length}` : kind, count: files.length };
}

/** The chip for one item's meta, or for several items' metas together (a card's linked items). */
export function chipOfMeta(...metas: (Record<string, unknown> | null | undefined)[]): FilesChip | null {
  return filesChip(metas.flatMap(metaFiles));
}
