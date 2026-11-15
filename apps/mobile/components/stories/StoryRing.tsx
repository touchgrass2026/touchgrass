import { categoryHues, type MediaVariants } from '@touchgrass/shared';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../src/theme/theme';
import { Avatar } from '../Avatar';

/** Unseen stories: a vivid sweep through three category hues (D-207), the way Instagram marks something new. */
export const STORY_RING_COLORS = [
  categoryHues.amber.solid,
  categoryHues.coral.solid,
  categoryHues.violet.solid,
] as const;

const RING = 2.5;
const GAP = 2.5;

export type StoryRingKind = 'unseen' | 'seen' | 'none';

/**
 * A face with a story ring (D-207): a gradient ring for something new, a thin muted ring once seen, or none.
 * `ringColor` swaps the gradient for a single colour (e.g. amber for "I'm free"). A gap in the background
 * colour separates the ring from the photo. `badge` sits at the bottom-right, outlined in the background
 * colour. Decorative: the control around it carries the label.
 */
export function StoryRing({
  photo,
  name,
  size,
  kind,
  ringColor,
  badge,
  testID,
}: {
  photo: MediaVariants | null;
  name: string;
  /** The avatar's own size; the ring adds to it. */
  size: number;
  kind: StoryRingKind;
  ringColor?: string;
  badge?: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const outer = size + 2 * (RING + GAP);
  const inner = (
    <View
      style={[
        styles.center,
        {
          width: size + 2 * GAP,
          height: size + 2 * GAP,
          borderRadius: (size + 2 * GAP) / 2,
          backgroundColor: theme.colors.background,
        },
      ]}
    >
      <Avatar photo={photo} name={name} size={size} />
    </View>
  );
  const round = { width: outer, height: outer, borderRadius: outer / 2 };
  let ring: ReactNode;
  if (kind === 'unseen' && !ringColor)
    ring = (
      <LinearGradient
        colors={STORY_RING_COLORS}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={[styles.center, round]}
        testID={testID ? `${testID}-unseen` : 'ring-unseen'}
      >
        {inner}
      </LinearGradient>
    );
  else if (kind === 'none')
    ring = (
      <View style={[styles.center, round]} testID={testID ? `${testID}-none` : 'ring-none'}>
        {inner}
      </View>
    );
  else
    ring = (
      <View
        style={[
          styles.center,
          round,
          kind === 'seen' && !ringColor
            ? { borderWidth: 1.5, borderColor: theme.colors.border }
            : { backgroundColor: ringColor ?? theme.colors.border },
        ]}
        testID={testID ? `${testID}-${kind}` : `ring-${kind}`}
      >
        {inner}
      </View>
    );
  return (
    <View style={{ width: outer, height: outer }} importantForAccessibility="no-hide-descendants">
      {ring}
      {badge ? <View style={styles.badge}>{badge}</View> : null}
    </View>
  );
}

/** The small round badge on a story face: filled, outlined in the background colour. */
export function RingBadge({
  color,
  children,
  testID,
}: {
  color: string;
  children: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={[styles.badgeDot, { backgroundColor: color, borderColor: theme.colors.background }]}
      testID={testID}
    >
      {children}
    </View>
  );
}

export const BADGE_SIZE = 22;

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: 0, bottom: 0 },
  badgeDot: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
