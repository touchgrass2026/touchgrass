import type { MapCluster, MapPin } from '@touchgrass/shared';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Circle, type Region } from 'react-native-maps';
import { useMapPins } from '../src/features/discovery/api';
import { type DiscoverFilters, regionToBox } from '../src/features/discovery/filters';
import { formatWhen } from '../src/features/events/format';
import { useTheme } from '../src/theme/theme';
import { localized } from '../src/features/catalog/api';
import { MapPin as PinIcon, People } from './icons';
import { CategoryPill } from './CategoryPill';
import { ClusterMarker, MYSTERY_AREA, PlanMarker } from './PlanMarker';
import { FadeIn, Icon, staggerDelay, Text, Pressable } from './ui';

/**
 * Map view (F-DSC-03), full screen (D-153). Pins sit on each plan's public centre; unrevealed mystery plans are
 * drawn as their 2 km circle, never a point. Dense areas come back clustered; tapping a cluster zooms in.
 * Search and the list/map switch float on top (`overlay`); the plans in view are a swipeable row of cards at
 * the bottom, so screen-reader users never depend on the map itself.
 */
/** Google Maps style (Android): hide businesses, attractions and transit so plans are the only pins. */
const PLAIN_MAP = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

export function DiscoverMap({
  center,
  filters,
  onOpen,
  overlay,
}: {
  center: { lat: number; lng: number };
  filters: DiscoverFilters;
  onOpen: (pin: MapPin) => void;
  overlay?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const initial: Region = {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: 0.12,
    longitudeDelta: 0.12,
  };
  const [box, setBox] = useState(() => regionToBox(initial));
  const [selected, setSelected] = useState<string | null>(null);
  const q = useMapPins(box, filters);
  // "Biryani crawl, Food, Sat 4 Nov, 6:30 pm": the category is read out, not only shown as a colour.
  const pinLabel = (p: MapPin): string =>
    [
      p.title,
      p.mystery
        ? t('events.mystery')
        : p.category
          ? localized(p.category.name, i18n.language)
          : null,
      formatWhen(p.startsAt, i18n.language),
    ]
      .filter(Boolean)
      .join(', ');

  const zoomInto = (c: MapCluster): void => {
    map.current?.animateToRegion({
      latitude: c.center.lat,
      longitude: c.center.lng,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });
  };

  return (
    <View style={styles.wrap} testID="discover-map">
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        userInterfaceStyle={theme.scheme}
        // A plain map: only our plans are pinned, not Google's shops, restaurants and bus stops.
        customMapStyle={PLAIN_MAP}
        showsPointsOfInterests={false}
        showsBuildings={false}
        showsIndoors={false}
        toolbarEnabled={false}
        initialRegion={initial}
        onRegionChangeComplete={(r: Region) => {
          setBox(regionToBox(r));
        }}
        accessibilityLabel={t('discover.map')}
        testID="discover-mapview"
      >
        {q.data?.pins.map((p) =>
          p.radiusMeters > 0 ? (
            <Circle
              key={p.id}
              center={{ latitude: p.center.lat, longitude: p.center.lng }}
              radius={p.radiusMeters}
              strokeColor={MYSTERY_AREA.stroke}
              fillColor={MYSTERY_AREA.fill}
            />
          ) : null,
        )}
        {q.data?.pins.map((p) => (
          <PlanMarker
            key={`m-${p.id}`}
            coordinate={{ latitude: p.center.lat, longitude: p.center.lng }}
            category={p.category}
            mystery={p.mystery}
            selected={selected === p.id}
            title={p.title}
            description={formatWhen(p.startsAt, i18n.language)}
            onPress={() => {
              setSelected(p.id);
            }}
            onCalloutPress={() => {
              onOpen(p);
            }}
            accessibilityLabel={pinLabel(p)}
            testID={`marker-${p.slug}`}
          />
        ))}
        {q.data?.clusters.map((c) => (
          <ClusterMarker
            key={`c-${String(c.center.lat)}-${String(c.center.lng)}`}
            coordinate={{ latitude: c.center.lat, longitude: c.center.lng }}
            count={c.count}
            onPress={() => {
              zoomInto(c);
            }}
            accessibilityLabel={t('discover.clusterLabel', { count: c.count })}
          />
        ))}
      </MapView>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        {overlay ? (
          <View
            style={[
              styles.glass,
              {
                backgroundColor: theme.colors.background,
                borderColor: theme.colors.border,
                borderRadius: theme.radii.lg,
              },
            ]}
          >
            {overlay}
          </View>
        ) : null}
        {q.data?.truncated ? (
          <View
            style={[
              styles.notice,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <Text variant="caption" tone="muted">
              {t('discover.mapTruncated')}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.bottom} pointerEvents="box-none">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
        >
          {q.data?.clusters.map((c) => (
            <Pressable
              key={`l-${String(c.center.lat)}-${String(c.center.lng)}`}
              accessibilityRole="button"
              accessibilityLabel={t('discover.clusterLabel', { count: c.count })}
              onPress={() => {
                zoomInto(c);
              }}
              style={[
                styles.card,
                styles.clusterCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <Icon icon={People} size={16} color={theme.colors.primary} />
              <Text variant="label">{t('discover.clusterLabel', { count: c.count })}</Text>
            </Pressable>
          ))}
          {q.data?.pins.map((p, i) => (
            <FadeIn key={`l-${p.id}`} delay={staggerDelay(i, 50)}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={pinLabel(p)}
                accessibilityState={{ selected: selected === p.id }}
                testID={`pin-${p.slug}`}
                onPress={() => {
                  onOpen(p);
                }}
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.colors.surface,
                    // The card of the pin you tapped carries the same lime ring as its pin.
                    borderColor: selected === p.id ? theme.colors.primary : theme.colors.border,
                    borderWidth: selected === p.id ? 2 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                {p.mystery ? null : <CategoryPill category={p.category} />}
                <Text variant="label" numberOfLines={2}>
                  {p.title}
                </Text>
                <View style={styles.when}>
                  <Icon icon={PinIcon} size={14} color={theme.colors.textMuted} />
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {formatWhen(p.startsAt, i18n.language)}
                  </Text>
                </View>
              </Pressable>
            </FadeIn>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  top: { position: 'absolute', left: 12, right: 12, top: 0, gap: 8 },
  glass: { padding: 8, borderWidth: StyleSheet.hairlineWidth, opacity: 0.97 },
  notice: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 12 },
  rail: { gap: 10, paddingHorizontal: 12 },
  card: {
    width: 220,
    minHeight: 64,
    padding: 12,
    gap: 6,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  clusterCard: { width: 'auto', flexDirection: 'row', alignItems: 'center' },
  when: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
