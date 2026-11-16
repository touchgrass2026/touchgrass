import { Injectable, Logger } from '@nestjs/common';
import { isoWeekKey, LIMITS } from '@touchgrass/shared';
import { SettingsService } from '../account/settings.service.js';
import { CitiesService } from '../cities/cities.service.js';
import { WeekendPicksService } from '../discovery/weekend-picks.service.js';
import { weekendDigestDue, weekRefId } from '../discovery/weekend.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { UsersService } from '../users/users.service.js';
import { picksLabel } from './reminder-copy.js';
import { RemindersService } from './reminders.service.js';

const W = LIMITS.weekendDigest;
const KIND = 'weekend_digest';
/** Members whose picks are worked out at the same time within a page. */
const PARALLEL = 8;

/**
 * "This weekend: 3 picks for you" (D-211). A frequent job; each city is due on Thursday evening in its own zone.
 * Members are paged by id, and each is claimed once per ISO week in `reminder_log` before anything is computed, so
 * re-runs inside the window (or on another replica) skip them. Members who switched the digest off are not
 * claimed; members with no picks are claimed and hear nothing. Quiet hours apply through `notify`.
 */
@Injectable()
export class WeekendDigestService {
  private readonly logger = new Logger(WeekendDigestService.name);

  constructor(
    private readonly reminders: RemindersService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly cities: CitiesService,
    private readonly picks: WeekendPicksService,
  ) {}

  async sendDue(now: Date = new Date()): Promise<number> {
    const due = (await this.cities.list()).filter(
      (c) => c.launchStatus !== 'waitlist' && weekendDigestDue(now, c.timezone),
    );
    let sent = 0;
    for (const city of due) sent += await this.sendCity(city.id, city.timezone, now);
    return sent;
  }

  async sendCity(cityId: string, timezone: string, now: Date = new Date()): Promise<number> {
    const ref = weekRefId(isoWeekKey(now, timezone));
    let after: string | null = null;
    let sent = 0;
    for (;;) {
      const page = await this.users.activeInCity(cityId, after, W.memberPage);
      if (page.length === 0) break;
      after = page[page.length - 1] ?? null;
      const prefs = await this.settings.channelPrefs(page, 'weekend_digest');
      const wanted = page.filter((id) => {
        const p = prefs.get(id);
        return p === undefined || p.push || p.inApp;
      });
      const claimed = await this.reminders.claim(wanted, ref, KIND, now);
      for (let i = 0; i < claimed.length; i += PARALLEL) {
        const done = await Promise.all(
          claimed.slice(i, i + PARALLEL).map((id) => this.sendTo(id, now)),
        );
        sent += done.filter(Boolean).length;
      }
      if (page.length < W.memberPage) break;
    }
    return sent;
  }

  /** One member's digest; false when they have no picks (or it failed, which is logged, not retried). */
  async sendTo(userId: string, now: Date = new Date()): Promise<boolean> {
    try {
      const { picks } = await this.picks.picks(userId, now);
      if (picks.length === 0) return false;
      await this.notifications.notify(
        [userId],
        KIND,
        {
          picks: picksLabel(picks.length),
          titles: picks.map((p) => p.title).join(', '),
          ids: picks.map((p) => p.id).join(','),
        },
        { collapseKey: 'weekend-digest', now },
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Weekend digest failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
