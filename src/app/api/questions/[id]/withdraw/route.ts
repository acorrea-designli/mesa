import { body, json, route } from "@/lib/api/http";
import { questionWithdraw } from "@/lib/api/schemas";

/** POST /api/questions/:id/withdraw { reason } -> TicketQuestion. Claude withdraws an open card question (404 unknown, 409 not open). */
export const POST = route<{ id: string }>(async (req, r, { id }) => json(r.tickets.withdrawQuestion(id, (await body(req, questionWithdraw)).reason)));
