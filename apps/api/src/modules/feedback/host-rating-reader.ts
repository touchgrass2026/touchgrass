import { Inject, Injectable, Module } from '@nestjs/common';
import { averageRating, type HostRatingSummary, LIMITS } from '@touchgrass/shared';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { DB_REPLICA, type Database } from '../../infra/database/database.module.js';
import { eventFeedback, hostRatings } from '../../infra/database/schema/index.js';
import { isTopHost, topHostWindowStart } from './top-host.policy.js';

/**
 * Host ratings (F-AFT-05) for profiles and discovery ranking. No module dependencies, so profiles and
 * discovery can read it without import cycles. Averages show only from `minRatingsToShow` ratings.
 */
@Injectable()
export class HostRatingReader {
  constructor(@Inject(DB_REPLICA) private readonly replica: Database) {}

  async summaries(hostIds: string[]): Promise<Map<string, HostRatingSummary>> {
    const out = new Map<string, HostRatingSummary>();
    if (hostIds.length === 0) return out;
    const rows = await this.replica
      .select({
        hostId: hostRatings.hostUserId,
        sum: sql<number>`sum(${hostRatings.rating})::int`,
        n: sql<number>`count(*)::int`,
      })
      .from(hostRatings)
      .where(inArray(hostRatings.hostUserId, [...new Set(hostIds)]))
      .groupBy(hostRatings.hostUserId);
    for (const r of rows)
      out.set(r.hostId, {
        average: r.n >= LIMITS.after.minRatingsToShow ? averageRating(r.sum, r.n) : null,
        count: r.n,
      });
    return out;
  }

  /**
   * Which of these people are "Top hosts" now (D-210): one grouped query for a whole page of plans, on the
   * replica and the `(host_user_id)` index. A rating counts from when it was first given (changes are only
   * allowed for 14 days after the plan, `feedbackWindowDays`).
   */
  async topHosts(hostIds: string[], now: Date = new Date()): Promise<Set<string>> {
    const out = new Set<string>();
    if (hostIds.length === 0) return out;
    const rows = await this.replica
      .select({
        hostId: hostRatings.hostUserId,
        sum: sql<number>`sum(${hostRatings.rating})::int`,
        n: sql<number>`count(*)::int`,
      })
      .from(hostRatings)
      .where(
        and(
          inArray(hostRatings.hostUserId, [...new Set(hostIds)]),
          gte(hostRatings.createdAt, topHostWindowStart(now)),
        ),
      )
      .groupBy(hostRatings.hostUserId);
    for (const r of rows) if (isTopHost({ count: r.n, sum: r.sum })) out.add(r.hostId);
    return out;
  }

  /** Stars one person gave each plan afterwards (Customer 360, D-192). */
  async feedbackBy(userId: string): Promise<Map<string, number>> {
    const rows = await this.replica
      .select({ eventId: eventFeedback.eventId, rating: eventFeedback.rating })
      .from(eventFeedback)
      .where(eq(eventFeedback.userId, userId));
    return new Map(rows.map((r) => [r.eventId, r.rating]));
  }
}

@Module({ providers: [HostRatingReader], exports: [HostRatingReader] })
export class HostRatingReaderModule {}
