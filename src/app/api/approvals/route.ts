import { body, json, query, route } from "@/lib/api/http";
import { approvalInput } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/approvals?status=pending&ticket=&hoy=1 -> { approvals } (hoy=1: approvals with no ticket) */
export const GET = route((req, r) => {
  const q = query(req);
  const status = q.get("status");
  return json({
    approvals: r.approvals.list({
      status: status === "pending" || status === "decided" || status === "expired" ? status : undefined,
      ticket: q.get("ticket") ?? undefined,
      hoy: q.get("hoy") === "1",
    }),
  });
});

/** POST /api/approvals ApprovalInput -> { approval } (201). Filed by scripts/hooks/mesa-approval.mjs */
export const POST = route(async (req, r) => json({ approval: r.approvals.create(await body(req, approvalInput)) }, { status: 201 }));
