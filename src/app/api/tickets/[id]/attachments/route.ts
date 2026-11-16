import fs from "node:fs/promises";
import path from "node:path";
import { error, json, route } from "@/lib/api/http";
import { newId } from "@/lib/db/util";

const MAX_BYTES = 25 * 1024 * 1024;
const UPLOADS = path.join(process.cwd(), "data", "uploads");

/**
 * POST /api/tickets/:id/attachments multipart (file, messageId?, versionOf?) -> Attachment (201). Stored under data/uploads.
 * `versionOf` (t190) is an attachment id of this ticket: the file becomes the next version of that document.
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const ticket = r.tickets.get(id);
  const form = await req.formData();
  const versionOf = form.get("versionOf");
  const target = typeof versionOf === "string" && versionOf ? versionOf : null;
  const file = form.get("file");
  if (!(file instanceof File)) return error(400, "invalid_request", "missing file");
  const mime = file.type || "application/octet-stream";
  if (target) {
    // Checked before the file is written, so a refused version leaves nothing on disk.
    const all = r.tickets.detail(ticket.id).attachments;
    const hit = all.find((x) => x.id === target);
    if (!hit) return error(404, "not_found", `attachment ${target} not found`);
    const root = all.find((x) => x.id === (hit.versionOf ?? hit.id));
    if (root && root.mime !== mime) return error(400, "invalid_request", `a version of ${root.id} must be ${root.mime}, not ${mime}`);
  }
  if (file.size > MAX_BYTES) return error(413, "too_large", "attachments are limited to 25 MB");
  const safe = path.basename(file.name).replace(/[^\w.\- ]+/g, "_") || "file";
  const rel = path.join(ticket.id, newId("f") + "-" + safe);
  await fs.mkdir(path.join(UPLOADS, ticket.id), { recursive: true });
  await fs.writeFile(path.join(UPLOADS, rel), Buffer.from(await file.arrayBuffer()));
  const messageId = form.get("messageId");
  const att = r.tickets.addAttachment(ticket.id, {
    messageId: typeof messageId === "string" && messageId ? messageId : null,
    filename: safe,
    mime,
    size: file.size,
    path: rel.split(path.sep).join("/"),
    versionOf: target,
  });
  return json(att, { status: 201 });
});
