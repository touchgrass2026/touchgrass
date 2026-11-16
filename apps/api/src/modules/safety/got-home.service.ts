import { Inject, Injectable } from '@nestjs/common';
import {
  type GotHomeStatus,
  isLatePlan,
  LIMITS,
  LOCALE_DEFAULTS,
  type SafetySettings,
  type UpdateSafetySettingsBody,
} from '@touchgrass/shared';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { gotHomeChecks, safetySettings } from '../../infra/database/schema/index.js';
import { CitiesService } from '../cities/cities.service.js';
import { EventSearchService } from '../events/event-search.service.js';
import { EventStore } from '../events/event-store.service.js';
import { EventsService } from '../events/events.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RemindersService } from '../reminders/reminders.service.js';
import {
  canSnoozeGotHome,
  type GotHomeRow,
  gotHomeDue,
  gotHomeLogKind,
  gotHomePushDue,
  wantsGotHomeAsk,
} from './got-home.policy.js';

const G = LIMITS.safety.gotHome;
/** Rows only need to outlive the plans they are about. */
const RETENTION_MS = 90 * 24 * 3_600_000;

function denied(reason: string, message: string): AppError {
  return new AppError('NOT_ELIGIBLE', message, { reason });
}

/**
 * "Got home safe?" (D-212). After a late plan (or one the member marked) everyone who checked in is asked, by
 * push and in the app, whether they got home; "I got home" is recorded so the question stops, and the app opens
 * a text to their trusted contacts from their own phone (there is no SMS provider, D-166). "Not yet" asks again
 * a little later, a few times at most. Members can switch the late-plan ask off in the Safety centre.
 */
@Injectable()
export class GotHomeService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: EventsService,
    private readonly search: EventSearchService,
    private readonly store: EventStore,
    private readonly cities: CitiesService,
    private readonly reminders: RemindersService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- settings ----------

  async settings(userId: string): Promise<SafetySettings> {
    const [row] = await this.db
      .select({ gotHomeCheck: safetySettings.gotHomeCheck })
      .from(safetySettings)
      .where(eq(safetySettings.userId, userId));
    return { gotHomeCheck: row?.gotHomeCheck ?? true };
  }

  async updateSettings(userId: string, body: UpdateSafetySettingsBody): Promise<SafetySettings> {
    const next = { ...(await this.settings(userId)), ...body };
    await this.db
      .insert(safetySettings)
      .values({ userId, gotHomeCheck: next.gotHomeCheck })
      .onConflictDoUpdate({
        target: safetySettings.userId,
        set: { gotHomeCheck: next.gotHomeCheck, updatedAt: sql`now()` },
      });
    return next;
  }

  /** Members (of these) who switched the late-plan ask off. */
  private async optedOut(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.db
      .select({ userId: safetySettings.userId })
      .from(safetySettings)
      .where(and(inArray(safetySettings.userId, userIds), eq(safetySettings.gotHomeCheck, false)));
    return new Set(rows.map((r) => r.userId));
  }

  // ---------- one member, one plan ----------

  private async row(userId: string, eventId: string): Promise<GotHomeRow | null> {
    const [row] = await this.db
      .select()
      .from(gotHomeChecks)
      .where(and(eq(gotHomeChecks.userId, userId), eq(gotHomeChecks.eventId, eventId)));
    return row ?? null;
  }

  private async upsert(
    userId: string,
    eventId: string,
    set: Partial<
      Pick<typeof gotHomeChecks.$inferInsert, 'requestedAt' | 'snoozes' | 'askAfter' | 'homeAt'>
    >,
  ): Promise<void> {
    await this.db
      .insert(gotHomeChecks)
      .values({ userId, eventId, ...set })
      .onConflictDoUpdate({
        target: [gotHomeChecks.userId, gotHomeChecks.eventId],
        set: { ...set, updatedAt: sql`now()` },
      });
  }

  /** The plan as this member may see it (mystery-safe: only its title and times are used). */
  private async facts(userId: string, eventId: string, now: Date) {
    const e = await this.events.detailFor(userId, eventId);
    const [settings, row] = await Promise.all([this.settings(userId), this.row(userId, eventId)]);
    const endsAt = new Date(e.endsAt);
    return {
      event: e,
      facts: {
        endsAt,
        timezone: e.timezone,
        checkedIn: e.viewer.rsvp === 'checked_in',
        settingOn: settings.gotHomeCheck,
        row,
        now,
      },
    };
  }

  async status(userId: string, eventId: string, now: Date = new Date()): Promise<GotHomeStatus> {
    const { event, facts } = await this.facts(userId, eventId, now);
    const seated = facts.checkedIn || event.viewer.rsvp === 'going';
    const due = gotHomeDue(facts);
    const askAfter = facts.row?.askAfter ?? null;
    return {
      eventId,
      title: event.title,
      endsAt: event.endsAt,
      timezone: event.timezone,
      late: isLatePlan(facts.endsAt, facts.timezone),
      requested: Boolean(facts.row?.requestedAt),
      willAsk:
        seated &&
        !facts.row?.homeAt &&
        now.getTime() < facts.endsAt.getTime() + G.windowMs &&
        wantsGotHomeAsk(facts),
      due,
      homeAt: facts.row?.homeAt?.toISOString() ?? null,
      snoozes: facts.row?.snoozes ?? 0,
      canSnooze: canSnoozeGotHome(facts),
      askAgainAt: askAfter && askAfter.getTime() > now.getTime() ? askAfter.toISOString() : null,
    };
  }

  /** "Ask me if I got home after this plan": for plans they are going to, until the asking is over. */
  async request(
    userId: string,
    eventId: string,
    ask: boolean,
    now: Date = new Date(),
  ): Promise<GotHomeStatus> {
    const { event, facts } = await this.facts(userId, eventId, now);
    if (!facts.checkedIn && event.viewer.rsvp !== 'going')
      throw denied('NOT_GOING', 'Only plans you are going to');
    if (now.getTime() >= facts.endsAt.getTime() + G.windowMs)
      throw denied('TOO_LATE', 'This plan is long over');
    await this.upsert(userId, eventId, { requestedAt: ask ? now : null });
    return this.status(userId, eventId, now);
  }

  /** "I got home": recorded once (the first time counts), and nothing is asked again for this plan. */
  async markHome(userId: string, eventId: string, now: Date = new Date()): Promise<GotHomeStatus> {
    const { facts } = await this.facts(userId, eventId, now);
    if (!facts.checkedIn) throw denied('NOT_CHECKED_IN', 'Only plans you checked in to');
    if (now.getTime() < facts.endsAt.getTime()) throw denied('NOT_ENDED', 'The plan has not ended');
    if (!facts.row?.homeAt) await this.upsert(userId, eventId, { homeAt: now, askAfter: null });
    return this.status(userId, eventId, now);
  }

  /** "Not yet": ask again in a while, a few times at most. */
  async snooze(userId: string, eventId: string, now: Date = new Date()): Promise<GotHomeStatus> {
    const { facts } = await this.facts(userId, eventId, now);
    if (!gotHomeDue(facts)) throw denied('NOT_DUE', 'Nothing to answer right now');
    if (!canSnoozeGotHome(facts)) throw denied('SNOOZE_LIMIT', 'No more snoozes for this plan');
    await this.upsert(userId, eventId, {
      snoozes: (facts.row?.snoozes ?? 0) + 1,
      askAfter: new Date(now.getTime() + G.snoozeMs),
    });
    return this.status(userId, eventId, now);
  }

  // ---------- worker ----------

  /**
   * Every 5 minutes: "Got home safe?" to members who checked in to a plan that ended at least a short while ago,
   * when it was late (and their setting is on) or they asked for it. `reminder_log` keeps each ask (the first,
   * then one per snooze) to once. The push names the plan only, never its spot.
   */
  async askDue(now: Date = new Date()): Promise<number> {
    const ids = await this.search.endedBetween(
      new Date(now.getTime() - G.windowMs),
      new Date(now.getTime() - G.delayMs),
    );
    const cores = (await this.store.coresByIds(ids)).filter((c) => !c.held);
    if (cores.length === 0) return 0;
    const zones = await this.cities.timezones([...new Set(cores.map((c) => c.cityId))]);
    let sent = 0;
    for (const core of cores) {
      const checkedIn = (await this.search.seatOutcomes(core.id))
        .filter((o) => o.checkedIn)
        .map((o) => o.userId);
      if (checkedIn.length === 0) continue;
      const [off, rows] = await Promise.all([
        this.optedOut(checkedIn),
        this.rowsFor(core.id, checkedIn),
      ]);
      const timezone = zones.get(core.cityId) ?? LOCALE_DEFAULTS.timezone;
      const byKind = new Map<string, string[]>();
      for (const userId of checkedIn) {
        const row = rows.get(userId) ?? null;
        const due = gotHomePushDue({
          endsAt: core.endsAt,
          timezone,
          checkedIn: true,
          settingOn: !off.has(userId),
          row,
          now,
        });
        if (!due) continue;
        const kind = gotHomeLogKind(row?.snoozes ?? 0);
        byKind.set(kind, [...(byKind.get(kind) ?? []), userId]);
      }
      for (const [kind, userIds] of byKind) {
        const to = await this.reminders.claim(userIds, core.id, kind, now);
        if (to.length === 0) continue;
        await this.notifications.notify(
          to,
          'got_home_ask',
          { title: core.title, eventId: core.id },
          { collapseKey: `got-home-${core.id}`, now },
        );
        sent += to.length;
      }
    }
    return sent;
  }

  private async rowsFor(eventId: string, userIds: string[]): Promise<Map<string, GotHomeRow>> {
    const rows = await this.db
      .select()
      .from(gotHomeChecks)
      .where(and(eq(gotHomeChecks.eventId, eventId), inArray(gotHomeChecks.userId, userIds)));
    return new Map(rows.map((r) => [r.userId, r]));
  }

  /** Daily: rows about plans long gone. */
  async prune(now: Date = new Date()): Promise<number> {
    const rows = await this.db
      .delete(gotHomeChecks)
      .where(lt(gotHomeChecks.updatedAt, new Date(now.getTime() - RETENTION_MS)))
      .returning({ userId: gotHomeChecks.userId });
    return rows.length;
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const [settings, checks] = await Promise.all([
      this.settings(userId),
      this.db
        .select({
          eventId: gotHomeChecks.eventId,
          requestedAt: gotHomeChecks.requestedAt,
          snoozes: gotHomeChecks.snoozes,
          homeAt: gotHomeChecks.homeAt,
        })
        .from(gotHomeChecks)
        .where(eq(gotHomeChecks.userId, userId)),
    ]);
    return { safetySettings: settings, gotHomeChecks: checks };
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(gotHomeChecks).where(eq(gotHomeChecks.userId, userId));
    await tx.delete(safetySettings).where(eq(safetySettings.userId, userId));
  }
}
