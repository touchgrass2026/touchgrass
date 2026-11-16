import { categoryHues, type ConversationSummary } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { closingInHours } from '../../src/features/chat/api';
import { formatWhen } from '../../src/features/events/format';
import { useTheme } from '../../src/theme/theme';
import { Clock } from '../icons';
import { Icon, Text } from '../ui';

/**
 * Always says when a plan chat goes away (D-208, D-214): a quiet note with the date from the start, and an
 * amber warning in its last 24 hours, so nobody is caught out when the chat disappears from Chats.
 */
export function ChatCloseNote({
  conversation: c,
  now = Date.now(),
}: {
  conversation: Pick<ConversationSummary, 'kind' | 'readOnly' | 'closesAt'>;
  now?: number;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  if (c.kind !== 'event' || c.readOnly || !c.closesAt) return null;
  if (Date.parse(c.closesAt) <= now) return null;
  const hours = closingInHours(c, now);
  const amber = categoryHues.amber;
  if (hours === null)
    return (
      <View
        style={[
          styles.note,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}
        testID="closing-note"
      >
        <Icon icon={Clock} size={14} color={theme.colors.textMuted} />
        <Text variant="caption" tone="muted" style={styles.text}>
          {t('chat.closesOn', { when: formatWhen(c.closesAt, i18n.language) })}
        </Text>
      </View>
    );
  return (
    <View
      style={[styles.note, { backgroundColor: amber.soft, borderColor: amber.solid }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="closing-soon"
    >
      <Icon icon={Clock} size={14} color={amber.text} />
      <Text variant="caption" style={[styles.text, { color: amber.text, fontWeight: '600' }]}>
        {hours === 0 ? t('chat.closesInUnderHour') : t('chat.closesInHours', { count: hours })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginVertical: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1 },
});
