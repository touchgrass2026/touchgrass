import type { FeedItem } from '@touchgrass/shared';
import { buildSections, planTags, QUIET_BELOW } from './sections';

const now = new Date('2026-11-04T06:00:00.000Z'); // Wednesday 11:30 IST
const plan = (n: number, over: Partial<FeedItem> = {}): FeedItem =>
  ({
    id: `0192f3a4-5b6c-7d8e-9f01-${String(n).padStart(12, '0')}`,
    startsAt: '2026-11-10T12:00:00.000Z',
    timezone: 'Asia/Kolkata',
    reasons: [],
    via: null,
    soloFriendly: false,
    smallGroup: false,
    mystery: false,
    pricePaise: 50000,
    distanceMeters: 20000,
    ...over,
  }) as FeedItem;
const ids = (items: FeedItem[]): string[] => items.map((i) => i.id.slice(-2));
/** Every plan id shown anywhere on Explore, in order. */
const shown = (s: ReturnType<typeof buildSections>): string[] => [
  ...s.hero.map((i) => i.id),
  ...s.rails.flatMap((r) => r.items.map((i) => i.id)),
  ...s.rest.map((i) => i.id),
];

describe('Explore sections (D-220)', () => {
  it('with few plans, is one plain list: no carousel, no rows, nothing twice', () => {
    // The tester's case: two plans that are squad, solo and free all at once used to fill three rows.
    const items = [
      plan(1, { reasons: ['squad_going'], soloFriendly: true, pricePaise: 0 }),
      plan(2, { reasons: ['squad_going'], soloFriendly: true, pricePaise: 0 }),
    ];
    const s = buildSections(items, now);
    expect(s).toEqual({ quiet: true, hero: [], rails: [], rest: items });
    // Six plans or fewer: one list. More than six: the carousel and rows come back.
    const six = Array.from({ length: 6 }, (_, n) => plan(n + 1));
    expect(QUIET_BELOW).toBe(7);
    expect(buildSections(six, now).quiet).toBe(true);
    const seven = [...six, plan(7)];
    const full = buildSections(seven, now);
    expect(full.quiet).toBe(false);
    expect(full.hero).toHaveLength(5);
  });

  it('never shows a plan twice, and shows every plan once', () => {
    // Twenty plans that each fit several themes.
    const items = Array.from({ length: 20 }, (_, n) =>
      plan(n + 1, {
        reasons: n % 2 === 0 ? ['squad_going', 'interests'] : ['nearby'],
        soloFriendly: true,
        pricePaise: 0,
        smallGroup: n % 3 === 0,
        distanceMeters: 500,
      }),
    );
    const s = buildSections(items, now);
    const all = shown(s);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(items.map((i) => i.id).sort());
  });

  it('puts featured plans first in the carousel (up to five) and keeps them out of the rows', () => {
    const items = Array.from({ length: 10 }, (_, n) =>
      plan(n + 1, n === 3 ? { reasons: ['featured'] } : { reasons: ['squad_going'] }),
    );
    const s = buildSections(items, now);
    expect(ids(s.hero)).toEqual(['04', '01', '02', '03', '05']);
    expect(ids(s.rails.flatMap((r) => r.items))).not.toContain('04');
  });

  it('a plan goes to the first row it fits; a row needs three plans of its own', () => {
    const items = [
      // Five for the carousel.
      ...[1, 2, 3, 4, 5].map((n) => plan(n, { reasons: ['popular'] })),
      // Squad plans that are also tonight and free: they belong to the squad row only.
      plan(6, { reasons: ['squad_going'], startsAt: '2026-11-04T14:00:00.000Z', pricePaise: 0 }),
      plan(7, { via: {} as FeedItem['via'], startsAt: '2026-11-04T15:00:00.000Z', pricePaise: 0 }),
      plan(8, { reasons: ['squad_going'], pricePaise: 0 }),
      // Two tonight plans only: not enough for a row, so they fall through to "free".
      plan(9, { startsAt: '2026-11-04T17:00:00.000Z', pricePaise: 0 }), // 22:30 IST today
      plan(10, { startsAt: '2026-11-04T16:00:00.000Z', pricePaise: 0 }),
      plan(11, { pricePaise: 0 }),
      // Past midnight IST is not tonight, and fits nothing else: "More plans".
      plan(12, { startsAt: '2026-11-04T19:00:00.000Z' }),
    ];
    const s = buildSections(items, now);
    expect(s.quiet).toBe(false);
    expect(s.rails.map((r) => [r.key, ids(r.items)])).toEqual([
      ['squad', ['06', '07', '08']],
      ['free', ['09', '10', '11']],
    ]);
    expect(ids(s.rest)).toEqual(['12']);
  });

  it('shows at most five themed rows', () => {
    const themed: Partial<FeedItem>[] = [
      { reasons: ['squad_going'] },
      { reasons: ['nearby'] },
      { reasons: ['interests'] },
      { soloFriendly: true },
      { smallGroup: true },
      { pricePaise: 0 },
      { mystery: true },
    ];
    const items = [
      ...[1, 2, 3, 4, 5].map((n) => plan(n)),
      ...themed.flatMap((over, t) => [0, 1, 2].map((k) => plan(10 + t * 3 + k, over))),
    ];
    expect(buildSections(items, now).rails).toHaveLength(5);
  });

  it('tags say what else makes a plan special, besides its own row', () => {
    const p = plan(1, {
      reasons: ['squad_going'],
      soloFriendly: true,
      pricePaise: 0,
      startsAt: '2026-11-04T14:00:00.000Z',
    });
    expect(planTags(p, 'squad', now)).toEqual(['tonight', 'solo']);
    expect(planTags(p, null, now)).toEqual(['squad', 'tonight']);
    expect(planTags(plan(2), null, now)).toEqual([]);
  });
});
