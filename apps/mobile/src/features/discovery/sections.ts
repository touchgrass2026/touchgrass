import { type FeedItem, zonedParts } from '@touchgrass/shared';

export type RailKey =
  | 'squad'
  | 'tonight'
  | 'weekend'
  | 'solo'
  | 'near'
  | 'fof'
  | 'small'
  | 'free'
  | 'mystery'
  | 'popular'
  | 'forYou';

export interface FeedSections {
  /** Few plans (D-220): one plain list, no themed rows, so nothing repeats. */
  quiet: boolean;
  /** Big swipeable cards at the top: featured plans first, then the best-ranked ones. */
  hero: FeedItem[];
  /** Sideways rows by theme. Each plan sits in one row at most, the most meaningful one it fits. */
  rails: { key: RailKey; items: FeedItem[] }[];
  /** Everything not shown above, as a vertical list ("More plans", or "Plans near you" when quiet). */
  rest: FeedItem[];
}

const HERO_MAX = 5;
const RAIL_MAX = 12;
/** The carousel needs a few plans to feel like one. */
const HERO_MIN_ITEMS = 5;
/** With more than six plans Explore shows the carousel and rows; six or fewer is one plain list (D-220). */
export const QUIET_BELOW = 7;
/** A themed row needs at least this many plans of its own. */
const RAIL_MIN = 3;
/** At most this many themed rows. */
const RAILS_MAX = 5;
/** "Near you" means within this distance of the plan's public centre. */
const NEAR_METERS = 3000;

const sameDay = (a: Date, b: Date, tz: string): boolean => {
  const x = zonedParts(a, tz);
  const y = zonedParts(b, tz);
  return x.year === y.year && x.month === y.month && x.day === y.day;
};

/** The themes, most meaningful first: a plan goes to the first row it fits (D-220). */
function themes(now: Date): { key: RailKey; test: (i: FeedItem) => boolean }[] {
  const weekendDays = (i: FeedItem): boolean => {
    const start = new Date(i.startsAt);
    const ahead = start.getTime() - now.getTime();
    const day = zonedParts(start, i.timezone).weekday;
    return ahead > 0 && ahead < 7 * 86_400_000 && (day === 6 || day === 7);
  };
  return [
    { key: 'squad', test: (i) => i.reasons.includes('squad_going') || i.via !== null },
    { key: 'tonight', test: (i) => sameDay(new Date(i.startsAt), now, i.timezone) },
    { key: 'weekend', test: weekendDays },
    { key: 'near', test: (i) => i.reasons.includes('nearby') || i.distanceMeters <= NEAR_METERS },
    { key: 'forYou', test: (i) => i.reasons.includes('interests') || i.reasons.includes('vibes') },
    { key: 'solo', test: (i) => i.soloFriendly },
    { key: 'small', test: (i) => i.smallGroup },
    { key: 'free', test: (i) => i.pricePaise === 0 },
    { key: 'fof', test: (i) => i.reasons.includes('friends_of_friends') },
    { key: 'mystery', test: (i) => i.mystery },
    {
      key: 'popular',
      test: (i) => i.reasons.includes('popular') || i.reasons.includes('top_host'),
    },
  ];
}

/** Short tags for what else makes a plan special, besides the row it sits in (D-220). */
export const TAG_KEYS = ['squad', 'tonight', 'solo', 'free'] as const;
export type PlanTag = (typeof TAG_KEYS)[number];
export function planTags(
  item: FeedItem,
  except: RailKey | null,
  now: Date = new Date(),
): PlanTag[] {
  const tests = new Map(themes(now).map((t) => [t.key, t.test]));
  return TAG_KEYS.filter((k) => k !== except && (tests.get(k)?.(item) ?? false)).slice(0, 2);
}

/**
 * Explore's layout (D-155, D-160, D-220), from the ranked feed the viewer already has (no extra request,
 * same privacy). No plan appears twice: the carousel takes the top plans, then each themed row takes the
 * plans it fits that nothing above took, a row only shows with three plans of its own (its plans go on
 * down the list otherwise), and whatever is left is listed under "More plans". With six plans or fewer
 * there are no rows at all, just one list. Dates are judged in each plan's own city time zone.
 */
export function buildSections(items: FeedItem[], now: Date = new Date()): FeedSections {
  if (items.length < QUIET_BELOW) return { quiet: true, hero: [], rails: [], rest: items };
  const used = new Set<string>();
  const featured = items.filter((i) => i.reasons.includes('featured'));
  const hero =
    items.length < HERO_MIN_ITEMS
      ? []
      : [...featured, ...items.filter((i) => !featured.includes(i))].slice(0, HERO_MAX);
  for (const i of hero) used.add(i.id);
  const rails: FeedSections['rails'] = [];
  for (const theme of themes(now)) {
    if (rails.length >= RAILS_MAX) break;
    const fits = items.filter((i) => !used.has(i.id) && theme.test(i)).slice(0, RAIL_MAX);
    if (fits.length < RAIL_MIN) continue;
    for (const i of fits) used.add(i.id);
    rails.push({ key: theme.key, items: fits });
  }
  return { quiet: false, hero, rails, rest: items.filter((i) => !used.has(i.id)) };
}
