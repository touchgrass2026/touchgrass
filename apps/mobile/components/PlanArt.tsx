import type { CategoryLike } from '@touchgrass/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import { categoryLook } from './category';
import { Icon } from './ui';

/**
 * Artwork for a plan without a cover photo (D-198, D-204): one look everywhere (cards, rails, the plan screen),
 * a lit three-stop gradient in the category's hue, a soft pool of light (no line patterns) and a quiet icon that
 * fits the category. Plans of the same kind look alike, so the colour means something; plans without a category
 * get the neutral slate. The accent stays off it: the card's own action carries the accent.
 */
export function PlanArt({
  category,
  iconSize = 40,
}: {
  /** The plan's category (interest), or its slug or name. */
  category?: CategoryLike | string | null;
  iconSize?: number;
}) {
  const look = categoryLook(category);
  return (
    <LinearGradient
      colors={look.hue.art}
      locations={[0, 0.45, 1]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={[StyleSheet.absoluteFill, styles.center]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      testID={`plan-art-${look.kind}`}
    >
      <View style={styles.light} />
      <Icon
        icon={look.glyph}
        size={iconSize}
        color={look.hue.text}
        accent={look.hue.text}
        strokeWidth={1.4}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  light: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    left: -110,
    top: -170,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
});
