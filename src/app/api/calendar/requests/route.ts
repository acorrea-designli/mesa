import { z } from "zod";
import { body, json, route } from "@/lib/api/http";
import { MEETING_REQUEST_MARK, REPEAT_CHOICES, REPEAT_LABEL } from "@/lib/domain/calendar";

export const dynamic = "force-dynamic";

const requestInput = z.object({ text: z.string().trim().min(3).max(1000), repeat: z.enum(REPEAT_CHOICES).optional() });

/**
 * POST /api/calendar/requests { text, repeat? } -> TicketDetail (201): "Pedir reunión" on Calendario. It opens a normal
 * andres_asks ticket owned by the lead (card on the Claude lane, ticket.created wake) whose first line is
 * "Pedido de reunión (Calendario)" and whose body is his own words. Claude then finds a free slot and the invitees'
 * addresses (`mesa calendar free|people`) and proposes the exact event as a salida with source `calendar`; nothing is
 * created in Google until he approves it. `repeat` (weekly | biweekly | monthly) adds the last line "Se repite: cada
 * semana"; Claude turns it into `mesa calendar propose --repeat` (t128).
 */
export const POST = route(async (req, r) => {
  const { text, repeat } = await body(req, requestInput);
  const first = text.split("\n")[0]!.trim();
  const d = r.dispatch.createRequest({
    direction: "andres_asks",
    title: `Reunión: ${first.length > 70 ? `${first.slice(0, 69)}…` : first}`,
    body: `${MEETING_REQUEST_MARK}\n\n${text}${repeat ? `\n\nSe repite: ${REPEAT_LABEL[repeat]}` : ""}`,
  });
  return json(d, { status: 201 });
});
