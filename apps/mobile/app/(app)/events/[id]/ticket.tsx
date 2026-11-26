import { media } from '@touchgrass/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Check } from '../../../../components/icons';
import { QrCode } from '../../../../components/QrCode';
import { Button, ErrorState, Icon, LoadingState, Screen, Text } from '../../../../components/ui';
import { useEvent, useTicket } from '../../../../src/features/events/api';
import { formatTime } from '../../../../src/features/events/format';
import { errorMessage } from '../../../../src/lib/errors';
import { useTheme } from '../../../../src/theme/theme';

/** How often an open ticket checks whether a host has scanned it. */
const SCAN_POLL_MS = 4000;

/**
 * Your check-in code (F-EVT-14, D-227). The QR and its six-digit code are signed for you, this plan and a
 * 30-second window, and the screen fetches the next one as each rotates, so a screenshot or a forwarded code
 * stops working. "Show code instead" swaps the QR for the short code when the host's camera can't read it.
 * While it is open it checks every few seconds whether a host has scanned it; once you are in, the code gives
 * way to a clear "You're checked in" (D-205), so nobody shows a used code again.
 */
export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [showCode, setShowCode] = useState(false);
  const event = useEvent(id, {
    pollEveryMs: SCAN_POLL_MS,
    pollUntil: (e) => e.viewer.rsvp === 'checked_in',
  });
  const checkedIn = event.data?.viewer.rsvp === 'checked_in';
  const ticket = useTicket(id, !checkedIn);
  if (checkedIn)
    return (
      <Screen testID="ticket-screen">
        <Text variant="title" accessibilityRole="header">
          {event.data?.title ?? t('events.ticket')}
        </Text>
        <View
          style={[
            styles.done,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.lg,
            },
          ]}
          accessibilityRole="summary"
          accessibilityLiveRegion="polite"
          testID="ticket-checked-in"
        >
          <View style={[styles.tick, { backgroundColor: theme.colors.primary }]}>
            <Icon icon={Check} size={36} color={theme.colors.onPrimary} strokeWidth={3} />
          </View>
          <Text variant="title">{t('events.checkedInTitle')}</Text>
          <Text style={styles.centre}>{t('events.checkedInBody')}</Text>
        </View>
      </Screen>
    );
  if (ticket.isPending) return <LoadingState />;
  if (ticket.isError && !ticket.data)
    return (
      <ErrorState
        message={errorMessage(t, ticket.error) ?? undefined}
        onRetry={() => void ticket.refetch()}
      />
    );
  const { qr, code, validFrom, validUntil } = ticket.data;
  // Read digit by digit by screen readers ("4 8 1 ...") rather than as one large number.
  const spoken = code.split('').join(' ');
  return (
    <Screen testID="ticket-screen">
      <Text variant="title" accessibilityRole="header">
        {event.data?.title ?? t('events.ticket')}
      </Text>
      <Text>{t('events.ticketBody')}</Text>
      {showCode ? (
        <View
          style={[styles.code, { borderColor: theme.colors.border, borderRadius: theme.radii.lg }]}
          accessible
          accessibilityRole="text"
          accessibilityLabel={t('events.ticketCodeLabel', { code: spoken })}
          testID="ticket-code"
        >
          <Text variant="title" style={styles.digits} maxFontSizeMultiplier={1.5}>
            {code}
          </Text>
        </View>
      ) : (
        <View style={styles.qr} testID="ticket-qr">
          <QrCode value={qr} size={260} label={t('events.ticketQrLabel')} />
        </View>
      )}
      <Text tone="muted">{t('events.ticketRotates')}</Text>
      <Button
        label={showCode ? t('events.hideCode') : t('events.showCode')}
        variant="secondary"
        onPress={() => {
          setShowCode((v) => !v);
        }}
        testID="ticket-toggle-code"
      />
      <Text tone="muted">
        {t('events.ticketValid', {
          from: formatTime(validFrom, i18n.language),
          until: formatTime(validUntil, i18n.language),
        })}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  qr: { alignItems: 'center', padding: 16, backgroundColor: media.text },
  code: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    borderWidth: StyleSheet.hairlineWidth,
  },
  digits: { fontSize: 44, lineHeight: 52, letterSpacing: 8, fontVariant: ['tabular-nums'] },
  done: { alignItems: 'center', gap: 12, padding: 24, borderWidth: StyleSheet.hairlineWidth },
  tick: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  centre: { textAlign: 'center' },
});
