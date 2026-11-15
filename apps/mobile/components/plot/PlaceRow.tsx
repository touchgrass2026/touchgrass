import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../src/theme/theme';
import { MapPin } from '../icons';
import { Icon, Pressable, Text } from '../ui';

/**
 * One place in the Where search (D-206), laid out like a maps app: a pin, the place's name in bold on one
 * line, its address under it in muted text (up to two lines). Compact, so several results fit on screen.
 */
export function PlaceRow({
  name,
  address,
  onPress,
  last = false,
  testID,
}: {
  name: string;
  address?: string;
  onPress: () => void;
  /** No divider under the last row of a group. */
  last?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={address ? `${name}, ${address}` : name}
      onPress={onPress}
      style={[styles.row, { minHeight: theme.minTouchTarget + 8 }]}
    >
      <View style={[styles.pin, { backgroundColor: theme.colors.surfaceAlt }]}>
        <Icon icon={MapPin} size={16} color={theme.colors.textMuted} />
      </View>
      <View
        style={[
          styles.text,
          last
            ? null
            : {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: theme.colors.border,
              },
        ]}
      >
        <Text variant="label" numberOfLines={1}>
          {name}
        </Text>
        {address ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {address}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14 },
  pin: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2, paddingVertical: 10, paddingRight: 14 },
});
