import { error, json, route } from "@/lib/api/http";
import { isLocalRequest } from "@/lib/access";
import { revealFile } from "@/lib/repo/reveal-file";
import { revealablePath } from "@/lib/repo/salida-files";

export const dynamic = "force-dynamic";

/**
 * POST /api/salidas/:id/files/:index/folder -> { opened: <file name> } (t87, "Abrir carpeta"). Opens the folder of the
 * file in Andrés's file manager (Windows Explorer with the file selected). Andrés only, and only from the PC Mesa runs on:
 * the proxy refuses a forwarded request (src/lib/access.ts) and this checks again, because it launches a program on his
 * machine. The path is never taken from the request: it is the one stored on the salida's own destination.files, and it
 * must still be inside the folders Mesa may attach from (temp, data/uploads, MESA_FILE_ROOTS). Hook G10 keeps sessions off it.
 */
export const POST = route<{ id: string; index: string }>(async (req, r, { id, index }) => {
  if (!isLocalRequest(req.headers)) return error(403, "local_only", "only from the PC Mesa runs on");
  const d = r.salidas.get(id).destination;
  const files = "files" in d ? (d.files ?? []) : [];
  const f = /^\d+$/.test(index) ? files[Number(index)] : undefined;
  if (!f) return error(404, "not_found", `salida ${id} has no file ${index}`);
  revealFile(revealablePath(f));
  return json({ opened: f.name });
});
