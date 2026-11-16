import { type EventDetail, media } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { formatWhen } from '../../src/features/events/format';
import { useTheme, TOUCH_TARGET } from '../../src/theme/theme';
import { EventTogetherTools } from '../at-event/EventTogetherTools';
import { CategoryPill } from '../CategoryPill';
import { EventComments } from '../EventComments';
import { EventDetailView } from '../EventDetailView';
import { ChevronDown, ShareIcon, type GlyphIcon } from '../icons';
import { PlanArt } from '../PlanArt';
import { Icon, Pressable, Skeleton, Text } from '../ui';

/** Cover height as a share of the card's width: a tall photo, like a poster. */
const MEDIA_RATIO = 1.15;

/** Round button over the plan's photo (close, share): a dark glass chip so it reads on any cover. */
function MediaButton({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: GlyphIcon;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      testID={testID}
      style={[
        styles.mediaButton,
        {
          width: TOUCH_TARGET,
          height: TOUCH_TARGET,
          borderRadius: TOUCH_TARGET / 2,
          backgroundColor: media.chip,
          borderColor: media.chipBorder,
        },
      ]}
    >
      <Icon icon={icon} size={20} color={media.text} />
    </Pressable>
  );
}

/** The cover (or the category artwork) full-bleed at the top of a card, with a scrim for the top bar. */
function PlanMedia({ event }: { event: Pick<EventDetail, 'cover' | 'category'> }) {
  return (
    <View style={styles.media}>
      {event.cover ? (
        <Image
          source={{ uri: event.cover.lg }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessibilityIgnoresInvertColors
          // Decorative: the sheet below reads the plan's title and details.
          accessible={false}
          importantForAccessibility="no"
        />
      ) : (
        <View style={StyleSheet.absoluteFill} testID="event-art">
          <PlanArt category={event.category} iconSize={56} />
        </View>
      )}
      <LinearGradient colors={[media.scrimTop, media.clear]} style={styles.topScrim} />
    </View>
  );
}

/** The sheet's top edge: rounded over the photo, with a small handle so it reads as a sheet. */
function SheetTop() {
  const theme = useTheme();
  return (
    <View
      style={[styles.handle, { backgroundColor: theme.colors.border }]}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

/**
 * One plan as a District-style card (D-219): the cover full-bleed on top with close and share over it, the
 * plan's details in a sheet that scrolls on its own, and the main action (Pull up) pinned at the bottom.
 */
export function PlanCard({
  event,
  onClose,
  initialScrollY = 0,
  onScrollY,
}: {
  event: EventDetail;
  onClose: () => void;
  /** Where this card's sheet was scrolled to last time it was the visible one. */
  initialScrollY?: number;
  onScrollY?: (y: number) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <EventDetailView
      event={event}
      afterRsvp={<EventTogetherTools event={event} />}
      card={({ body, action, share }) => (
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]} testID="plan-card">
          <ScrollView
            style={styles.fill}
            contentOffset={{ x: 0, y: initialScrollY }}
            onScroll={(e) => onScrollY?.(e.nativeEvent.contentOffset.y)}
            scrollEventThrottle={64}
            // Inside a sideways pager: Android needs nested scrolling, iOS locks to the first direction.
            nestedScrollEnabled
            directionalLockEnabled
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            testID="plan-card-scroll"
          >
            <PlanMedia event={event} />
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: theme.colors.surface,
                  borderTopLeftRadius: theme.radii.lg,
                  borderTopRightRadius: theme.radii.lg,
                  marginTop: -theme.radii.lg,
                  paddingHorizontal: theme.spacing.lg,
                  paddingBottom: theme.spacing.xl,
                },
              ]}
            >
              <SheetTop />
              {body}
              <EventComments eventId={event.id} />
            </View>
          </ScrollView>
          <View style={styles.topBar} pointerEvents="box-none">
            <MediaButton
              icon={ChevronDown}
              label={t('planPager.close')}
              onPress={onClose}
              testID="plan-card-close"
            />
            <MediaButton
              icon={ShareIcon}
              label={t('events.share')}
              onPress={share}
              testID="plan-card-share"
            />
          </View>
          {action ? (
            <View
              style={[
                styles.footer,
                {
                  backgroundColor: theme.colors.surface,
                  borderTopColor: theme.colors.border,
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.md,
                },
              ]}
              testID="plan-card-action"
            >
              {action}
            </View>
          ) : null}
        </View>
      )}
    />
  );
}

/**
 * A neighbouring card while it peeks at the edge (D-219): the same cover and heading as the full card, but
 * nothing to tap and hidden from screen readers, so only the visible plan exposes its buttons and test ids.
 * `event` is undefined while it loads.
 */
export function PlanCardPreview({
  event,
  language,
}: {
  event: EventDetail | undefined;
  language: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: theme.colors.surface }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={event ? 'plan-card-preview' : 'plan-card-loading'}
    >
      {event ? (
        <PlanMedia event={event} />
      ) : (
        <Skeleton style={[styles.media, { borderRadius: 0 }]} />
      )}
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radii.lg,
            borderTopRightRadius: theme.radii.lg,
            marginTop: -theme.radii.lg,
            paddingHorizontal: theme.spacing.lg,
          },
        ]}
      >
        <SheetTop />
        {event ? (
          <>
            <CategoryPill category={event.category} />
            <Text variant="caption" tone="primary">
              {formatWhen(event.startsAt, language, event.timezone)}
            </Text>
            <Text variant="title" numberOfLines={2}>
              {event.title}
            </Text>
          </>
        ) : (
          <>
            <Skeleton style={styles.lineShort} />
            <Skeleton style={styles.lineLong} />
          </>
        )}
      </View>
    </View>
  );
}

/** Stand-in for a card further away than the neighbours: nothing loads until it comes close. */
export function PlanCardPlaceholder({ children }: { children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: theme.colors.surface }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Skeleton style={[styles.media, { borderRadius: 0 }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  card: { flex: 1, overflow: 'hidden' },
  media: { width: '100%', aspectRatio: 1 / MEDIA_RATIO, overflow: 'hidden' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 120 },
  sheet: { gap: 12, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 4 },
  topBar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  mediaButton: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
  lineShort: { height: 14, width: '40%' },
  lineLong: { height: 24, width: '80%' },
});
