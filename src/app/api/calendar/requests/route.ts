import { z } from "zod";
import { body, json, route } from "@/lib/api/http";
import { MEETING_REQUEST_MARK } from "@/lib/domain/calendar";

export const dynamic = "force-dynamic";

const requestInput = z.object({ text: z.string().trim().min(3).max(1000) });

/**
 * POST /api/calendar/requests { text } -> TicketDetail (201): "Pedir reunión" on Calendario. It opens a normal
 * andres_asks ticket owned by the lead (card on the Claude lane, ticket.created wake) whose first line is
 * "Pedido de reunión (Calendario)" and whose body is his own words. Claude then finds a free slot and the invitees'
 * addresses (`mesa calendar free|people`) and proposes the exact event as a salida with source `calendar`; nothing is
 * created in Google until he approves it.
 */
export const POST = route(async (req, r) => {
  const { text } = await body(req, requestInput);
  const first = text.split("\n")[0]!.trim();
  const d = r.dispatch.createRequest({
    direction: "andres_asks",
    title: `Reunión: ${first.length > 70 ? `${first.slice(0, 69)}…` : first}`,
    body: `${MEETING_REQUEST_MARK}\n\n${text}`,
  });
  return json(d, { status: 201 });
});
