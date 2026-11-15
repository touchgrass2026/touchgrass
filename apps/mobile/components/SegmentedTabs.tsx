import { StyleSheet, View } from 'react-native';
import { useTheme } from '../src/theme/theme';
import { Text, Pressable } from './ui';

export interface SegmentedTabsProps<K extends string> {
  tabs: { key: K; label: string; badge?: number }[];
  value: K;
  onChange: (key: K) => void;
  /** testID of each segment is `${testIDPrefix}-${key}` (default "tab"). */
  testIDPrefix?: string;
}

/**
 * A segmented control: one rounded track, equal-width segments, the selected one filled (D-197). Replaces the
 * loose pills that wrapped onto uneven lines. Labels shrink to fit one line, or take two at large text sizes;
 * counts sit in a small badge. Accessible as a tab list.
 */
export function SegmentedTabs<K extends string>({
  tabs,
  value,
  onChange,
  testIDPrefix = 'tab',
}: SegmentedTabsProps<K>) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.track,
        {
          backgroundColor: theme.colors.surfaceAlt,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.pill,
        },
      ]}
    >
      {tabs.map((tab) => {
        const selected = tab.key === value;
        const label = tab.badge ? `${tab.label} (${String(tab.badge)})` : tab.label;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => {
              onChange(tab.key);
            }}
            style={[
              styles.segment,
              {
                minHeight: theme.minTouchTarget,
                borderRadius: theme.radii.pill,
                backgroundColor: selected ? theme.colors.primary : 'transparent',
              },
            ]}
            testID={`${testIDPrefix}-${tab.key}`}
          >
            <Text
              variant="label"
              // One line, shrinking to fit (Android only shrinks single-line text; two lines broke words
              // like "Request-s").
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              maxFontSizeMultiplier={1.3}
              style={[
                styles.label,
                {
                  color: selected ? theme.colors.onPrimary : theme.colors.text,
                  fontWeight: selected ? '700' : '500',
                },
              ]}
            >
              {tab.label}
            </Text>
            {tab.badge ? (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: selected ? theme.colors.onPrimary : theme.colors.primary },
                ]}
              >
                <Text
                  variant="caption"
                  style={{
                    color: selected ? theme.colors.primary : theme.colors.onPrimary,
                    fontWeight: '700',
                  }}
                >
                  {tab.badge > 99 ? '99+' : String(tab.badge)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 4, gap: 4, borderWidth: StyleSheet.hairlineWidth },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  label: { textAlign: 'center', flexShrink: 1 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
