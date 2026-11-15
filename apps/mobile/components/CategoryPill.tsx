import type { Interest } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { localized } from '../src/features/catalog/api';
import { categoryLook } from './category';
import { Pill } from './ui';

/**
 * A plan's category as a tag (D-204): its glyph and name on a tint of its hue. Informational, never an action,
 * so it never takes the lime; the name and glyph carry the meaning, the colour only helps you scan.
 */
export function CategoryPill({
  category,
  testID,
}: {
  category: Pick<Interest, 'slug' | 'category' | 'name'> | null | undefined;
  testID?: string;
}) {
  const { i18n } = useTranslation();
  if (!category) return null;
  const look = categoryLook(category);
  return (
    <Pill
      label={localized(category.name, i18n.language)}
      hue={look.hue}
      icon={look.glyph}
      testID={testID}
    />
  );
}
