import { json, route } from "@/lib/api/http";
import { knownPeople } from "@/lib/domain/calendar";

export const dynamic = "force-dynamic";

/**
 * GET /api/calendar/people -> { people: [{ email, name, meetings }] }: the people on the stored events (about five
 * weeks), most shared meetings first, so Claude can find an invitee's address ("meet con Matt"). The owner is left out
 * when MESA_GCAL_OWNER_EMAIL is set.
 */
export const GET = route((_req, r) => {
  const now = new Date();
  const events = r.calendar.list({ from: new Date(now.getTime() - 35 * 86_400_000), to: new Date(now.getTime() + 35 * 86_400_000) });
  return json({ people: knownPeople(events, process.env.MESA_GCAL_OWNER_EMAIL?.trim() || null) });
});
