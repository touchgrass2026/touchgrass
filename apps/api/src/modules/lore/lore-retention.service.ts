import { Inject, Injectable } from '@nestjs/common';
import { LIMITS } from '@touchgrass/shared';
import { and, asc, count, eq, gt, inArray, isNull } from 'drizzle-orm';
import { DB, type Database } from '../../infra/database/database.module.js';
import { loreAlbums, loreItems } from '../../infra/database/schema/index.js';
import { EventSearchService } from '../events/event-search.service.js';
import { EventStore } from '../events/event-store.service.js';
import { MediaService } from '../media/media.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RemindersService } from '../reminders/reminders.service.js';
import { closingReminderWindow, loreClosed } from './lore.policy.js';

/** Albums looked at per query while purging. */
const ALBUM_PAGE = 200;
export const LORE_CLOSING_KIND = 'lore_closing';

/**
 * Lore's 7-day window (D-218), worker side. A day before an album closes, everyone in the plan hears "Lore
 * closes tomorrow" (once each, through `reminder_log`; quiet hours and preferences apply in `notify`). Once
 * it has closed, its photos and their files are deleted, a bounded batch per run, so a backlog (every old album
 * on the first run after deploy) drains over a few runs without one long transaction.
 */
@Injectable()
export class LoreRetentionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly search: EventSearchService,
    private readonly store: EventStore,
    private readonly media: MediaService,
    private readonly reminders: RemindersService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Hourly: "Lore for <plan> closes tomorrow" for albums with photos that close within the next day. */
  async remindClosing(now: Date = new Date()): Promise<number> {
    const window = closingReminderWindow(now);
    const ids = await this.search.endedBetween(window.endedAfter, window.endedBefore);
    if (ids.length === 0) return 0;
    const withPhotos = await this.db
      .select({ eventId: loreItems.eventId, n: count() })
      .from(loreItems)
      .where(and(inArray(loreItems.eventId, ids), eq(loreItems.status, 'visible')))
      .groupBy(loreItems.eventId);
    const albums = new Set(withPhotos.filter((r) => r.n > 0).map((r) => r.eventId));
    if (albums.size === 0) return 0;
    const cores = (await this.store.coresByIds([...albums])).filter((c) => !c.held);
    const seats = await this.search.seatHoldersMany(cores.map((c) => c.id));
    let sent = 0;
    for (const core of cores) {
      const people = [
        ...new Set([
          ...(seats.get(core.id) ?? []),
          ...(await this.search.checkedInAndHosts(core.id)),
        ]),
      ];
      const to = await this.reminders.claim(people, core.id, LORE_CLOSING_KIND, now);
      if (to.length === 0) continue;
      await this.notifications.notify(
        to,
        'lore_closing',
        { title: core.title, eventId: core.id },
        { collapseKey: `lore-${core.id}`, now },
      );
      sent += to.length;
    }
    return sent;
  }

  /**
   * Hourly: deletes the photos (rows and files, through the media module) of albums that have closed, at most
   * `purgeBatch` photos per run. An album whose photos are all gone loses its cover and is marked purged.
   * Files go first: if the row delete fails, the next run finds the rows again.
   */
  async purgeClosed(
    now: Date = new Date(),
    budget: number = LIMITS.lore.purgeBatch,
  ): Promise<number> {
    let deleted = 0;
    let after: string | null = null;
    for (;;) {
      const albums: { eventId: string; coverMediaId: string | null }[] = await this.db
        .select({ eventId: loreAlbums.eventId, coverMediaId: loreAlbums.coverMediaId })
        .from(loreAlbums)
        .where(and(isNull(loreAlbums.purgedAt), after ? gt(loreAlbums.eventId, after) : undefined))
        .orderBy(asc(loreAlbums.eventId))
        .limit(ALBUM_PAGE);
      const last = albums[albums.length - 1];
      if (!last) return deleted;
      after = last.eventId;
      const cores = new Map(
        (await this.store.coresByIds(albums.map((a) => a.eventId))).map((c) => [c.id, c]),
      );
      for (const album of albums) {
        const core = cores.get(album.eventId);
        if (!core || !loreClosed(core.endsAt, now)) continue;
        const room = budget - deleted;
        const items = await this.db
          .select({ id: loreItems.id, mediaId: loreItems.mediaId })
          .from(loreItems)
          .where(eq(loreItems.eventId, album.eventId))
          .limit(room);
        if (items.length > 0) {
          await this.media.destroy(items.map((i) => i.mediaId));
          await this.db.delete(loreItems).where(
            inArray(
              loreItems.id,
              items.map((i) => i.id),
            ),
          );
          deleted += items.length;
        }
        if (items.length < room) {
          if (album.coverMediaId) await this.media.destroy([album.coverMediaId]);
          await this.db
            .update(loreAlbums)
            .set({ purgedAt: now, coverMediaId: null, coverSource: '' })
            .where(eq(loreAlbums.eventId, album.eventId));
        }
        if (deleted >= budget) return deleted;
      }
      if (albums.length < ALBUM_PAGE) return deleted;
    }
  }
}
