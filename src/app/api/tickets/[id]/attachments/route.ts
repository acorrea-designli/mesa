import fs from "node:fs/promises";
import path from "node:path";
import { error, json, route } from "@/lib/api/http";
import { newId } from "@/lib/db/util";

const MAX_BYTES = 25 * 1024 * 1024;
const UPLOADS = path.join(process.cwd(), "data", "uploads");

/** POST /api/tickets/:id/attachments multipart (file, messageId?) -> Attachment (201). Stored under data/uploads */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const ticket = r.tickets.get(id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error(400, "invalid_request", "missing file");
  if (file.size > MAX_BYTES) return error(413, "too_large", "attachments are limited to 25 MB");
  const safe = path.basename(file.name).replace(/[^\w.\- ]+/g, "_") || "file";
  const rel = path.join(ticket.id, newId("f") + "-" + safe);
  await fs.mkdir(path.join(UPLOADS, ticket.id), { recursive: true });
  await fs.writeFile(path.join(UPLOADS, rel), Buffer.from(await file.arrayBuffer()));
  const messageId = form.get("messageId");
  const att = r.tickets.addAttachment(ticket.id, {
    messageId: typeof messageId === "string" && messageId ? messageId : null,
    filename: safe,
    mime: file.type || "application/octet-stream",
    size: file.size,
    path: rel.split(path.sep).join("/"),
  });
  return json(att, { status: 201 });
});
