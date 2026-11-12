import { z } from "zod";
import { body, json, route } from "@/lib/api/http";
import { addAllowRule, settingsLocalPath, worktreesRoot } from "@/lib/integrations/settings-rules";

const input = z.object({ note: z.string().max(2000).optional() });

/**
 * POST /api/approvals/:id/approve { note? } -> { approval }. UI only (Dar permiso: allow this one call). 409 after expiry or once decided.
 * On a "denied" card (t128, "Permitir esta regla") the server derives the rule from the stored call and appends it to
 * settings.local.json before the card is decided; a call with no derivable rule is a 409 and nothing is written.
 */
export const POST = route<{ id: string }>(async (req, r, { id }) =>
  json({
    approval: r.approvals.decide(id, { decision: "allow", actor: "andres", note: (await body(req, input)).note }, new Date(), {
      writeRule: (rule) => void addAllowRule(settingsLocalPath(), rule, worktreesRoot()),
    }),
  }),
);
