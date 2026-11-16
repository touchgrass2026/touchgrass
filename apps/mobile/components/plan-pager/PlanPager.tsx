import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  type AccessibilityActionEvent,
  Animated,
  type FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTrack } from '../../src/features/analytics/analytics';
import { useFeedClick } from '../../src/features/discovery/api';
import { useEvent, usePrefetchEvents } from '../../src/features/events/api';
import { useIsOffline } from '../../src/hooks/use-is-offline';
import { errorMessage } from '../../src/lib/errors';
import type { BrowseContext } from '../../src/stores/browse-store';
import { TOUCH_TARGET, useTheme } from '../../src/theme/theme';
import { ArrowLeft, ArrowRight, type GlyphIcon } from '../icons';
import { ErrorState, Icon, OfflineBanner, OfflineState, Pressable, Text } from '../ui';
import { PlanCard, PlanCardPlaceholder, PlanCardPreview } from './PlanCard';

/** How far in from the screen edge each card starts: the neighbours peek in this space. */
export const PAGER_SIDE = 24;
/** Space between two cards. */
export const PAGER_GAP = 8;

/** Card width and paging step for a screen width (cards are as wide as the screen minus the peeks). */
export function pagerMetrics(screenWidth: number): { cardWidth: number; step: number } {
  const cardWidth = Math.max(0, screenWidth - PAGER_SIDE * 2);
  return { cardWidth, step: cardWidth + PAGER_GAP };
}

/** Which page a horizontal offset settles on. */
export function pageAt(offsetX: number, step: number, count: number): number {
  if (step <= 0 || count === 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(offsetX / step)));
}

/** The visible plan: loads its detail and shows the full card. */
function ActivePage({
  id,
  onClose,
  scrollY,
  onScrollY,
}: {
  id: string;
  onClose: () => void;
  scrollY: number;
  onScrollY: (y: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const offline = useIsOffline();
  const q = useEvent(id);
  if (q.isPending) return <PlanCardPreview event={undefined} language={i18n.language} />;
  if (q.isError)
    return (
      <PlanCardPlaceholder>
        <View style={styles.pageState}>
          {offline ? (
            <OfflineState onRetry={() => void q.refetch()} />
          ) : (
            <ErrorState
              message={errorMessage(t, q.error) ?? undefined}
              onRetry={() => void q.refetch()}
            />
          )}
        </View>
      </PlanCardPlaceholder>
    );
  return (
    <PlanCard event={q.data} onClose={onClose} initialScrollY={scrollY} onScrollY={onScrollY} />
  );
}

/** A neighbour (one swipe away): loads its plan ahead of time and shows the top of its card. */
function NeighbourPage({ id }: { id: string }) {
  const { i18n } = useTranslation();
  const q = useEvent(id);
  return <PlanCardPreview event={q.data} language={i18n.language} />;
}

/** Round previous / next button under the cards: the visible alternative to swiping. */
function StepButton({
  icon,
  label,
  disabled,
  onPress,
  testID,
}: {
  icon: GlyphIcon;
  label: string;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={[
        styles.step,
        {
          width: TOUCH_TARGET,
          height: TOUCH_TARGET,
          borderRadius: TOUCH_TARGET / 2,
          backgroundColor: theme.colors.surfaceAlt,
          borderColor: theme.colors.border,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Icon icon={icon} size={20} color={theme.colors.text} />
    </Pressable>
  );
}

/**
 * The plan screen opened from a row (D-219, District's pattern): each plan of the row is a large rounded
 * card with its neighbours peeking at the edges; swiping sideways moves through the row, the sheet inside a
 * card scrolls up and down on its own. Only the visible card is fully mounted (its neighbours show their top
 * and preload), so its buttons and test ids are the only ones on screen. Previous / Next buttons and the
 * adjustable position label do the same as swiping, and each move is announced ("Plan 2 of 7"). Under
 * Reduce Motion the neighbours don't shrink and moves don't animate. The route's `id` follows the visible
 * plan without remounting the screen.
 */
export function PlanPager({ context, initialId }: { context: BrowseContext; initialId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const track = useTrack();
  const click = useFeedClick();
  const { width } = useWindowDimensions();
  const { cardWidth, step } = pagerMetrics(width);
  const { ids } = context;
  const [index, setIndex] = useState(() => {
    const at = ids.indexOf(initialId);
    return at >= 0 ? at : Math.min(Math.max(context.index, 0), ids.length - 1);
  });
  const [initialIndex] = useState(index);
  const [height, setHeight] = useState(0);
  const scrollX = useRef(new Animated.Value(initialIndex * step)).current;
  const list = useRef<FlatList<string>>(null);
  // Each card keeps where its sheet was scrolled to, so swiping back lands where you left it.
  const scrollYs = useRef<Record<string, number>>({});
  const total = ids.length;
  // The cards either side load ahead of time, whether or not the list has drawn them yet.
  usePrefetchEvents([ids[index - 1], ids[index + 1]].filter((x): x is string => x !== undefined));
  const position = t('planPager.position', { n: index + 1, total });

  const settleOn = useCallback(
    (next: number) => {
      if (next === index) return;
      setIndex(next);
      const id = ids[next];
      if (!id) return;
      router.setParams({ id });
      track('screen_viewed', { screen: 'event', via: 'swipe', position: next });
      const requestId = context.feed?.requestId;
      const feedPosition = context.feed?.positions[next];
      if (requestId && feedPosition !== undefined && feedPosition !== null)
        click.mutate({ requestId, eventId: id, position: feedPosition });
      AccessibilityInfo.announceForAccessibility(
        t('planPager.position', { n: next + 1, total: ids.length }),
      );
    },
    [click, context.feed, ids, index, router, t, track],
  );

  const goTo = (next: number): void => {
    if (next < 0 || next >= total || next === index) return;
    list.current?.scrollToOffset({ offset: next * step, animated: !theme.reduceMotion });
    settleOn(next);
  };

  // Keep the list on the visible card when the width changes (rotation, split screen).
  const indexRef = useRef(index);
  indexRef.current = index;
  useEffect(() => {
    list.current?.scrollToOffset({ offset: indexRef.current * step, animated: false });
  }, [step]);

  const onSettle = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    settleOn(pageAt(e.nativeEvent.contentOffset.x, step, total));
  };

  const close = (): void => {
    router.back();
  };

  const onAction = (e: AccessibilityActionEvent): void => {
    if (e.nativeEvent.actionName === 'increment') goTo(index + 1);
    else if (e.nativeEvent.actionName === 'decrement') goTo(index - 1);
  };

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      edges={['top', 'bottom']}
      testID="event-screen"
    >
      {/* The card has its own close button; the stack header would only take room from it. */}
      <Stack.Screen options={{ headerShown: false }} />
      <OfflineBanner />
      <View
        style={styles.fill}
        onLayout={(e) => {
          setHeight(e.nativeEvent.layout.height);
        }}
      >
        <Animated.FlatList
          ref={list}
          data={ids}
          extraData={index}
          horizontal
          keyExtractor={(id) => id}
          showsHorizontalScrollIndicator={false}
          snapToInterval={step}
          decelerationRate="fast"
          disableIntervalMomentum
          directionalLockEnabled
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: step, offset: step * i, index: i })}
          initialNumToRender={2}
          windowSize={3}
          maxToRenderPerBatch={2}
          contentContainerStyle={{ paddingHorizontal: PAGER_SIDE - PAGER_GAP / 2 }}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          onMomentumScrollEnd={onSettle}
          testID="plan-pager"
          renderItem={({ item: id, index: i }) => {
            const range = [(i - 1) * step, i * step, (i + 1) * step];
            const scale = theme.reduceMotion
              ? 1
              : scrollX.interpolate({
                  inputRange: range,
                  outputRange: [0.94, 1, 0.94],
                  extrapolate: 'clamp',
                });
            const opacity = theme.reduceMotion
              ? 1
              : scrollX.interpolate({
                  inputRange: range,
                  outputRange: [0.7, 1, 0.7],
                  extrapolate: 'clamp',
                });
            const distance = Math.abs(i - index);
            return (
              <View
                style={[styles.page, { width: step, height: height || undefined }]}
                testID={`plan-page-${String(i)}`}
              >
                <Animated.View
                  style={[
                    styles.cardFrame,
                    {
                      width: cardWidth,
                      borderRadius: theme.radii.lg,
                      borderColor: theme.colors.border,
                      transform: [{ scale }],
                      opacity,
                    },
                  ]}
                  testID={`plan-card-frame-${String(i)}`}
                >
                  {distance === 0 ? (
                    <ActivePage
                      id={id}
                      onClose={close}
                      scrollY={scrollYs.current[id] ?? 0}
                      onScrollY={(y) => {
                        scrollYs.current[id] = y;
                      }}
                    />
                  ) : distance === 1 ? (
                    <NeighbourPage id={id} />
                  ) : (
                    <PlanCardPlaceholder />
                  )}
                </Animated.View>
              </View>
            );
          }}
        />
      </View>
      <View style={[styles.bar, { paddingHorizontal: PAGER_SIDE }]}>
        <StepButton
          icon={ArrowLeft}
          label={t('planPager.previous')}
          disabled={index === 0}
          onPress={() => {
            goTo(index - 1);
          }}
          testID="plan-pager-prev"
        />
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t('planPager.label')}
          accessibilityHint={t('planPager.hint')}
          accessibilityValue={{ text: position }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onAction}
          style={[styles.position, { minHeight: TOUCH_TARGET }]}
          testID="plan-pager-position"
        >
          <Text variant="label" tone="muted" accessibilityLiveRegion="polite">
            {position}
          </Text>
        </View>
        <StepButton
          icon={ArrowRight}
          label={t('planPager.next')}
          disabled={index >= total - 1}
          onPress={() => {
            goTo(index + 1);
          }}
          testID="plan-pager-next"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  page: { paddingHorizontal: PAGER_GAP / 2, paddingTop: 8 },
  cardFrame: { flex: 1, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  pageState: { padding: 16 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  position: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  step: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
