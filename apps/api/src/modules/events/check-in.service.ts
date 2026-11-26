import { Inject, Injectable } from '@nestjs/common';
import {
  type CheckInBody,
  type CheckInMethod,
  type CheckInResult,
  type GeoPoint,
  LIMITS,
  type Ticket,
} from '@touchgrass/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { checkInLog, eventCheckInFlags, rsvps } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { SessionDeviceReader } from '../auth/session-device-reader.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import {
  coarsen,
  headcountFlags,
  matchShortCode,
  stepEndsAt,
  ticketShortCode,
  ticketStep,
  ticketToken,
  verifyTicket,
} from './check-in-integrity.js';
import { EventAccessService } from './event-access.service.js';
import { checkInWindowOpen, isLocationRevealed } from './event.policy.js';
import { type EventCore, EventStore } from './event-store.service.js';

export const RSVP_CHECKED_IN_EVENT = 'rsvp.checked_in';
/** Arriving within this long after the start counts as on time (reliability, F-SAF-02). */
export const ON_TIME_GRACE_MS = 15 * 60_000;
/** A ticket's last known coarse location counts for a scan only if the ticket was fetched this recently. */
const FRESH_TICKET_MS = 2 * 60_000;
const C = LIMITS.checkIn;

/** Who checked someone in, for the check-in log (D-227). */
export type CheckInActor =
  { kind: 'self' } | { kind: 'host'; userId: string } | { kind: 'venue_staff'; venueId: string };

interface TicketMeta {
  deviceHash: string | null;
  point: GeoPoint | null;
  at: number;
}

interface Signals {
  deviceHash: string | null;
  point: GeoPoint | null;
}

/**
 * Check-in (F-EVT-14, D-227): hosts or venue staff scan a person's rotating QR (or type its short code), or the
 * person checks themselves in inside a 150 m geofence. Tickets are signed for one person, one plan and one
 * 30-second step, so a screenshot stops working and cannot be used for another plan. Self check-in is only
 * possible once the spot is revealed to that person, so probing the geofence can never locate a hidden spot.
 * Every check-in is logged with coarse signals, and plans whose check-ins look staged are flagged for review.
 */
@Injectable()
export class CheckInService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly store: EventStore,
    private readonly access: EventAccessService,
    private readonly profiles: ProfilesService,
    private readonly outbox: OutboxService,
    private readonly devices: SessionDeviceReader,
  ) {}

  private get secret(): string {
    return this.env.SIGNED_URL_SECRET;
  }

  /** The current QR payload and short code for a person (also used by tests to build tickets). */
  ticketAt(eventId: string, userId: string, now: Date): { qr: string; code: string } {
    const step = ticketStep(now);
    return {
      qr: ticketToken(this.secret, eventId, userId, step),
      code: ticketShortCode(this.secret, eventId, userId, step),
    };
  }

  async ticket(
    userId: string,
    eventId: string,
    opts: { sessionId?: string; point?: GeoPoint | null } = {},
    now: Date = new Date(),
  ): Promise<Ticket> {
    const { core, facts } = await this.access.visibleOrThrow(userId, eventId);
    if (facts.rsvp !== 'going' && facts.rsvp !== 'checked_in')
      throw new AppError('NOT_ELIGIBLE', 'Pull up first to get a ticket', { reason: 'NOT_GOING' });
    const meta: TicketMeta = {
      deviceHash: opts.sessionId ? await this.devices.deviceHash(opts.sessionId) : null,
      point: opts.point ? coarsen(opts.point) : null,
      at: now.getTime(),
    };
    // The phone showing the code, and roughly where it is, for the fake-headcount checks at scan time.
    await this.redis.set(this.metaKey(eventId, userId), JSON.stringify(meta), 'EX', 3 * 3600);
    const step = ticketStep(now);
    return {
      ...this.ticketAt(eventId, userId, now),
      eventId,
      validFrom: new Date(core.startsAt.getTime() - C.windowBeforeMs).toISOString(),
      validUntil: new Date(
        Math.min(core.startsAt.getTime() + C.windowAfterMs, core.endsAt.getTime()),
      ).toISOString(),
      rotatesAt: stepEndsAt(step).toISOString(),
      rotateEveryMs: C.ticketStepMs,
    };
  }

  async checkIn(
    callerId: string,
    eventId: string,
    body: CheckInBody,
    opts: { sessionId?: string } = {},
    now: Date = new Date(),
  ): Promise<CheckInResult> {
    if ('qr' in body || 'code' in body) {
      const core = await this.access.requireHost(callerId, eventId);
      const raw = 'qr' in body ? body.qr : body.code;
      const who = await this.resolve(raw, [core], now);
      const out = await this.admit(
        core,
        who.userId,
        'qr' in body ? 'qr' : 'code',
        { kind: 'host', userId: callerId },
        body.point ?? null,
        now,
      );
      return this.result(out.userId, core.id);
    }
    const { core, facts } = await this.access.visibleOrThrow(callerId, eventId);
    if (facts.rsvp === 'checked_in') return this.result(callerId, eventId);
    if (facts.rsvp !== 'going')
      throw new AppError('NOT_ELIGIBLE', 'Pull up first', { reason: 'NOT_GOING' });
    this.assertWindow(core, now);
    if (!isLocationRevealed(facts, core, now))
      throw new AppError('CHECK_IN_UNAVAILABLE', 'Wait for the reveal', { reason: 'NOT_REVEALED' });
    if (!(await this.store.within(eventId, body.point, C.geofenceMeters)))
      throw new AppError('CHECK_IN_UNAVAILABLE', 'You are not at the spot yet', {
        reason: 'TOO_FAR',
      });
    await this.mark(core, callerId, 'geofence', { kind: 'self' }, now, {
      deviceHash: opts.sessionId ? await this.devices.deviceHash(opts.sessionId) : null,
      point: body.point,
    });
    return this.result(callerId, eventId);
  }

  /**
   * Venue staff check someone in at the door (D-227): the ticket must belong to one of the venue's plans that
   * are on today. Returns who it was and whether they were already in.
   */
  async staffCheckIn(
    venueId: string,
    cores: EventCore[],
    raw: string,
    now: Date = new Date(),
  ): Promise<{ eventId: string; userId: string; checkedInAt: Date; already: boolean }> {
    const who = await this.resolve(raw, cores, now);
    const core = cores.find((c) => c.id === who.eventId);
    if (!core) throw AppError.notFound('Plan');
    const out = await this.admit(
      core,
      who.userId,
      /^\d+$/.test(raw.trim()) ? 'code' : 'qr',
      { kind: 'venue_staff', venueId },
      null,
      now,
    );
    return { eventId: core.id, ...out };
  }

  /** Whose ticket this is, among the given plans; refuses forged, expired and foreign tickets. */
  private async resolve(
    raw: string,
    cores: EventCore[],
    now: Date,
  ): Promise<{ eventId: string; userId: string }> {
    const value = raw.trim();
    const step = ticketStep(now);
    if (/^\d+$/.test(value)) {
      if (value.length !== C.ticketCodeDigits)
        throw new AppError('CHECK_IN_UNAVAILABLE', 'That code is not valid', {
          reason: 'INVALID_TICKET',
        });
      const open = cores.filter((c) => checkInWindowOpen(c, now));
      if (open.length === 0) this.assertWindow(cores[0], now);
      const seats = await this.db
        .select({ eventId: rsvps.eventId, userId: rsvps.userId })
        .from(rsvps)
        .where(
          and(
            inArray(
              rsvps.eventId,
              open.map((c) => c.id),
            ),
            inArray(rsvps.status, ['going', 'checked_in']),
          ),
        );
      const match = matchShortCode(
        this.secret,
        value,
        open.map((c) => ({
          eventId: c.id,
          userIds: seats.filter((s) => s.eventId === c.id).map((s) => s.userId),
        })),
        step,
      );
      if (!match.ok)
        throw new AppError('CHECK_IN_UNAVAILABLE', 'That code does not match anyone here', {
          reason: match.reason,
        });
      return match;
    }
    const check = verifyTicket(this.secret, value, step);
    if (!check.ok && check.reason === 'INVALID_TICKET')
      throw new AppError('CHECK_IN_UNAVAILABLE', 'That ticket is not valid', {
        reason: 'INVALID_TICKET',
      });
    if (check.ok) {
      const core = cores.find((c) => c.id === check.eventId);
      if (!core)
        throw new AppError('CHECK_IN_UNAVAILABLE', 'That ticket is for another plan', {
          reason: 'WRONG_EVENT',
        });
      this.assertWindow(core, now);
      return { eventId: check.eventId, userId: check.userId };
    }
    this.assertWindow(cores[0], now);
    throw new AppError('TICKET_EXPIRED', 'That code has expired. Ask for the current one.', {
      reason: 'TICKET_EXPIRED',
    });
  }

  /** Checks in someone holding a seat; idempotent (a second scan reports the first check-in). */
  private async admit(
    core: EventCore,
    userId: string,
    method: CheckInMethod,
    actor: CheckInActor,
    scannerPoint: GeoPoint | null,
    now: Date,
  ): Promise<{ userId: string; checkedInAt: Date; already: boolean }> {
    const [row] = await this.db
      .select({ status: rsvps.status, checkedInAt: rsvps.checkedInAt })
      .from(rsvps)
      .where(and(eq(rsvps.eventId, core.id), eq(rsvps.userId, userId)))
      .limit(1);
    if (row?.status === 'checked_in')
      return { userId, checkedInAt: row.checkedInAt ?? now, already: true };
    if (row?.status !== 'going')
      throw new AppError('CHECK_IN_UNAVAILABLE', 'They are not on the list', {
        reason: 'NOT_GOING',
      });
    const meta = await this.meta(core.id, userId, now);
    const checkedInAt = await this.mark(core, userId, method, actor, now, {
      deviceHash: meta?.deviceHash ?? null,
      point: meta?.point ?? scannerPoint,
      scannerPoint,
    });
    return { userId, checkedInAt, already: false };
  }

  private metaKey(eventId: string, userId: string): string {
    return `ticket-meta:${eventId}:${userId}`;
  }

  private async meta(eventId: string, userId: string, now: Date): Promise<TicketMeta | null> {
    const raw = await this.redis.get(this.metaKey(eventId, userId));
    if (!raw) return null;
    const meta = JSON.parse(raw) as TicketMeta;
    // A location from long before the scan says nothing about where the person is now.
    return now.getTime() - meta.at <= FRESH_TICKET_MS ? meta : { ...meta, point: null };
  }

  private assertWindow(core: EventCore | undefined, now: Date): void {
    if (!core || !checkInWindowOpen(core, now))
      throw new AppError('CHECK_IN_UNAVAILABLE', 'Check-in is not open', {
        reason: 'WINDOW_CLOSED',
      });
  }

  private async mark(
    core: EventCore,
    userId: string,
    method: CheckInMethod,
    actor: CheckInActor,
    now: Date,
    signals: Signals & { scannerPoint?: GeoPoint | null },
  ): Promise<Date> {
    // Distances come from PostGIS, so the spot itself is never read here.
    const distances = await Promise.all(
      [signals.point, signals.scannerPoint ?? null].map((p) =>
        p ? this.store.distanceTo(core.id, p) : Promise.resolve(null),
      ),
    );
    const known = distances.filter((d): d is number => d !== null);
    const distanceM = known.length > 0 ? Math.max(...known) : null;
    let at = now;
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(rsvps)
        .set({ status: 'checked_in', checkedInAt: now, checkInMethod: method })
        .where(and(eq(rsvps.eventId, core.id), eq(rsvps.userId, userId), eq(rsvps.status, 'going')))
        .returning({ userId: rsvps.userId });
      if (updated.length === 0) {
        const [row] = await tx
          .select({ at: rsvps.checkedInAt })
          .from(rsvps)
          .where(and(eq(rsvps.eventId, core.id), eq(rsvps.userId, userId)));
        at = row?.at ?? now;
        return;
      }
      await tx.insert(checkInLog).values({
        id: uuidv7(),
        eventId: core.id,
        userId,
        method,
        actor: actor.kind,
        actorUserId: actor.kind === 'host' ? actor.userId : null,
        venueId: actor.kind === 'venue_staff' ? actor.venueId : null,
        deviceHash: signals.deviceHash,
        coarseLocation: signals.point ? coarsen(signals.point) : null,
        distanceM,
        createdAt: now,
      });
      await this.outbox.add(tx, {
        aggregateType: 'event',
        aggregateId: core.id,
        type: RSVP_CHECKED_IN_EVENT,
        payload: {
          eventId: core.id,
          userId,
          method,
          onTime: now.getTime() <= core.startsAt.getTime() + ON_TIME_GRACE_MS,
        },
      });
      await this.refreshFlags(tx, core.id, now);
    });
    return at;
  }

  /** Recomputes the plan's fake-headcount flags; a flag that grows after review opens again. */
  private async refreshFlags(tx: Tx, eventId: string, now: Date): Promise<void> {
    const signals = await tx
      .select({
        userId: checkInLog.userId,
        deviceHash: checkInLog.deviceHash,
        distanceM: checkInLog.distanceM,
      })
      .from(checkInLog)
      .where(eq(checkInLog.eventId, eventId));
    for (const flag of headcountFlags(signals)) {
      await tx
        .insert(eventCheckInFlags)
        .values({ eventId, kind: flag.kind, count: flag.count, flaggedAt: now })
        .onConflictDoUpdate({
          target: [eventCheckInFlags.eventId, eventCheckInFlags.kind],
          set: {
            count: flag.count,
            reviewedAt: sql`CASE WHEN ${flag.count}::int > ${eventCheckInFlags.count} THEN NULL ELSE ${eventCheckInFlags.reviewedAt} END`,
            reviewedBy: sql`CASE WHEN ${flag.count}::int > ${eventCheckInFlags.count} THEN NULL ELSE ${eventCheckInFlags.reviewedBy} END`,
          },
        });
    }
  }

  private async result(userId: string, eventId: string): Promise<CheckInResult> {
    const [row] = await this.db
      .select({ checkedInAt: rsvps.checkedInAt, method: rsvps.checkInMethod })
      .from(rsvps)
      .where(and(eq(rsvps.eventId, eventId), eq(rsvps.userId, userId)))
      .limit(1);
    if (!row?.checkedInAt || !row.method) throw AppError.notFound('Check-in');
    const name = (await this.profiles.displayNames([userId])).get(userId) ?? '';
    return {
      userId,
      displayName: name,
      checkedInAt: row.checkedInAt.toISOString(),
      method: row.method,
    };
  }

  /** When each checked-in person at a plan checked in (the venue door list). */
  async checkedInTimes(eventId: string): Promise<Map<string, Date>> {
    const rows = await this.db
      .select({ userId: rsvps.userId, at: rsvps.checkedInAt })
      .from(rsvps)
      .where(and(eq(rsvps.eventId, eventId), eq(rsvps.status, 'checked_in')));
    return new Map(rows.flatMap((r) => (r.at ? [[r.userId, r.at] as const] : [])));
  }

  // ---------- personal data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>[]> {
    const rows = await this.db
      .select({
        eventId: checkInLog.eventId,
        method: checkInLog.method,
        actor: checkInLog.actor,
        lat: sql<number | null>`ST_Y(${checkInLog.coarseLocation}::geometry)`,
        lng: sql<number | null>`ST_X(${checkInLog.coarseLocation}::geometry)`,
        createdAt: checkInLog.createdAt,
      })
      .from(checkInLog)
      .where(eq(checkInLog.userId, userId));
    return rows.map((r) => ({
      eventId: r.eventId,
      method: r.method,
      by: r.actor,
      coarseLocation: r.lat === null || r.lng === null ? null : { lat: r.lat, lng: r.lng },
      at: r.createdAt.toISOString(),
    }));
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(checkInLog).where(eq(checkInLog.userId, userId));
    await tx
      .update(checkInLog)
      .set({ actorUserId: null })
      .where(eq(checkInLog.actorUserId, userId));
  }
}
