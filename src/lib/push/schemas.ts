import { z } from "zod";

/** A push service URL: always https (Google, Mozilla, Apple). */
const endpoint = z
  .string()
  .max(2048)
  .refine((s) => /^https:\/\/[^\s]+$/.test(s), "expected an https URL");

export const subscriptionInput = z.object({
  endpoint,
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  label: z.string().max(80).optional(),
});

export const endpointInput = z.object({ endpoint });

export const lookingInput = z.object({ tab: z.string().min(1).max(64), looking: z.boolean() });
