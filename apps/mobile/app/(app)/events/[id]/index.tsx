import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { EventTogetherTools } from '../../../../components/at-event/EventTogetherTools';
import { EventComments } from '../../../../components/EventComments';
import { DirectionsButton } from '../../../../components/DirectionsButton';
import { EventDetailView } from '../../../../components/EventDetailView';
import { ErrorState, LoadingState, OfflineState, Screen, Text } from '../../../../components/ui';
import { useEvent } from '../../../../src/features/events/api';
import { useIsOffline } from '../../../../src/hooks/use-is-offline';
import { errorMessage } from '../../../../src/lib/errors';

/** Notices another screen can hand over when it opens this plan (only these keys are shown). */
const NOTICES = {
  inviteFailed: 'events.inviteFailedNotice',
  creditUsed: 'referrals.creditUsed',
} as const;

export default function EventScreen() {
  const { id, notice, directions } = useLocalSearchParams<{
    id: string;
    notice?: string;
    directions?: string;
  }>();
  const { t } = useTranslation();
  const offline = useIsOffline();
  const q = useEvent(id);
  return (
    <Screen testID="event-screen">
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        offline ? (
          <OfflineState onRetry={() => void q.refetch()} />
        ) : (
          <ErrorState
            message={errorMessage(t, q.error) ?? undefined}
            onRetry={() => void q.refetch()}
          />
        )
      ) : (
        <>
          {notice && notice in NOTICES ? (
            <Text tone="primary" accessibilityLiveRegion="polite" testID="event-notice">
              {t(NOTICES[notice as keyof typeof NOTICES])}
            </Text>
          ) : null}
          {/* Opened from the "starts soon" reminder (D-211): directions first, once the spot is visible. */}
          {directions === '1' &&
          q.data.status === 'published' &&
          q.data.location.kind === 'exact' ? (
            <View style={styles.ready} testID="event-directions-ready">
              <Text accessibilityLiveRegion="polite">{t('directions.ready')}</Text>
              <DirectionsButton
                location={q.data.location}
                variant="primary"
                testID="event-directions-top"
              />
            </View>
          ) : null}
          <EventDetailView event={q.data} afterRsvp={<EventTogetherTools event={q.data} />} />
          <EventComments eventId={q.data.id} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ ready: { gap: 8 } });
