import { z } from 'zod';

/**
 * Host conduct (D-228): the one-time "No payments outside TouchGrass" rule a host agrees to before their first
 * plan, and strikes for confirmed reports of asking people to pay outside the app.
 */
export const HOST_RULES = ['no_off_platform_payments'] as const;
export const HostRule = z.enum(HOST_RULES);
export type HostRule = z.infer<typeof HostRule>;

export const HOST_PAYMENT_STRIKES = {
  /** Confirmed strikes within the window that remove hosting rights. */
  revokeAt: 2,
  /** Strikes older than this no longer count. */
  windowDays: 365,
} as const;

export const HostConduct = z.object({
  /** Agreed to "No payments outside TouchGrass" (asked once, before the first plan). */
  rulesAcknowledged: z.boolean(),
  acknowledgedAt: z.iso.datetime().nullable(),
  /** Hosting removed after repeated confirmed payment strikes; an admin can give it back. */
  hostingRevoked: z.boolean(),
  /** Confirmed payment strikes still counting. */
  strikes: z.number().int(),
  strikeLimit: z.number().int(),
});
export type HostConduct = z.infer<typeof HostConduct>;

export const AcknowledgeHostRulesBody = z.object({ rule: HostRule });
export type AcknowledgeHostRulesBody = z.infer<typeof AcknowledgeHostRulesBody>;

export const ReinstateHostingBody = z.object({ note: z.string().trim().min(3).max(500) });
export type ReinstateHostingBody = z.infer<typeof ReinstateHostingBody>;
