import { Inject, Injectable } from '@nestjs/common';
import { HOST_PAYMENT_STRIKES } from '@touchgrass/shared';
import { and, eq, gt, gte, isNull, max } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { userSanctions } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';

const DAY_MS = 86_400_000;
/** A confirmed "asked to pay" report against someone (D-228); hosting counts these and may remove hosting. */
export const PAYMENT_STRIKE_RECORDED_EVENT = 'moderation.payment_strike';

/** Read side of sanctions, for content modules: a muted person can't post or message (F-SAF-05). */
@Injectable()
export class SanctionsReader {
  constructor(@Inject(DB) private readonly db: Database) {}

  async mutedUntil(userId: string, now: Date = new Date()): Promise<Date | null> {
    const [row] = await this.db
      .select({ until: max(userSanctions.until) })
      .from(userSanctions)
      .where(
        and(
          eq(userSanctions.userId, userId),
          eq(userSanctions.kind, 'mute'),
          isNull(userSanctions.liftedAt),
          gt(userSanctions.until, now),
        ),
      );
    return row?.until ?? null;
  }

  async assertCanPost(userId: string, now: Date = new Date()): Promise<void> {
    const until = await this.mutedUntil(userId, now);
    if (until)
      throw new AppError('FORBIDDEN', 'Muted', { reason: 'MUTED', until: until.toISOString() });
  }

  /** Confirmed payment strikes (D-228) that still count: not lifted, within the window. */
  async paymentStrikes(
    userId: string,
    now: Date = new Date(),
    db: DbOrTx = this.db,
  ): Promise<number> {
    const since = new Date(now.getTime() - HOST_PAYMENT_STRIKES.windowDays * DAY_MS);
    return db.$count(
      userSanctions,
      and(
        eq(userSanctions.userId, userId),
        eq(userSanctions.code, 'off_platform_payment'),
        isNull(userSanctions.liftedAt),
        gte(userSanctions.createdAt, since),
      ),
    );
  }
}
