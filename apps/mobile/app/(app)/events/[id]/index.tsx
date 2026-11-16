import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { EventTogetherTools } from '../../../../components/at-event/EventTogetherTools';
import { EventComments } from '../../../../components/EventComments';
import { DirectionsButton } from '../../../../components/DirectionsButton';
import { EventDetailView } from '../../../../components/EventDetailView';
import { PlanPager } from '../../../../components/plan-pager/PlanPager';
import { ErrorState, LoadingState, OfflineState, Screen, Text } from '../../../../components/ui';
import { useEvent } from '../../../../src/features/events/api';
import { useIsOffline } from '../../../../src/hooks/use-is-offline';
import { errorMessage } from '../../../../src/lib/errors';
import { browseContextFor } from '../../../../src/stores/browse-store';

/** Notices another screen can hand over when it opens this plan (only these keys are shown). */
const NOTICES = {
  inviteFailed: 'events.inviteFailedNotice',
  creditUsed: 'referrals.creditUsed',
} as const;

/**
 * A plan. Opened from a row of plans (`browse` names the row, D-219) it is a swipeable deck of cards
 * starting at the tapped plan; from a deep link, notification or share link it is just this plan.
 */
export default function EventScreen() {
  const { id, browse } = useLocalSearchParams<{ id: string; browse?: string }>();
  // Read once: the pager moves `id` along as the person swipes, and must not fall back to one plan then.
  const [context] = useState(() => browseContextFor(browse, id));
  if (context) return <PlanPager context={context} initialId={id} />;
  return <SinglePlan id={id} />;
}

function SinglePlan({ id }: { id: string }) {
  const { notice, directions } = useLocalSearchParams<{
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
