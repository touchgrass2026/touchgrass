import type { EventSummary } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { EventCard } from '../../../components/EventCard';
import { PlanRail } from '../../../components/explore/PlanRail';
import {
  Button,
  EmptyState,
  ErrorState,
  FadeIn,
  OfflineState,
  Screen,
  Text,
} from '../../../components/ui';
import { FeedSkeleton } from '../../../components/FeedSkeleton';
import { useMyEvents } from '../../../src/features/events/api';
import { openPlan } from '../../../src/features/events/open-plan';
import { flatten } from '../../../src/features/social/api';
import { useIsOffline } from '../../../src/hooks/use-is-offline';
import { useRefreshOnFocus } from '../../../src/hooks/use-refresh-on-focus';
import { errorMessage } from '../../../src/lib/errors';

/** Matches the Screen's side padding so rails run edge to edge. */
const GUTTER = 20;

/**
 * Your plans (F-EVT-06, D-158): the next one as a big card, then sideways rows for everything coming up,
 * what you host and what's done; Plot and plan votes up top (F-EVT-01).
 */
export default function PlansScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const offline = useIsOffline();
  const upcoming = useMyEvents('upcoming');
  const hosting = useMyEvents('hosting');
  const past = useMyEvents('past');
  // Fresh when you come back to the tab, and on pull-down (D-215).
  const refresh = (): Promise<unknown> =>
    Promise.all([upcoming.refetch(), hosting.refetch(), past.refetch()]);
  useRefreshOnFocus([refresh]);
  /** Opens a plan with the rest of its row, so the plan screen can swipe through them (D-219). */
  const open = (e: EventSummary, row: readonly EventSummary[]): void => {
    openPlan(router, e.id, row);
  };

  const queries = [upcoming, hosting, past];
  const pending = queries.some((q) => q.isPending);
  const failed = queries.find((q) => q.isError);
  const next = flatten(upcoming.data);
  const rows: { key: 'upcoming' | 'hosting' | 'past'; items: EventSummary[] }[] = [
    { key: 'upcoming', items: next.slice(1) },
    { key: 'hosting', items: flatten(hosting.data) },
    { key: 'past', items: flatten(past.data) },
  ];

  let body;
  if (pending) body = <FeedSkeleton label={t('states.loading')} />;
  else if (failed)
    body = offline ? (
      <OfflineState onRetry={() => void failed.refetch()} />
    ) : (
      <ErrorState
        message={errorMessage(t, failed.error) ?? undefined}
        onRetry={() => void failed.refetch()}
      />
    );
  else if (next.length === 0 && rows.every((r) => r.items.length === 0))
    body = <EmptyState body={t('events.empty')} />;
  else
    body = (
      <>
        {next[0] ? (
          <FadeIn>
            <View testID="plans-next">
              <Text variant="heading" accessibilityRole="header">
                {t('events.nextUp')}
              </Text>
              <EventCard
                event={next[0]}
                onOpen={() => {
                  if (next[0]) open(next[0], next);
                }}
              />
            </View>
          </FadeIn>
        ) : null}
        {rows.map((r) =>
          r.items.length > 0 ? (
            <PlanRail
              key={r.key}
              railKey={`mine-${r.key}`}
              title={t(`events.${r.key}`)}
              items={r.items}
              gutter={GUTTER}
              onOpen={(e) => {
                // "Next up" and Upcoming are one row: swiping from either goes through all upcoming plans.
                open(e, r.key === 'upcoming' ? next : r.items);
              }}
            />
          ) : null,
        )}
      </>
    );

  return (
    <Screen testID="plans-screen" onRefresh={refresh}>
      <Text variant="title" accessibilityRole="header">
        {t('events.title')}
      </Text>
      <Button
        label={t('events.plot')}
        testID="plot-cta"
        onPress={() => {
          router.push('/plot');
        }}
      />
      <Button
        label={t('proposals.list')}
        variant="secondary"
        testID="open-proposals"
        onPress={() => {
          router.push('/proposals');
        }}
      />
      {body}
    </Screen>
  );
}
