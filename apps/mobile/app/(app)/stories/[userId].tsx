import { useQueryClient } from '@tanstack/react-query';
import { media, type Story, type StoryTray, type StoryViewer } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, FlatList, Modal, PanResponder, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../components/Avatar';
import { Eye, Flag, Heart, More, Pause, Play, Send, X } from '../../../components/icons';
import { StoryVideo } from '../../../components/stories/StoryVideo';
import {
  Button,
  ErrorState,
  Icon,
  LoadingState,
  OfflineState,
  Pop,
  Text,
  Pressable,
} from '../../../components/ui';
import { useStartDirect } from '../../../src/features/chat/api';
import { storyAge } from '../../../src/features/stories/age';
import {
  STORY_KEYS,
  useDeleteStory,
  useLikeStory,
  useMarkStoryViewed,
  usePersonStories,
  useStoryViewers,
} from '../../../src/features/stories/api';
import { useIsOffline } from '../../../src/hooks/use-is-offline';
import { useScreenReader } from '../../../src/hooks/use-screen-reader';
import { ApiError } from '../../../src/lib/api-client';
import { errorMessage } from '../../../src/lib/errors';
import { useTheme, TOUCH_TARGET } from '../../../src/theme/theme';

/** How long a photo story stays up before the next one, unless held, paused or a screen reader is on. */
export const STORY_DURATION_MS = 6000;
/** A drag down this far (or a quick flick) closes the viewer. */
const SWIPE_CLOSE_DISTANCE = 120;
const SWIPE_CLOSE_VELOCITY = 1;

/**
 * Stories, full screen, the Instagram way (Phase 13, D-207). The route's `queue` (comma-separated user ids)
 * says whose stories play after this person's; opened from the tray, it is the rest of the tray in order.
 * Each person gets a fresh viewer so progress and the queue start clean.
 */
export default function StoryViewerScreen() {
  const { userId, queue } = useLocalSearchParams<{ userId: string; queue?: string }>();
  return <PersonStoriesViewer key={userId} userId={userId} queueParam={queue} />;
}

/**
 * One person's stories: segmented progress across the top (the current one fills over the story's length,
 * a video's own), avatar, name, age and close; tap the right or left half to move, hold to pause, drag down
 * to close; at the end it moves on to the next person in the tray. Media is full-bleed between top and
 * bottom gradients. Reduce Motion drops the drag and fade movement (progress still advances, in steps);
 * screen readers get real buttons for previous, next and pause, and stories wait for them.
 */
function PersonStoriesViewer({
  userId,
  queueParam,
}: {
  userId: string;
  queueParam: string | undefined;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const offline = useIsOffline();
  const screenReader = useScreenReader();
  const q = usePersonStories(userId);
  const markViewed = useMarkStoryViewed();
  const like = useLikeStory(userId);
  const remove = useDeleteStory(userId);
  const startDirect = useStartDirect();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whose stories come next: from the route, else the tray as it was when this opened (the tray reorders
  // once stories are seen, so it is read once).
  const [queue] = useState<string[]>(() => {
    if (queueParam !== undefined) return queueParam.split(',').filter(Boolean);
    const order = qc.getQueryData<StoryTray>(STORY_KEYS.tray)?.items.map((i) => i.person.id) ?? [];
    const at = order.indexOf(userId);
    return at === -1 ? [] : order.slice(at + 1);
  });

  const items = q.data?.items ?? [];
  const current = Math.min(index, Math.max(items.length - 1, 0));
  const story: Story | undefined = items[current];

  const close = (): void => {
    void qc.invalidateQueries({ queryKey: STORY_KEYS.tray });
    router.back();
  };
  const next = (): void => {
    if (current + 1 < items.length) {
      setIndex(current + 1);
      return;
    }
    const [following, ...rest] = queue;
    if (following === undefined) {
      close();
      return;
    }
    void qc.invalidateQueries({ queryKey: STORY_KEYS.tray });
    router.replace({
      pathname: '/stories/[userId]',
      params: { userId: following, queue: rest.join(',') },
    });
  };
  const previous = (): void => {
    setIndex(Math.max(current - 1, 0));
  };

  // Marked this visit: going back to a story must not record it again before the list refreshes.
  const marked = useRef(new Set<string>());
  const storyId = story?.id;
  const shouldMark = story !== undefined && !story.mine && !story.seen;
  useEffect(() => {
    if (storyId && shouldMark && !marked.current.has(storyId)) {
      marked.current.add(storyId);
      markViewed.mutate(storyId);
    }
    // Mark each story once as it comes on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  const sheetOpen = viewersOpen || optionsOpen;
  const playing = storyId !== undefined && !paused && !held && !sheetOpen;
  const moving = playing && !screenReader;
  // A video story stays up for its own length (D-164); photos for the fixed time.
  const durationMs = story?.video?.durationMs ?? STORY_DURATION_MS;

  // The current story's progress, 0..1. Holding or pausing keeps the time already watched.
  const progress = useRef(new Animated.Value(0)).current;
  const elapsed = useRef(0);
  const timedStory = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (timedStory.current !== storyId) {
      timedStory.current = storyId;
      elapsed.current = 0;
      progress.setValue(0);
    }
    if (!moving) return undefined;
    const startElapsed = elapsed.current;
    const startedAt = Date.now();
    const remaining = Math.max(durationMs - startElapsed, 0);
    const timer = setTimeout(next, remaining);
    let stop: () => void;
    if (theme.reduceMotion) {
      // No continuous movement: the bar steps once a second.
      const tick = setInterval(() => {
        progress.setValue(Math.min((startElapsed + Date.now() - startedAt) / durationMs, 1));
      }, 1000);
      stop = () => {
        clearInterval(tick);
      };
    } else {
      const anim = Animated.timing(progress, {
        toValue: 1,
        duration: remaining,
        easing: (x: number) => x,
        useNativeDriver: true,
      });
      anim.start();
      stop = () => {
        anim.stop();
      };
    }
    return () => {
      clearTimeout(timer);
      stop();
      elapsed.current = startElapsed + Date.now() - startedAt;
    };
    // Restart the clock whenever the story changes, or it stops and starts again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, moving, theme.reduceMotion]);

  // Drag down to close: the story follows the finger (not with Reduce Motion) and snaps back if let go early.
  const drag = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(close);
  closeRef.current = close;
  const reduceMotion = theme.reduceMotion;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_e, g) => g.dy > 12 && g.dy > Math.abs(g.dx) * 1.5,
        onPanResponderGrant: () => {
          setHeld(true);
        },
        onPanResponderMove: (_e, g) => {
          if (!reduceMotion) drag.setValue(Math.max(g.dy, 0));
        },
        onPanResponderRelease: (_e, g) => {
          setHeld(false);
          if (g.dy > SWIPE_CLOSE_DISTANCE || g.vy > SWIPE_CLOSE_VELOCITY) {
            closeRef.current();
            return;
          }
          if (reduceMotion) drag.setValue(0);
          else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () => {
          setHeld(false);
          drag.setValue(0);
        },
      }),
    [drag, reduceMotion],
  );

  if (q.isPending) return offline ? <OfflineState /> : <LoadingState />;
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return gone ? (
      <SafeAreaView
        style={[styles.root, styles.center, { backgroundColor: theme.colors.background }]}
      >
        <Text tone="muted" testID="story-gone">
          {t('stories.gone')}
        </Text>
        <Button label={t('common.done')} onPress={close} testID="story-gone-close" />
      </SafeAreaView>
    ) : (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (!story) return <LoadingState />;
  const person = q.data.person;
  const age = storyAge(t, story.createdAt);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <View
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      testID="story-viewer"
      {...pan.panHandlers}
    >
      <Animated.View
        style={[
          styles.fill,
          { transform: [{ translateY: drag }], opacity: drag.interpolate(dragFade) },
        ]}
      >
        {/* Full-bleed media: a blurred fill behind, the whole photo or clip on top. */}
        <View style={styles.fill} key={story.id}>
          {story.video ? (
            <StoryVideo
              uri={story.video.url}
              // Plays with sound; screen-reader users can still play it (it just doesn't move on by itself).
              playing={playing}
              label={t('stories.videoStory', { name: person.displayName })}
              style={styles.fill}
              testID="story-video"
            />
          ) : (
            <>
              <Image
                source={{ uri: story.image.sm }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={30}
                accessible={false}
                importantForAccessibility="no"
                accessibilityIgnoresInvertColors
              />
              <Image
                source={{ uri: story.image.lg }}
                style={styles.fill}
                contentFit="contain"
                transition={theme.reduceMotion ? 0 : 150}
                accessibilityIgnoresInvertColors
                accessibilityLabel={t('stories.personSeen', { name: person.displayName })}
                testID="story-image"
              />
            </>
          )}
        </View>
        <LinearGradient
          colors={[media.scrimTop, media.clear]}
          style={[styles.topShade, { height: insets.top + 120 }]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[media.clear, media.scrim]}
          style={[styles.bottomShade, { height: insets.bottom + 200 }]}
          pointerEvents="none"
        />

        {/* Tap the left half for back, the right half for next; hold either to pause. */}
        <View style={styles.taps}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('stories.previous')}
            onPress={previous}
            onLongPress={() => {
              setHeld(true);
            }}
            onPressOut={() => {
              setHeld(false);
            }}
            delayLongPress={250}
            style={styles.tap}
            testID="story-previous"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('stories.next')}
            onPress={next}
            onLongPress={() => {
              setHeld(true);
            }}
            onPressOut={() => {
              setHeld(false);
            }}
            delayLongPress={250}
            style={styles.tap}
            testID="story-next"
          />
        </View>

        <View
          style={[styles.chrome, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}
          pointerEvents="box-none"
        >
          {/* Hidden while held, like Instagram, so the photo can be seen whole. */}
          <View style={[styles.top, held ? styles.hidden : null]} pointerEvents="box-none">
            <View
              style={styles.bars}
              accessible
              accessibilityLabel={t('stories.progress', {
                index: current + 1,
                count: items.length,
              })}
              testID="story-progress"
            >
              {items.map((s, i) => (
                <View key={s.id} style={styles.bar} testID={`story-segment-${i}`}>
                  {i < current ? (
                    <View style={[styles.barFill, styles.full]} />
                  ) : i === current ? (
                    <Animated.View
                      // Scaled from the left edge on the native driver, so the JS thread stays free.
                      style={[
                        styles.barFill,
                        styles.full,
                        styles.grow,
                        { transform: [{ scaleX: progress }] },
                      ]}
                    />
                  ) : null}
                </View>
              ))}
            </View>

            <View style={styles.header}>
              <Avatar photo={person.photo} name={person.displayName} size={32} />
              <View style={styles.headerText}>
                <Text
                  variant="label"
                  numberOfLines={1}
                  accessibilityRole="header"
                  style={styles.onMedia}
                >
                  {person.displayName}
                </Text>
                <Text
                  variant="caption"
                  style={styles.onMediaMuted}
                  accessibilityLabel={age.long}
                  testID="story-age"
                >
                  {age.short}
                </Text>
              </View>
              <MediaButton
                label={paused ? t('stories.resume') : t('stories.pause')}
                onPress={() => {
                  setPaused((p) => !p);
                }}
                testID="story-pause"
              >
                <Icon icon={paused ? Play : Pause} size={20} color={media.text} />
              </MediaButton>
              <MediaButton label={t('stories.close')} onPress={close} testID="story-close">
                <Icon icon={X} size={24} color={media.text} />
              </MediaButton>
            </View>
          </View>

          <View style={styles.spacer} pointerEvents="none" />

          <View style={[styles.bottom, held ? styles.hidden : null]} pointerEvents="box-none">
            {story.caption ? (
              <Text style={[styles.caption, styles.onMedia]} testID="story-caption-text">
                {story.caption}
              </Text>
            ) : null}
            {story.held ? (
              <Text
                variant="caption"
                style={[styles.caption, styles.onMediaMuted]}
                testID="story-held"
              >
                {t('stories.held')}
              </Text>
            ) : null}
            {error ? (
              <Text
                tone="danger"
                accessibilityRole="alert"
                style={styles.caption}
                testID="story-error"
              >
                {error}
              </Text>
            ) : null}

            {story.mine ? (
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('stories.seenBy', { count: story.viewCount ?? 0 })}, ${t('stories.likes', { count: story.likeCount ?? 0 })}`}
                  onPress={() => {
                    setViewersOpen(true);
                  }}
                  style={styles.seen}
                  testID="story-stats"
                >
                  <Icon icon={Eye} size={20} color={media.text} />
                  <Text variant="label" style={styles.onMedia}>
                    {t('stories.seenBy', { count: story.viewCount ?? 0 })}
                  </Text>
                </Pressable>
                <MediaButton
                  label={t('stories.options')}
                  onPress={() => {
                    setOptionsOpen(true);
                  }}
                  testID="story-options"
                >
                  <Icon icon={More} size={24} color={media.text} />
                </MediaButton>
              </View>
            ) : (
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('stories.reply')}
                  accessibilityHint={t('stories.replyHint', { name: person.displayName })}
                  onPress={() =>
                    void run(async () => {
                      const chat = await startDirect.mutateAsync(person.id);
                      router.replace({ pathname: '/chats/[id]', params: { id: chat.id } });
                    })
                  }
                  style={styles.reply}
                  testID="story-reply"
                >
                  <Text variant="body" numberOfLines={1} style={[styles.onMedia, styles.replyText]}>
                    {t('stories.replyPlaceholder', { name: person.displayName })}
                  </Text>
                  <Icon icon={Send} size={20} color={media.text} />
                </Pressable>
                <MediaButton
                  label={story.liked ? t('stories.unlike') : t('stories.like')}
                  onPress={() =>
                    void run(() => like.mutateAsync({ storyId: story.id, liked: !story.liked }))
                  }
                  testID="story-like"
                >
                  <Pop trigger={story.liked} when={story.liked}>
                    <Icon
                      icon={Heart}
                      size={24}
                      filled={story.liked}
                      color={story.liked ? theme.colors.primary : media.text}
                    />
                  </Pop>
                </MediaButton>
                <MediaButton
                  label={t('stories.report')}
                  onPress={() => {
                    setPaused(true);
                    router.push({
                      pathname: '/report',
                      params: {
                        targetType: 'story',
                        targetId: story.id,
                        name: person.displayName,
                      },
                    });
                  }}
                  testID="story-report"
                >
                  <Icon icon={Flag} size={20} color={media.text} />
                </MediaButton>
              </View>
            )}
          </View>
        </View>
      </Animated.View>

      {story.mine ? (
        <>
          <ViewersSheet
            storyId={viewersOpen ? story.id : null}
            count={story.viewCount ?? 0}
            onClose={() => {
              setViewersOpen(false);
            }}
          />
          <Sheet
            visible={optionsOpen}
            onClose={() => {
              setOptionsOpen(false);
            }}
            testID="story-options-sheet"
          >
            <Button
              label={t('stories.delete')}
              variant="danger"
              loading={remove.isPending}
              onPress={() =>
                void run(async () => {
                  await remove.mutateAsync(story.id);
                  setOptionsOpen(false);
                  if (items.length <= 1) close();
                })
              }
              testID="story-delete"
            />
            <Button
              label={t('common.cancel')}
              variant="secondary"
              onPress={() => {
                setOptionsOpen(false);
              }}
            />
          </Sheet>
        </>
      ) : null}
    </View>
  );
}

const dragFade = { inputRange: [0, 400], outputRange: [1, 0.4], extrapolate: 'clamp' as const };

/** A bare round control over the media: 44pt (48dp), white glyph, the gradient behind it gives contrast. */
function MediaButton({
  label,
  onPress,
  testID,
  children,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={styles.mediaButton}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

/** A bottom sheet over the story; slides in unless Reduce Motion is on. */
function Sheet({
  visible,
  onClose,
  testID,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  testID?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={theme.reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
    >
      <View style={styles.sheetWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          style={[styles.backdrop, { backgroundColor: media.scrim }]}
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              paddingBottom: insets.bottom + 20,
            },
          ]}
          testID={testID}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.border }]} />
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** Author only: who opened the story, when, and who liked it; more load as you scroll. */
function ViewersSheet({
  storyId,
  count,
  onClose,
}: {
  storyId: string | null;
  count: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const q = useStoryViewers(storyId);
  const viewers = q.data?.pages.flatMap((p) => p.items) ?? [];
  const loadMore = (): void => {
    if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  };
  const now = Date.now();
  return (
    <Sheet visible={storyId !== null} onClose={onClose} testID="story-viewers">
      <View style={styles.sheetTitle}>
        <Icon icon={Eye} size={20} />
        <Text variant="heading" accessibilityRole="header">
          {t('stories.seenBy', { count })}
        </Text>
      </View>
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState
          message={errorMessage(t, q.error) ?? undefined}
          onRetry={() => void q.refetch()}
        />
      ) : viewers.length === 0 ? (
        <Text tone="muted" testID="story-viewers-empty">
          {t('stories.noViewers')}
        </Text>
      ) : (
        <FlatList
          data={viewers}
          keyExtractor={(v: StoryViewer) => v.person.id}
          contentContainerStyle={styles.viewerList}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          renderItem={({ item: v }) => {
            const when = storyAge(t, v.viewedAt, now);
            return (
              <View
                style={styles.viewerRow}
                accessible
                accessibilityLabel={[
                  v.person.displayName,
                  v.liked ? t('stories.likedIt') : null,
                  when.long,
                ]
                  .filter(Boolean)
                  .join(', ')}
                testID={`story-viewer-${v.person.id}`}
              >
                <Avatar photo={v.person.photo} name={v.person.displayName} size={40} />
                <View style={styles.viewerText}>
                  <Text variant="label" numberOfLines={1}>
                    {v.person.displayName}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {when.short}
                  </Text>
                </View>
                {v.liked ? (
                  <Icon icon={Heart} size={20} filled color={theme.colors.primary} />
                ) : null}
              </View>
            );
          }}
          ListFooterComponent={
            q.hasNextPage ? (
              <Button
                label={t('stories.more')}
                variant="ghost"
                loading={q.isFetchingNextPage}
                onPress={loadMore}
                testID="story-viewers-more"
              />
            ) : undefined
          }
        />
      )}
      <Button label={t('common.done')} variant="secondary" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomShade: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  taps: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  tap: { flex: 1 },
  chrome: { ...StyleSheet.absoluteFill, paddingHorizontal: 12 },
  top: { gap: 10 },
  bottom: { gap: 10 },
  spacer: { flex: 1 },
  hidden: { opacity: 0 },
  bars: { flexDirection: 'row', gap: 4 },
  bar: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: media.dot,
  },
  barFill: { height: 3, backgroundColor: media.text },
  full: { width: '100%' },
  grow: { transformOrigin: 'left' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  onMedia: {
    color: media.text,
    textShadowColor: media.textShadow,
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  onMediaMuted: {
    color: media.textMuted,
    textShadowColor: media.textShadow,
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  caption: { textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seen: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: TOUCH_TARGET,
  },
  reply: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 16,
    borderRadius: TOUCH_TARGET / 2,
    borderWidth: 1,
    borderColor: media.chipBorder,
    backgroundColor: media.chip,
  },
  replyText: { flex: 1 },
  mediaButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2 },
  sheetTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewerList: { gap: 12 },
  viewerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TOUCH_TARGET },
  viewerText: { flex: 1, gap: 2 },
});
