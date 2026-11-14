import { type FeedWhen, type GeoPoint } from '@touchgrass/shared';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { FreeNowStrip } from '../../../components/engagement/FreeNowStrip';
import { StoryTray } from '../../../components/stories/StoryTray';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Search } from '../../../components/icons';
import { BRAND } from '@touchgrass/shared';
import { Avatar } from '../../../components/Avatar';
import { BrandLogo } from '../../../components/BrandLogo';
import { FiltersSheet } from '../../../components/explore/FiltersSheet';
import { DiscoverMap } from '../../../components/DiscoverMap';
import { FeedSkeleton } from '../../../components/FeedSkeleton';
import { AllPlansRail } from '../../../components/explore/AllPlansRail';
import { HeroCarousel } from '../../../components/explore/HeroCarousel';
import { PlanRail } from '../../../components/explore/PlanRail';
import { SegmentedTabs } from '../../../components/SegmentedTabs';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  OfflineState,
  Screen,
  Text,
} from '../../../components/ui';
import { useMe } from '../../../src/features/me/api';
import { useTheme } from '../../../src/theme/theme';
import { useFeed, useFeedClick } from '../../../src/features/discovery/api';
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  type DiscoverFilters,
} from '../../../src/features/discovery/filters';
import { buildSections } from '../../../src/features/discovery/sections';
import { flatten } from '../../../src/features/social/api';
import { useIsOffline } from '../../../src/hooks/use-is-offline';
import { errorMessage } from '../../../src/lib/errors';
import { NotificationBell } from '../../../components/NotificationBell';
import { useFlag } from '../../../src/features/app-config/use-flag';

const WHENS: FeedWhen[] = ['any', 'tonight', 'tomorrow', 'weekend'];

/**
 * Explore / Discover (F-DSC-01..08), in the matcha layout (D-144): brand header, search and list/map toggle,
 * the Free now radar, one scrolling row of filter chips, and photo-led plan cards.
 */
export default function DiscoverScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const me = useMe();
  const offline = useIsOffline();
  const [filters, setFilters] = useState<DiscoverFilters>(DEFAULT_FILTERS);
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [locationAsked, setLocationAsked] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  const mapEnabled = useFlag('map_view');
  const feed = useFeed(filters, location);
  const click = useFeedClick();

  useEffect(() => {
    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      setLocationAsked(perm.granted || !perm.canAskAgain);
      if (!perm.granted) return;
      const pos = await Location.getLastKnownPositionAsync();
      if (pos) setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    })();
  }, []);

  const askLocation = async (): Promise<void> => {
    const perm = await Location.requestForegroundPermissionsAsync();
    setLocationAsked(true);
    if (!perm.granted) return;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
  };

  const set = <K extends keyof DiscoverFilters>(key: K, value: DiscoverFilters[K]): void => {
    setFilters((f) => ({ ...f, [key]: value }));
  };
  const firstPage = feed.data?.pages[0];
  const items = flatten(feed.data);
  const openEvent = (id: string, position: number | null): void => {
    if (firstPage && position !== null)
      click.mutate({ requestId: firstPage.requestId, eventId: id, position });
    router.push({ pathname: '/events/[id]', params: { id } });
  };
  const nFilters = activeFilterCount(filters);
  const weather = firstPage?.weather;

  let body;
  if (feed.isPending) body = <FeedSkeleton label={t('states.loading')} />;
  else if (feed.isError)
    body = offline ? (
      <OfflineState onRetry={() => void feed.refetch()} />
    ) : (
      <ErrorState
        message={errorMessage(t, feed.error) ?? undefined}
        onRetry={() => void feed.refetch()}
      />
    );
  else if (items.length === 0)
    body = (
      <EmptyState
        body={t('discover.empty')}
        // With the filter panel open its own "Clear filters" is right there; offer plotting instead.
        actionLabel={nFilters > 0 && !showFilters ? t('discover.clearFilters') : t('events.plot')}
        onAction={() => {
          if (nFilters > 0 && !showFilters) setFilters(DEFAULT_FILTERS);
          else router.push('/plot');
        }}
      />
    );
  else {
    // Everything scrolls sideways (D-160): carousel, themed rows, then all plans as one row of cards.
    // Filters narrow what goes into the rows; the layout stays the same.
    const sections = buildSections(items);
    const positionOf = (id: string): number => items.findIndex((i) => i.id === id);
    body = (
      <>
        {sections.hero.length > 0 ? (
          <HeroCarousel
            items={sections.hero}
            gutter={GUTTER}
            onOpen={(item) => {
              openEvent(item.id, positionOf(item.id));
            }}
          />
        ) : null}
        {sections.rails.map((rail) => (
          <PlanRail
            key={rail.key}
            railKey={rail.key}
            title={t(`explore.rails.${rail.key}`)}
            items={rail.items}
            gutter={GUTTER}
            onOpen={(item) => {
              openEvent(item.id, positionOf(item.id));
            }}
          />
        ))}
        <AllPlansRail
          items={items}
          gutter={GUTTER}
          onOpen={(item, position) => {
            openEvent(item.id, position);
          }}
          onEnd={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          loadingMore={feed.isFetchingNextPage}
        />
      </>
    );
  }

  const myName = me.data?.displayName ?? t('nav.profile');
  const searchRow = (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('discover.search')}
        onPress={() => {
          router.push('/search');
        }}
        testID="open-search"
        style={[
          styles.search,
          {
            minHeight: 44,
            backgroundColor: theme.colors.surfaceAlt,
            borderColor: theme.colors.border,
            borderRadius: theme.radii.pill,
          },
        ]}
      >
        <Icon icon={Search} size={16} color={theme.colors.textMuted} />
        <Text tone="muted" numberOfLines={1}>
          {t('discover.search')}
        </Text>
      </Pressable>
      {mapEnabled ? (
        <SegmentedTabs
          tabs={[
            { key: 'list', label: t('discover.list') },
            { key: 'map', label: t('discover.map') },
          ]}
          value={view}
          onChange={setView}
        />
      ) : null}
    </View>
  );

  // Map view (D-153): the map fills the whole screen, with search and the list/map switch floating on top.
  if (view === 'map' && mapEnabled)
    return (
      <View
        style={[styles.full, { backgroundColor: theme.colors.background }]}
        testID="discover-screen"
      >
        <DiscoverMap
          center={location ?? firstPage?.center ?? { lat: 17.385, lng: 78.4867 }}
          filters={filters}
          onOpen={(pin) => {
            openEvent(pin.id, null);
          }}
          overlay={searchRow}
        />
      </View>
    );

  return (
    <Screen testID="discover-screen">
      <View style={styles.header}>
        <View style={styles.grow}>
          <View style={styles.brandRow}>
            <BrandLogo size={30} decorative />
            <Text variant="title" accessibilityRole="header" style={styles.brand}>
              {BRAND.name}
              <Text variant="title" style={{ color: theme.colors.primary }}>
                .
              </Text>
            </Text>
          </View>
          <Text variant="caption" tone="primary">
            {BRAND.tagline}
          </Text>
        </View>
        <NotificationBell />
        <IconButton
          icon={<Avatar photo={me.data?.photos[0]?.urls ?? null} name={myName} size={34} />}
          label={t('nav.profile')}
          onPress={() => {
            router.push('/profile');
          }}
          testID="open-profile"
        />
      </View>
      {searchRow}
      <StoryTray />
      <FreeNowStrip />
      {weather ? (
        <Text variant="caption" tone="muted" testID="weather-chip">
          {t('discover.weatherNow', {
            temp: Math.round(weather.tempC),
            condition: t(`discover.conditions.${weather.condition}`),
          })}
        </Text>
      ) : null}
      {!location && !locationAsked ? (
        <Card>
          <Text tone="muted">{t('discover.locationPrompt')}</Text>
          <Button
            label={t('discover.useLocation')}
            onPress={() => void askLocation()}
            testID="use-location"
          />
        </Card>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        testID="discover-chips"
      >
        {/* Filters first, with a count; the full set lives in a bottom sheet (D-198). */}
        <Button
          label={
            nFilters > 0 ? `${t('discover.filters')} (${String(nFilters)})` : t('discover.filters')
          }
          variant={nFilters > 0 ? 'primary' : 'secondary'}
          accessibilityState={{ expanded: showFilters }}
          onPress={() => {
            setShowFilters(true);
          }}
          testID="more-filters"
        />
        {WHENS.map((w) => (
          <Chip
            key={w}
            kind="radio"
            label={t(`discover.${w}`)}
            selected={filters.when === w}
            onToggle={() => {
              set('when', w);
            }}
            testID={`when-${w}`}
          />
        ))}
      </ScrollView>
      {showFilters ? (
        <FiltersSheet
          filters={filters}
          onChange={setFilters}
          onClose={() => {
            setShowFilters(false);
          }}
        />
      ) : null}
      {body}
    </Screen>
  );
}

/** The Screen's side padding: the carousel and rails run edge to edge past it. */
const GUTTER = 20;

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brand: { fontSize: 22, lineHeight: 28, letterSpacing: -0.5 },
  search: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chips: { gap: 10, alignItems: 'center', paddingVertical: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  grow: { flexGrow: 1, flexShrink: 1 },
  panel: { gap: 16 },
  full: { flex: 1 },
});
