import { type CategoryLike, categoryHues } from '@touchgrass/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { type LatLng, Marker } from 'react-native-maps';
import { useTheme } from '../src/theme/theme';
import { categoryLook } from './category';
import { Lock } from './icons';
import { Icon, Text } from './ui';

const BADGE = 34;
const BADGE_SELECTED = 44;
const POINTER = 7;

/**
 * Custom markers drawn once and then frozen: react-native-maps re-snapshots a custom marker on every frame while
 * `tracksViewChanges` is on, so it stays on only long enough to draw (and redraw after a change), then goes off.
 */
function useTrackOnce(key: string): boolean {
  const [drawn, setDrawn] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDrawn(key);
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [key]);
  return drawn !== key;
}

/**
 * A plan's pin (D-204): a round badge in its category's hue holding the category glyph, with a small pointer to
 * the spot. Mystery plans get a neutral lock badge instead. Selected pins grow and take the lime ring, the only
 * lime on the map. Drawn as a plain view so it can be tested and reused outside the map.
 */
export function PlanPinBadge({
  category,
  mystery,
  selected = false,
}: {
  category?: CategoryLike | string | null;
  mystery: boolean;
  selected?: boolean;
}) {
  const theme = useTheme();
  const look = categoryLook(mystery ? null : category);
  const fill = mystery ? theme.colors.surfaceAlt : look.hue.solid;
  const ink = mystery ? theme.colors.text : look.hue.onSolid;
  const size = selected ? BADGE_SELECTED : BADGE;
  return (
    <View
      style={styles.pin}
      testID={mystery ? 'pin-badge-mystery' : `pin-badge-${look.kind}`}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          styles.badge,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: fill,
            borderColor: selected
              ? theme.colors.primary
              : mystery
                ? theme.colors.inputBorder
                : theme.colors.background,
            borderWidth: selected ? 3 : 2,
          },
        ]}
      >
        <Icon
          icon={mystery ? Lock : look.glyph}
          size={selected ? 22 : 18}
          color={ink}
          accent={ink}
          strokeWidth={2}
        />
      </View>
      <View style={[styles.pointer, { borderTopColor: selected ? theme.colors.primary : fill }]} />
    </View>
  );
}

/** A group of plans too close to pin apart: a neutral bubble with how many there are. */
export function ClusterBubble({ count }: { count: number }) {
  const theme = useTheme();
  const size = count >= 100 ? 48 : count >= 10 ? 42 : 36;
  return (
    <View
      style={[
        styles.cluster,
        {
          minWidth: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.inputBorder,
        },
      ]}
      testID="cluster-bubble"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Text variant="label" maxFontSizeMultiplier={1.3}>
        {count}
      </Text>
    </View>
  );
}

/** A plan pinned on a map with its category badge; the label is read by screen readers. */
export function PlanMarker({
  coordinate,
  category,
  mystery,
  selected = false,
  accessibilityLabel,
  title,
  description,
  onPress,
  onCalloutPress,
  testID,
}: {
  coordinate: LatLng;
  category?: CategoryLike | string | null;
  mystery: boolean;
  selected?: boolean;
  accessibilityLabel: string;
  title?: string;
  description?: string;
  onPress?: () => void;
  onCalloutPress?: () => void;
  testID?: string;
}) {
  const kind = categoryLook(mystery ? null : category).kind;
  const track = useTrackOnce(`${kind}-${String(mystery)}-${String(selected)}`);
  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 1 }}
      calloutAnchor={{ x: 0.5, y: 0 }}
      tracksViewChanges={track}
      zIndex={selected ? 2 : 1}
      title={title}
      description={description}
      onPress={onPress}
      onCalloutPress={onCalloutPress}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <PlanPinBadge category={category} mystery={mystery} selected={selected} />
    </Marker>
  );
}

/** A cluster on a map; tapping it usually zooms in. */
export function ClusterMarker({
  coordinate,
  count,
  accessibilityLabel,
  onPress,
}: {
  coordinate: LatLng;
  count: number;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const track = useTrackOnce(String(count));
  return (
    <Marker
      coordinate={coordinate}
      tracksViewChanges={track}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
    >
      <ClusterBubble count={count} />
    </Marker>
  );
}

/** The neutral hue, for map shapes that are not a category (mystery areas). */
export const MYSTERY_AREA = {
  stroke: categoryHues.slate.solid,
  fill: 'rgba(163,179,167,0.14)',
} as const;

const styles = StyleSheet.create({
  pin: { alignItems: 'center' },
  badge: { alignItems: 'center', justifyContent: 'center' },
  pointer: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: POINTER * 0.75,
    borderRightWidth: POINTER * 0.75,
    borderTopWidth: POINTER,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  cluster: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderWidth: 2,
  },
});
