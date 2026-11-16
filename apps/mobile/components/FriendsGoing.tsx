import type { FriendsGoing as FriendsGoingData } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { friendsGoingText } from '../src/features/events/format';
import { useTheme } from '../src/theme/theme';
import { Avatar } from './Avatar';
import { Text } from './ui';

/** Up to three overlapped faces of squad members holding a seat (D-210). Decorative; pair it with the line. */
export function FriendFaces({
  people,
  size = 26,
}: {
  people: FriendsGoingData['people'];
  size?: number;
}) {
  const theme = useTheme();
  return (
    <View
      style={styles.faces}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {people.slice(0, 3).map((p, i) => (
        <View key={p.id} style={i > 0 ? { marginLeft: -Math.round(size / 3) } : null}>
          <Avatar photo={p.photo} name={p.displayName} size={size} ring={theme.colors.background} />
        </View>
      ))}
    </View>
  );
}

/**
 * "Meera, Ravi and 2 friends are going" with their faces (D-210), for the plan screen. Renders nothing when
 * none of your friends are going, so the plan's own counts speak for themselves.
 */
export function FriendsGoingRow({ friends }: { friends: FriendsGoingData }) {
  const { t } = useTranslation();
  const line = friendsGoingText(t, friends);
  if (!line) return null;
  return (
    <View style={styles.row} accessible accessibilityLabel={line} testID="friends-going">
      <FriendFaces people={friends.people} size={32} />
      <Text variant="label" style={styles.grow}>
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  faces: { flexDirection: 'row' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flexGrow: 1, flexShrink: 1 },
});
