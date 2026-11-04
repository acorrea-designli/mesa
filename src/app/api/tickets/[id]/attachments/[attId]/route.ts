import fs from "node:fs/promises";
import path from "node:path";
import { error, route } from "@/lib/api/http";

const UPLOADS = path.join(process.cwd(), "data", "uploads");

/** GET /api/tickets/:id/attachments/:attId -> the file (inline for images, download otherwise) */
export const GET = route<{ id: string; attId: string }>(async (_req, r, { id, attId }) => {
  const att = r.tickets.detail(id).attachments.find((a) => a.id === attId);
  if (!att) return error(404, "not_found", `attachment ${attId} not found`);
  const file = path.resolve(UPLOADS, att.path);
  if (!file.startsWith(path.resolve(UPLOADS) + path.sep)) return error(400, "invalid_request", "bad attachment path");
  const data = await fs.readFile(file).catch(() => null);
  if (!data) return error(404, "not_found", "attachment file is missing");
  // Only raster images and PDFs render inline; anything that could run script downloads.
  const inline = /^image\/(png|jpeg|gif|webp|avif)$/.test(att.mime) || att.mime === "application/pdf";
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": att.mime,
      "content-length": String(data.length),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
    },
  });
});
