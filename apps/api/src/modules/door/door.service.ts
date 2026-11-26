import { Inject, Injectable } from '@nestjs/common';
import {
  type DoorCheckInResult,
  type DoorList,
  type DoorSession,
  type DoorSessionBody,
  LIMITS,
  LOCALE_DEFAULTS,
  zonedParts,
} from '@touchgrass/shared';
import { createHmac } from 'node:crypto';
import type { Redis } from 'ioredis';
import { safeEqualHex } from '../../common/auth/hashing.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { CitiesService } from '../cities/cities.service.js';
import { CheckInService } from '../events/check-in.service.js';
import { checkInWindowOpen } from '../events/event.policy.js';
import { type EventCore, EventStore } from '../events/event-store.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { STAFF_PIN_FAILURES_PER_HOUR, staffPinFailKey } from '../venues/staff-pin.js';
import { VenuesService } from '../venues/venues.service.js';

const PREFIX = 'door1';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TOKEN_RE = new RegExp(`^${PREFIX}\\.(${UUID})\\.(\\d{1,12})\\.([0-9a-f]{40})$`);

/** Midnight in a time zone, as an instant (for "today's plans"). */
export function localDayStart(now: Date, timeZone: string): Date {
  const p = zonedParts(now, timeZone);
  return new Date(
    now.getTime() -
      ((p.hour * 60 + p.minute) * 60 + now.getUTCSeconds()) * 1000 -
      now.getUTCMilliseconds(),
  );
}

/**
 * Venue staff at the door (D-227). Staff sign in with the venue's staff PIN (the same PIN that confirms perks,
 * sharing its wrong-PIN budget) and get a signed session for 12 hours. They see today's plans at the venue with
 * each confirmed person's first name, photo and whether they are in, and check people in by scanning their
 * rotating QR or typing its short code. Nothing else about anyone (no phone numbers, no profiles).
 */
@Injectable()
export class DoorService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly venues: VenuesService,
    private readonly cities: CitiesService,
    private readonly store: EventStore,
    private readonly checkIns: CheckInService,
    private readonly profiles: ProfilesService,
  ) {}

  private sign(venueId: string, exp: number): string {
    return createHmac('sha256', this.env.SIGNED_URL_SECRET)
      .update(`door:${venueId}:${exp}`)
      .digest('hex')
      .slice(0, 40);
  }

  async signIn(body: DoorSessionBody, now: Date = new Date()): Promise<DoorSession> {
    const key = staffPinFailKey(body.venueId);
    const failures = Number((await this.redis.get(key)) ?? 0);
    if (failures >= STAFF_PIN_FAILURES_PER_HOUR)
      throw new AppError('RATE_LIMITED', 'Too many wrong PINs. Try again in an hour.');
    const venue = (await this.venues.partnerInfo([body.venueId])).get(body.venueId);
    if (!venue || !(await this.venues.checkStaffPin(body.venueId, body.pin))) {
      await this.redis.multi().incr(key).expire(key, 3600).exec();
      throw new AppError('FORBIDDEN', "That PIN doesn't match this venue", { reason: 'WRONG_PIN' });
    }
    const exp = Math.floor((now.getTime() + LIMITS.checkIn.doorSessionMs) / 1000);
    return {
      token: `${PREFIX}.${body.venueId}.${exp}.${this.sign(body.venueId, exp)}`,
      venueName: venue.name,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  /** The venue a door session is for; expired or forged sessions are refused. */
  venueOf(token: string | undefined, now: Date = new Date()): string {
    const m = TOKEN_RE.exec((token ?? '').trim());
    const exp = Number(m?.[2]);
    if (
      !m?.[1] ||
      !m[3] ||
      !safeEqualHex(m[3], this.sign(m[1], exp)) ||
      exp * 1000 <= now.getTime()
    )
      throw new AppError('UNAUTHENTICATED', 'Sign in with the venue PIN again', {
        reason: 'DOOR_SESSION',
      });
    return m[1];
  }

  /** Today's published plans at the venue (in the venue city's time zone), soonest first. */
  private async today(venueId: string, now: Date): Promise<{ cores: EventCore[]; tz: string }> {
    const venue = await this.venues.byId(venueId);
    if (!venue) throw AppError.notFound('Venue');
    const tz =
      (await this.cities.timezones([venue.cityId])).get(venue.cityId) ?? LOCALE_DEFAULTS.timezone;
    const from = localDayStart(now, tz);
    const ids = await this.store.atVenueBetween(
      venueId,
      from,
      new Date(from.getTime() + 24 * 3_600_000),
    );
    return { cores: await this.store.coresByIds(ids), tz };
  }

  async list(venueId: string, now: Date = new Date()): Promise<DoorList> {
    const info = (await this.venues.partnerInfo([venueId])).get(venueId);
    if (!info) throw AppError.notFound('Venue');
    const { cores, tz } = await this.today(venueId, now);
    const plans = [...cores].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const [holders, checkedAt] = await Promise.all([
      Promise.all(plans.map((c) => this.store.seatHolders(c.id))),
      Promise.all(plans.map((c) => this.checkIns.checkedInTimes(c.id))),
    ]);
    const userIds = [...new Set(holders.flat().map((h) => h.userId))];
    const [names, photos] = await Promise.all([
      this.profiles.displayNames(userIds),
      this.profiles.primaryPhotos(userIds),
    ]);
    const firstName = (id: string): string => (names.get(id) ?? '').split(' ')[0] ?? '';
    return {
      venueName: info.name,
      plans: plans.map((c, i) => {
        const times = checkedAt[i] ?? new Map<string, Date>();
        const people = (holders[i] ?? [])
          .map((h) => ({
            userId: h.userId,
            firstName: firstName(h.userId),
            photoUrl: photos.get(h.userId)?.sm ?? null,
            checkedIn: h.status === 'checked_in',
            checkedInAt: times.get(h.userId)?.toISOString() ?? null,
          }))
          .sort((a, b) => a.firstName.localeCompare(b.firstName));
        return {
          eventId: c.id,
          title: c.title,
          startsAt: c.startsAt.toISOString(),
          endsAt: c.endsAt.toISOString(),
          timezone: tz,
          paid: c.pricePaise > 0,
          confirmed: people.length,
          checkedIn: people.filter((p) => p.checkedIn).length,
          checkInOpen: checkInWindowOpen(c, now),
          people,
        };
      }),
    };
  }

  async checkIn(
    venueId: string,
    ticket: string,
    now: Date = new Date(),
  ): Promise<DoorCheckInResult> {
    const { cores } = await this.today(venueId, now);
    const done = await this.checkIns.staffCheckIn(venueId, cores, ticket, now);
    const name = (await this.profiles.displayNames([done.userId])).get(done.userId) ?? '';
    return {
      eventId: done.eventId,
      userId: done.userId,
      firstName: name.split(' ')[0] ?? '',
      checkedInAt: done.checkedInAt.toISOString(),
      already: done.already,
    };
  }
}
