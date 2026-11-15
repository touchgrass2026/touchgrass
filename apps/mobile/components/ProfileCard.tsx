import { media } from '@touchgrass/shared';
import { BadgeCheck } from './icons';
import type {
  HostRatingSummary,
  Interest,
  MediaVariants,
  ProfileStats,
  VibeTag,
} from '@touchgrass/shared';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { localized } from '../src/features/catalog/api';
import { useTheme } from '../src/theme/theme';
import { Icon, Text } from './ui';

export interface ProfileCardProps {
  displayName: string;
  /** Shown beside the name, quieter. */
  age?: number | null;
  /** Pronouns and area, one quiet line under the name. */
  subtitle?: string | null;
  bio: string;
  photos: MediaVariants[];
  interests: Interest[];
  /** Interests in their own words (D-200), shown as tags after the listed ones. */
  customInterests?: string[];
  vibeTags: VibeTag[];
  stats: ProfileStats;
  verified: boolean;
  highlightInterestIds?: string[];
  /** Shown once the person has enough host ratings (F-AFT-02). */
  hostRating?: HostRatingSummary | null;
}

/** Width used before the photo strip has been measured (first frame, tests). */
const FALLBACK_WIDTH = 320;

/**
 * Profile body shared by "my profile" and other people's profiles (D-200): large swipeable photos with page
 * dots, then name, age and the verified mark, a quiet subtitle, the bio, a calm stats row and small neutral
 * tags for interests and mood.
 */
export function ProfileCard(p: ProfileCardProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const highlight = new Set(p.highlightInterestIds ?? []);
  const interestTags = [
    ...p.interests.map((i) => ({
      key: i.id,
      label: localized(i.name, i18n.language),
      highlight: highlight.has(i.id),
    })),
    ...(p.customInterests ?? []).map((text) => ({
      key: `custom:${text}`,
      label: text,
      highlight: false,
    })),
  ];
  // Counts only when they mean something: a row of zeros says nothing. Reliability always has a tier.
  const stats: [string, string][] = [
    ...(p.stats.eventsAttended > 0
      ? [[t('profile.eventsAttended'), String(p.stats.eventsAttended)] as [string, string]]
      : []),
    ...(p.stats.eventsHosted > 0
      ? [[t('profile.eventsHosted'), String(p.stats.eventsHosted)] as [string, string]]
      : []),
    [t('profile.reliability'), t(`profile.tiers.${p.stats.reliabilityTier}`)],
  ];
  return (
    <View style={styles.wrap}>
      {p.photos.length > 0 ? <PhotoPager photos={p.photos} /> : null}
      <View style={styles.identity}>
        <View style={styles.titleRow}>
          <Text variant="title" style={styles.shrink}>
            {p.displayName}
          </Text>
          {p.age !== undefined && p.age !== null ? (
            <Text
              variant="title"
              tone="muted"
              accessibilityRole="text"
              style={styles.age}
              testID="profile-age"
            >
              {t('profile.age', { age: p.age })}
            </Text>
          ) : null}
          {p.verified ? (
            <View accessible accessibilityRole="image" accessibilityLabel={t('profile.verified')}>
              <Icon icon={BadgeCheck} size={20} color={theme.colors.text} />
            </View>
          ) : null}
        </View>
        {p.subtitle ? <Text tone="muted">{p.subtitle}</Text> : null}
        {p.hostRating && p.hostRating.average !== null ? (
          <Text variant="label" testID="host-rating">
            {t('profile.hostRating', {
              rating: p.hostRating.average.toFixed(1),
              count: p.hostRating.count,
            })}
          </Text>
        ) : null}
      </View>
      <Text tone={p.bio ? 'default' : 'muted'} style={styles.bio}>
        {p.bio || t('profile.noBio')}
      </Text>
      <View
        style={[styles.stats, { borderColor: theme.colors.border, borderRadius: theme.radii.md }]}
      >
        {stats.map(([label, value], i) => (
          <View
            key={label}
            accessible
            accessibilityLabel={`${label}: ${value}`}
            style={[
              styles.stat,
              i > 0
                ? {
                    borderLeftWidth: StyleSheet.hairlineWidth,
                    borderLeftColor: theme.colors.border,
                  }
                : null,
            ]}
          >
            <Text variant="heading" numberOfLines={2} style={styles.center}>
              {value}
            </Text>
            <Text variant="caption" tone="muted" style={styles.center}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      {interestTags.length > 0 ? (
        <TagSection title={t('profile.interests')} tags={interestTags} />
      ) : null}
      {p.vibeTags.length > 0 ? (
        <TagSection
          title={t('profile.vibes')}
          tags={p.vibeTags.map((v) => ({
            key: v.id,
            label: localized(v.name, i18n.language),
            highlight: false,
          }))}
        />
      ) : null}
    </View>
  );
}

/** Full-width photos, one per page, with dots showing where you are. */
function PhotoPager({ photos }: { photos: MediaVariants[] }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const w = width || FALLBACK_WIDTH;
  const height = Math.round((w * 5) / 4);
  return (
    <View
      style={[
        styles.pager,
        { borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface },
      ]}
      onLayout={(e) => {
        setWidth(Math.round(e.nativeEvent.layout.width));
      }}
    >
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        accessibilityRole="list"
        scrollEventThrottle={32}
        onScroll={(e) => {
          const next = Math.round(e.nativeEvent.contentOffset.x / w);
          if (next !== page) setPage(Math.max(0, Math.min(photos.length - 1, next)));
        }}
      >
        {photos.map((ph, i) => (
          <Image
            key={ph.md}
            source={{ uri: ph.lg }}
            placeholder={{ uri: ph.sm }}
            style={{ width: w, height }}
            contentFit="cover"
            accessibilityIgnoresInvertColors
            accessible
            accessibilityLabel={t('a11y.photoSlot', { number: i + 1, total: photos.length })}
          />
        ))}
      </ScrollView>
      {photos.length > 1 ? (
        <View
          style={styles.dots}
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {photos.map((ph, i) => (
            <View
              key={ph.md}
              style={[
                styles.dot,
                i === page
                  ? { backgroundColor: media.text, width: 18 }
                  : { backgroundColor: media.dot },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function TagSection({
  title,
  tags,
}: {
  title: string;
  tags: { key: string; label: string; highlight: boolean }[];
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text variant="label" tone="muted" accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.tags}>
        {tags.map((tag) => (
          <View
            key={tag.key}
            style={[
              styles.tag,
              {
                borderRadius: theme.radii.sm,
                backgroundColor: theme.colors.surface,
                borderColor: tag.highlight ? theme.colors.primary : theme.colors.border,
              },
            ]}
          >
            <Text variant="caption" tone={tag.highlight ? 'primary' : 'default'}>
              {tag.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  pager: { overflow: 'hidden' },
  dots: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  identity: { gap: 4 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8 },
  shrink: { flexShrink: 1 },
  age: { fontWeight: '400' },
  stats: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth },
  stat: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, gap: 2, alignItems: 'center' },
  center: { textAlign: 'center' },
  section: { gap: 8 },
  bio: { fontSize: 16, lineHeight: 24 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 5 },
});
