import { type CategoryHue, type CategoryHueName, categoryHues } from './tokens';

/**
 * Kinds of plans for colour and icon (D-204). Interests arrive as a slug plus a taxonomy group
 * (`food`, `active`, `culture`, ...), and admins can add new ones, so the kind is read from keywords in
 * the slug, the group and the English name, in a fixed order; anything unknown is `other`.
 */
export const CATEGORY_KINDS = [
  'food',
  'games',
  'learning',
  'water',
  'outdoors',
  'wellness',
  'sport',
  'creative',
  'other',
] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** Checked in order: the first group whose pattern matches wins. */
const KEYWORDS: readonly [Exclude<CategoryKind, 'other'>, RegExp][] = [
  ['food', /food|chai|biryani|caf|coffee|cook|brunch|dessert|bak|restaurant|street|dinner/],
  ['games', /game|quiz|board|poker|chess|puzzle|trivia/],
  ['learning', /book|read|writ|study|learn|language|tech|startup|talk|workshop|science/],
  ['water', /swim|water|lake|beach|kayak|river|pool/],
  ['outdoors', /trek|hik|outdoor|nature|bird|garden|camp|plant|walk|sunrise|sunset|picnic|park/],
  ['wellness', /wellness|mind|spiritual|sustain|yoga|meditat|breath/],
  ['sport', /run|cycl|sport|fit|gym|cricket|football|badminton|boulder|climb|active|tennis/],
  [
    'creative',
    /\bart|music|jam|photo|pottery|theatre|theater|movie|film|standup|comedy|dance|culture|creative|paint|craft|poetry/,
  ],
];

/** One hue per kind; `slate` is the neutral one. */
export const CATEGORY_KIND_HUE: Record<CategoryKind, CategoryHueName> = {
  food: 'coral',
  games: 'violet',
  learning: 'sky',
  water: 'teal',
  outdoors: 'green',
  wellness: 'teal',
  sport: 'amber',
  creative: 'rose',
  other: 'slate',
};

export interface CategoryLike {
  slug?: string | null;
  /** The taxonomy group, e.g. `food` or `active`. */
  category?: string | null;
  name?: { en?: string } | null;
}

/** The kind of a category (an interest, or just its slug or name). */
export function categoryKind(input: CategoryLike | string | null | undefined): CategoryKind {
  if (!input) return 'other';
  const text = (
    typeof input === 'string'
      ? input
      : [input.slug, input.category, input.name?.en].filter(Boolean).join(' ')
  ).toLowerCase();
  if (!text) return 'other';
  for (const [kind, pattern] of KEYWORDS) if (pattern.test(text)) return kind;
  return 'other';
}

/** The hue for a category; the neutral `slate` when there is none. */
export function categoryHue(input: CategoryLike | string | null | undefined): CategoryHue {
  return categoryHues[CATEGORY_KIND_HUE[categoryKind(input)]];
}
