import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** D-228. Owner: `hosting` → host_standing (rule acknowledgement, hosting removed after payment strikes). */
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const hostStanding = pgTable('host_standing', {
  userId: uuid('user_id').primaryKey(),
  rulesAcknowledgedAt: ts('rules_acknowledged_at'),
  hostingRevokedAt: ts('hosting_revoked_at'),
  revokedReason: text('revoked_reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
