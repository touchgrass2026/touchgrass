import { Inject, Injectable } from '@nestjs/common';
import { HOST_PAYMENT_STRIKES, type HostConduct, type HostRule } from '@touchgrass/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { hostApplications, hostStanding } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { SanctionsReader } from '../moderation/sanctions-reader.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { assertMayHost, strikeOutcome } from './host-conduct.policy.js';

type StandingRow = typeof hostStanding.$inferSelect;

const REVOKED_NOTE = 'Hosting removed after repeated payment strikes (D-228)';

/**
 * Host conduct (D-228): the one-time "No payments outside TouchGrass" rule, and hosting removed after repeated
 * confirmed reports of asking for payment outside the app. Strikes live in the sanctions model (moderation);
 * this module only counts them.
 */
@Injectable()
export class HostConductService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly sanctions: SanctionsReader,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async standing(userId: string, db: DbOrTx = this.db): Promise<StandingRow | null> {
    const [row] = await db.select().from(hostStanding).where(eq(hostStanding.userId, userId));
    return row ?? null;
  }

  async revoked(userId: string): Promise<boolean> {
    return Boolean((await this.standing(userId))?.hostingRevokedAt);
  }

  async conduct(userId: string, now: Date = new Date()): Promise<HostConduct> {
    const [row, strikes] = await Promise.all([
      this.standing(userId),
      this.sanctions.paymentStrikes(userId, now),
    ]);
    return {
      rulesAcknowledged: Boolean(row?.rulesAcknowledgedAt),
      acknowledgedAt: row?.rulesAcknowledgedAt?.toISOString() ?? null,
      hostingRevoked: Boolean(row?.hostingRevokedAt),
      strikes,
      strikeLimit: HOST_PAYMENT_STRIKES.revokeAt,
    };
  }

  /** Records the one-time acknowledgement; agreeing again keeps the first time. */
  async acknowledge(userId: string, _rule: HostRule, now: Date = new Date()): Promise<HostConduct> {
    await this.db
      .insert(hostStanding)
      .values({ userId, rulesAcknowledgedAt: now })
      .onConflictDoUpdate({
        target: hostStanding.userId,
        set: { rulesAcknowledgedAt: sql`coalesce(${hostStanding.rulesAcknowledgedAt}, ${now})` },
      });
    return this.conduct(userId, now);
  }

  /** Events hook: plotting needs hosting rights. */
  async assertCanHost(userId: string): Promise<void> {
    assertMayHost(await this.standing(userId));
  }

  /**
   * Worker: a payment strike was confirmed. Below the limit the person is warned; at the limit hosting is removed
   * (free and paid), and a live application to sell tickets is turned down, so it has to be earned again.
   */
  async onStrike(userId: string, now: Date = new Date()): Promise<'warn' | 'revoke' | 'already'> {
    const strikes = await this.sanctions.paymentStrikes(userId, now);
    const outcome = strikeOutcome(strikes);
    if (outcome === 'warn') {
      await this.notifications.notify([userId], 'payment_strike', {});
      return 'warn';
    }
    const changed = await this.db.transaction(async (tx) => this.revoke(userId, now, tx));
    if (changed) await this.notifications.notify([userId], 'hosting_revoked', {});
    return changed ? 'revoke' : 'already';
  }

  private async revoke(userId: string, now: Date, tx: Tx): Promise<boolean> {
    const current = await this.standing(userId, tx);
    if (current?.hostingRevokedAt) return false;
    await tx
      .insert(hostStanding)
      .values({ userId, hostingRevokedAt: now, revokedReason: REVOKED_NOTE })
      .onConflictDoUpdate({
        target: hostStanding.userId,
        set: { hostingRevokedAt: now, revokedReason: REVOKED_NOTE },
      });
    await tx
      .update(hostApplications)
      .set({ status: 'rejected', reviewNote: REVOKED_NOTE, reviewedAt: now })
      .where(
        and(
          eq(hostApplications.userId, userId),
          inArray(hostApplications.status, ['pending', 'approved']),
        ),
      );
    return true;
  }

  /** Admin: gives hosting back (strikes stay on record; lift them separately if they were wrong). */
  async reinstate(adminId: string, userId: string, note: string): Promise<HostConduct> {
    await this.db.transaction(async (tx) => {
      const current = await this.standing(userId, tx);
      if (!current?.hostingRevokedAt)
        throw new AppError('CONFLICT', 'Hosting is not paused', { reason: 'ALREADY_RESOLVED' });
      await tx
        .update(hostStanding)
        .set({ hostingRevokedAt: null, revokedReason: null })
        .where(eq(hostStanding.userId, userId));
      await this.audit.record(
        {
          adminUserId: adminId,
          action: 'hosting.reinstate',
          targetType: 'user',
          targetId: userId,
          details: { note },
        },
        tx,
      );
    });
    return this.conduct(userId);
  }

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const row = await this.standing(userId);
    return {
      hostStanding: row
        ? {
            rulesAcknowledgedAt: row.rulesAcknowledgedAt?.toISOString() ?? null,
            hostingRevokedAt: row.hostingRevokedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(hostStanding).where(eq(hostStanding.userId, userId));
  }
}
