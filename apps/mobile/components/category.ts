import {
  type CategoryHue,
  type CategoryKind,
  type CategoryLike,
  categoryHue,
  categoryKind,
} from '@touchgrass/shared';
import {
  Book,
  Bowl,
  Compass,
  Dice,
  type GlyphIcon,
  Leaf,
  Music,
  TreePine,
  Waves,
  Zap,
} from './icons';

/** One glyph per kind of plan (D-204), so a category's hue is never the only thing that tells it apart. */
export const CATEGORY_GLYPHS: Record<CategoryKind, GlyphIcon> = {
  food: Bowl,
  games: Dice,
  learning: Book,
  water: Waves,
  outdoors: TreePine,
  wellness: Leaf,
  sport: Zap,
  creative: Music,
  other: Compass,
};

export interface CategoryLook {
  kind: CategoryKind;
  hue: CategoryHue;
  glyph: GlyphIcon;
}

/** Kind, hue and glyph for a category (an interest, or its slug or name). */
export function categoryLook(input: CategoryLike | string | null | undefined): CategoryLook {
  const kind = categoryKind(input);
  return { kind, hue: categoryHue(input), glyph: CATEGORY_GLYPHS[kind] };
}
