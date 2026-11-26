import { Inject, Injectable, Module } from '@nestjs/common';
import type { CheckInFlag, CheckInFlagKind } from '@touchgrass/shared';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { DB, type Database } from '../../infra/database/database.module.js';
import { eventCheckInFlags, rsvps } from '../../infra/database/schema/index.js';

/**
 * Read side of check-in (D-227) with no module dependencies, for payments (payout holds), admin and anything
 * else that needs headcounts. `checkedInCount` counts people checked in (each person once); `flags` lists the
 * fake-headcount flags on the plan, reviewed or not.
 */
@Injectable()
export class CheckInReader {
  constructor(@Inject(DB) private readonly db: Database) {}

  async checkedInCount(eventId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(rsvps)
      .where(and(eq(rsvps.eventId, eventId), eq(rsvps.status, 'checked_in')));
    return row?.n ?? 0;
  }

  async flags(eventId: string): Promise<CheckInFlag[]> {
    const rows = await this.db
      .select()
      .from(eventCheckInFlags)
      .where(eq(eventCheckInFlags.eventId, eventId))
      .orderBy(asc(eventCheckInFlags.kind));
    return rows.map((r) => ({
      kind: r.kind,
      count: r.count,
      flaggedAt: r.flaggedAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
    }));
  }

  /** True while any flag on the plan waits for review (payouts can hold on this). */
  async hasOpenFlags(eventId: string): Promise<boolean> {
    return ((await this.openFlagKinds([eventId])).get(eventId) ?? []).length > 0;
  }

  /** Flags nobody has reviewed yet, per plan. */
  async openFlagKinds(eventIds: string[]): Promise<Map<string, CheckInFlagKind[]>> {
    const out = new Map<string, CheckInFlagKind[]>();
    if (eventIds.length === 0) return out;
    const rows = await this.db
      .select({ eventId: eventCheckInFlags.eventId, kind: eventCheckInFlags.kind })
      .from(eventCheckInFlags)
      .where(
        and(inArray(eventCheckInFlags.eventId, eventIds), isNull(eventCheckInFlags.reviewedAt)),
      )
      .orderBy(asc(eventCheckInFlags.kind));
    for (const r of rows) out.set(r.eventId, [...(out.get(r.eventId) ?? []), r.kind]);
    return out;
  }
}

@Module({ providers: [CheckInReader], exports: [CheckInReader] })
export class CheckInReaderModule {}
