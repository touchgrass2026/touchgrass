import { categoryHues } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Star } from './icons';
import { Pill } from './ui';

/**
 * "Top host" (D-210): a small amber pill with a star, next to a host's name on plan cards, the plan screen
 * and profiles. Read as "Top host"; inside a card whose own label already says it, pass `decorative`.
 */
export function TopHostBadge({ decorative, testID }: { decorative?: boolean; testID?: string }) {
  const { t } = useTranslation();
  const label = t('events.topHost');
  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'text'}
      accessibilityLabel={decorative ? undefined : label}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={decorative}
      testID={testID}
    >
      <Pill label={label} icon={Star} hue={categoryHues.amber} />
    </View>
  );
}
