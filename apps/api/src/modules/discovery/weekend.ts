import { LIMITS, zonedParts } from '@touchgrass/shared';
import { createHash } from 'node:crypto';
import { canViewEvent, rsvpEligibility, type ViewerFacts } from '../events/event.policy.js';
import type { EventCore } from '../events/event-store.service.js';

const W = LIMITS.weekendDigest;
const DAY = 86_400_000;

/** The UTC instant of a wall-clock time in `timeZone` (two passes settle DST edges). */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let t = wanted;
  for (let i = 0; i < 2; i += 1) {
    const p = zonedParts(new Date(t), timeZone);
    t -= Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - wanted;
  }
  return new Date(t);
}

/**
 * This week's weekend in the city's zone (D-211): Friday 17:00 to Monday 00:00. Once it has started the
 * window runs from `now`, so the digest screen never offers a plan that already began.
 */
export function weekendWindow(now: Date, timeZone: string): { from: Date; to: Date } {
  const p = zonedParts(now, timeZone);
  const friday = new Date(Date.UTC(p.year, p.month - 1, p.day) + (5 - p.weekday) * DAY);
  const monday = new Date(friday.getTime() + 3 * DAY);
  const from = zonedTimeToUtc(
    friday.getUTCFullYear(),
    friday.getUTCMonth() + 1,
    friday.getUTCDate(),
    W.fridayFromHour,
    0,
    timeZone,
  );
  const to = zonedTimeToUtc(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    0,
    0,
    timeZone,
  );
  return { from: now.getTime() > from.getTime() ? now : from, to };
}

/** Whether the "This weekend" push is due in this zone: Thursday, 18:30 to 20:30 local (missed ticks catch up). */
export function weekendDigestDue(now: Date, timeZone: string): boolean {
  const p = zonedParts(now, timeZone);
  const minute = p.hour * 60 + p.minute;
  return p.weekday === W.sendWeekday && minute >= W.sendFromMinute && minute < W.sendUntilMinute;
}

/**
 * `reminder_log.ref_id` is a uuid: the ISO week becomes a stable name-based uuid (v5 layout), so the digest is
 * claimed once per member per week without a schema change.
 */
export function weekRefId(isoWeek: string): string {
  const h = createHash('sha1').update(`touchgrass:weekend-digest:${isoWeek}`).digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export interface WeekendCandidate {
  id: string;
  /** Matches between the plan's category + interests and the member's interests. */
  interestMatches: number;
  /** From the member's neighbourhood; null when their area is unknown (distance then doesn't count). */
  distanceMeters: number | null;
  startsAt: Date;
}

/** Each shared interest is worth a point (up to three); closeness adds under one point, so it orders plans
 * with the same number of matches without outweighing a match. */
const MAX_INTEREST_MATCHES = 3;
const DISTANCE_POINTS = 0.9;
const DISTANCE_SCALE_METERS = 5000;

/** Interests first, then closeness; ties go to the earlier plan. Pure, so it is unit-tested directly. */
export function weekendScore(c: WeekendCandidate): number {
  const interests = Math.min(MAX_INTEREST_MATCHES, Math.max(0, c.interestMatches));
  const near =
    c.distanceMeters === null
      ? 0
      : Math.exp(-Math.max(0, c.distanceMeters) / DISTANCE_SCALE_METERS);
  return interests + DISTANCE_POINTS * near;
}

export function rankWeekendPicks(
  candidates: WeekendCandidate[],
  limit: number = W.picks,
): WeekendCandidate[] {
  return [...candidates]
    .map((c) => ({ c, s: weekendScore(c) }))
    .sort(
      (a, b) =>
        b.s - a.s || a.c.startsAt.getTime() - b.c.startsAt.getTime() || (a.c.id < b.c.id ? -1 : 1),
    )
    .slice(0, limit)
    .map((x) => x.c);
}

/**
 * Whether a plan belongs in someone's weekend picks: published, not held, not a mystery (its details stay hidden
 * until reveal), starting inside the window, not full, not already joined (going, checked in, waitlisted or
 * mid-checkout), visible to them and open to them right now (hosts, blocks, gender-only plans they don't match
 * and private plans needing approval all fail `rsvpEligibility`).
 */
export function isWeekendPick(
  core: EventCore,
  facts: ViewerFacts,
  seats: number,
  window: { from: Date; to: Date },
  now: Date,
): boolean {
  const t = core.startsAt.getTime();
  return (
    core.status === 'published' &&
    !core.held &&
    !core.mystery &&
    t >= window.from.getTime() &&
    t < window.to.getTime() &&
    seats < core.capacity &&
    (facts.rsvp === null || facts.rsvp === 'cancelled' || facts.rsvp === 'interested') &&
    canViewEvent(facts, core) &&
    rsvpEligibility(facts, core, now).ok
  );
}
