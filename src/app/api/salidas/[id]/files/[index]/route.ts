import { error, route } from "@/lib/api/http";
import { approvedBytes } from "@/lib/repo/salida-files";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

/**
 * GET /api/salidas/:id/files/:index -> the file the salida will upload (t196). Only a path stored on the salida's own
 * destination is ever served, and only while its bytes still hash to what was proposed: Andrés opens exactly the file
 * that goes out. PDFs and raster images open inline; anything else downloads.
 */
export const GET = route<{ id: string; index: string }>(async (_req, r, { id, index }) => {
  const d = r.salidas.get(id).destination;
  const files = "files" in d ? (d.files ?? []) : [];
  const f = files[Number(index)];
  if (!f || !/^\d+$/.test(index)) return error(404, "not_found", `salida ${id} has no file ${index}`);
  // One read: the bytes that were hashed are the bytes served (no window to swap the file between check and send).
  const got = approvedBytes(f);
  if (got.state === "missing") return error(404, "not_found", "the file is no longer on disk");
  if (got.state === "changed") return error(409, "file_changed", "the file changed after it was proposed; ask for a new salida");
  const data = got.data;
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext] ?? "application/octet-stream";
  const inline = /^image\/|^application\/pdf$/.test(mime);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": mime,
      "content-length": String(data.length),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});
