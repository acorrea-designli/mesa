import { body, json, route } from "@/lib/api/http";
import { salidaUpload } from "@/lib/api/schemas";
import { withDestinationUrl } from "@/features/salidas/read";

/**
 * POST /api/salidas/:id/uploads { file, sgid } -> SalidaDetail (t196). The lead records the attachable_sgid that
 * Basecamp's create_attachment returned for file `file` (0-based) of a released salida; hook G5 then lets the
 * create_message / create_comment through only when its HTML embeds exactly the recorded sgids next to the approved text.
 */
export const POST = route<{ id: string }>(async (req, r, { id }) => {
  const input = await body(req, salidaUpload);
  return json(withDestinationUrl(r.salidas.recordUpload(id, input.file, input.sgid)), { status: 201 });
});
