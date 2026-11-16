import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { EventCard } from '../../components/EventCard';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  Screen,
  Text,
} from '../../components/ui';
import { useWeekendPicks } from '../../src/features/discovery/api';
import { useIsOffline } from '../../src/hooks/use-is-offline';
import { errorMessage } from '../../src/lib/errors';

/** "This weekend" (D-211): the picks the Thursday push named, re-checked for the viewer when opened. */
export default function WeekendPicksScreen() {
  const { ids } = useLocalSearchParams<{ ids?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const offline = useIsOffline();
  const q = useWeekendPicks(ids);
  const explore = () => {
    router.push('/discover');
  };
  return (
    <Screen testID="weekend-screen">
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
      ) : q.data.items.length === 0 ? (
        <EmptyState
          title={t('weekendPicks.title')}
          body={t('weekendPicks.empty')}
          actionLabel={t('weekendPicks.explore')}
          onAction={explore}
        />
      ) : (
        <View style={styles.list}>
          <Text variant="title" accessibilityRole="header">
            {t('weekendPicks.title')}
          </Text>
          <Text tone="muted">{t('weekendPicks.subtitle')}</Text>
          {q.data.items.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onOpen={() => {
                router.push({ pathname: '/events/[id]', params: { id: event.id } });
              }}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ list: { gap: 12 } });
