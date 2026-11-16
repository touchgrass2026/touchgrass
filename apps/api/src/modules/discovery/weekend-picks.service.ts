import { Injectable } from '@nestjs/common';
import { LIMITS, LOCALE_DEFAULTS, type WeekendPicks } from '@touchgrass/shared';
import { CitiesService } from '../cities/cities.service.js';
import { EventAccessService } from '../events/event-access.service.js';
import { canViewEvent } from '../events/event.policy.js';
import { EventSearchService } from '../events/event-search.service.js';
import { type EventCore, EventStore } from '../events/event-store.service.js';
import { EventViewService } from '../events/event-view.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import {
  isWeekendPick,
  rankWeekendPicks,
  type WeekendCandidate,
  weekendWindow,
} from './weekend.js';

const W = LIMITS.weekendDigest;
const FOF_LIMIT = 500;

export interface WeekendPickResult {
  picks: EventCore[];
  from: Date;
  to: Date;
  timezone: string;
}

/**
 * "This weekend" picks (D-211): plans from Friday evening to Sunday in the member's city that they can see and
 * pull up to right now, ranked by their interests and closeness to their area. Full, cancelled, held, mystery and
 * gender-restricted plans, plans they host and plans they're already in are left out. Candidates come from
 * `EventSearchService` (public centres only) and every one is re-checked with the events policies.
 */
@Injectable()
export class WeekendPicksService {
  constructor(
    private readonly search: EventSearchService,
    private readonly store: EventStore,
    private readonly access: EventAccessService,
    private readonly view: EventViewService,
    private readonly graph: SocialGraphService,
    private readonly profiles: ProfilesService,
    private readonly cities: CitiesService,
  ) {}

  private async zoneOf(cityId: string | null): Promise<string> {
    if (!cityId) return LOCALE_DEFAULTS.timezone;
    return (await this.cities.timezones([cityId])).get(cityId) ?? LOCALE_DEFAULTS.timezone;
  }

  async picks(
    userId: string,
    now: Date = new Date(),
    limit: number = W.picks,
  ): Promise<WeekendPickResult> {
    const profile = await this.profiles.get(userId);
    const cityId = profile?.cityId ?? null;
    const timezone = await this.zoneOf(cityId);
    const { from, to } = weekendWindow(now, timezone);
    const empty = { picks: [], from, to, timezone };
    if (!cityId || from.getTime() >= to.getTime()) return empty;
    const hood = profile?.neighbourhoodId
      ? await this.cities.centroid(profile.neighbourhoodId)
      : null;
    const center = hood ?? (await this.cities.centre(cityId));
    if (!center) return empty;

    const [ctx, fof] = await Promise.all([
      this.access.context(userId),
      this.graph.friendsOfFriends(userId, FOF_LIMIT),
    ]);
    const rows = await this.search.candidates(
      {
        userId,
        squadIds: [...ctx.squad],
        reachableIds: [...ctx.squad, ...fof.map((f) => f.id)],
        verifiedWoman: ctx.verified && ctx.gender === 'woman',
        verifiedMan: ctx.verified && ctx.gender === 'man',
      },
      { kind: 'radius', center, meters: W.radiusKm * 1000 },
      { from, to },
      'soonest',
      LIMITS.discovery.candidatePool,
    );
    const ids = rows.map((r) => r.id);
    const [coreList, facts, counts, taxonomy, mine] = await Promise.all([
      this.store.coresByIds(ids),
      this.access.factsFor(ctx, ids),
      this.store.seatCountsMany(ids),
      this.search.taxonomyMany(ids),
      this.profiles.interestIdsOf(userId),
    ]);
    const cores = new Map(coreList.map((c) => [c.id, c]));
    const interests = new Set(mine);
    const candidates: WeekendCandidate[] = rows.flatMap((r) => {
      const core = cores.get(r.id);
      const f = facts.get(r.id);
      if (!core || !f) return [];
      const seats = counts.get(r.id)?.seats ?? 0;
      if (!isWeekendPick(core, f, seats, { from, to }, now)) return [];
      const tax = taxonomy.get(r.id) ?? { interestIds: [], vibeTagIds: [] };
      const planInterests = new Set([
        ...(core.categoryInterestId ? [core.categoryInterestId] : []),
        ...tax.interestIds,
      ]);
      return [
        {
          id: r.id,
          interestMatches: [...planInterests].filter((i) => interests.has(i)).length,
          distanceMeters: hood ? r.distanceMeters : null,
          startsAt: core.startsAt,
        },
      ];
    });
    const ranked = rankWeekendPicks(candidates, limit);
    return {
      picks: ranked.flatMap((c) => {
        const core = cores.get(c.id);
        return core ? [core] : [];
      }),
      from,
      to,
      timezone,
    };
  }

  /**
   * The digest screen: the plans a push named (`ids`, still visible to the viewer), else fresh picks. Always
   * serialized through `EventViewService`, so the screen shows exactly what the viewer may see.
   */
  async forViewer(userId: string, ids?: string[], now: Date = new Date()): Promise<WeekendPicks> {
    let cores: EventCore[];
    let window: { from: Date; to: Date; timezone: string };
    if (ids && ids.length > 0) {
      const profile = await this.profiles.get(userId);
      const timezone = await this.zoneOf(profile?.cityId ?? null);
      window = { ...weekendWindow(now, timezone), timezone };
      const byId = new Map((await this.store.coresByIds(ids)).map((c) => [c.id, c]));
      cores = ids.flatMap((id) => {
        const c = byId.get(id);
        return c ? [c] : [];
      });
    } else {
      const r = await this.picks(userId, now);
      cores = r.picks;
      window = { from: r.from, to: r.to, timezone: r.timezone };
    }
    const ctx = await this.access.context(userId);
    const facts = await this.access.factsFor(
      ctx,
      cores.map((c) => c.id),
    );
    const visible = cores.filter((c) => {
      const f = facts.get(c.id);
      return f !== undefined && c.status === 'published' && canViewEvent(f, c);
    });
    const items = await this.view.summaries(ctx, visible, facts, now);
    return {
      items,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      timezone: window.timezone,
    };
  }
}
