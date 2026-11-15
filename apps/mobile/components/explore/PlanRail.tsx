import type { EventSummary } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { localized } from '../../src/features/catalog/api';
import { formatWhen } from '../../src/features/events/format';
import { useTheme } from '../../src/theme/theme';
import { People } from '../icons';
import { CategoryPill } from '../CategoryPill';
import { PlanArt } from '../PlanArt';
import { AnimatedPressable, FadeIn, IconText, staggerDelay, Text, usePressScale } from '../ui';

const TILE = 152;
const GAP = 12;

/**
 * A themed sideways row of plans (Explore D-155, Plans D-158): a heading, then poster tiles that snap one by one as
 * you swipe. Runs edge to edge; each tile is a labelled button.
 */
export function PlanRail({
  railKey,
  title,
  items,
  gutter,
  onOpen,
}: {
  railKey: string;
  title: string;
  items: EventSummary[];
  gutter: number;
  onOpen: (item: EventSummary) => void;
}) {
  return (
    <View style={styles.wrap} testID={`rail-${railKey}`}>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      <FlatList
        data={items}
        horizontal
        // A tap on a card opens it even while the keyboard is up (search results), instead of only closing it.
        keyboardShouldPersistTaps="handled"
        keyExtractor={(i) => i.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={TILE + GAP}
        decelerationRate="fast"
        style={{ marginHorizontal: -gutter }}
        contentContainerStyle={{ paddingHorizontal: gutter, gap: GAP }}
        renderItem={({ item, index }) => (
          <FadeIn delay={staggerDelay(index, 50, 4)} distance={8}>
            <PlanTile
              item={item}
              railKey={railKey}
              onOpen={() => {
                onOpen(item);
              }}
            />
          </FadeIn>
        )}
      />
    </View>
  );
}

function PlanTile({
  item,
  railKey,
  onOpen,
}: {
  item: EventSummary;
  railKey: string;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const press = usePressScale(0.96);
  const when = formatWhen(item.startsAt, i18n.language, item.timezone);
  const going = t('explore.going', { count: item.goingCount });
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={[
        item.title,
        item.category && !item.mystery ? localized(item.category.name, i18n.language) : null,
        when,
        going,
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint={t('a11y.opensScreen', { screen: item.title })}
      onPress={onOpen}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      testID={`tile-${railKey}-${item.slug}`}
      style={[styles.tile, press.scaleStyle]}
    >
      <View
        style={[
          styles.poster,
          { backgroundColor: theme.colors.surface, borderRadius: theme.radii.md },
        ]}
      >
        {item.cover ? (
          <Image
            source={{ uri: item.cover.md }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessible={false}
            importantForAccessibility="no"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <PlanArt category={item.mystery ? null : item.category} iconSize={30} />
        )}
        {item.mystery ? null : (
          <View style={styles.tag}>
            <CategoryPill category={item.category} testID={`category-${railKey}-${item.slug}`} />
          </View>
        )}
      </View>
      <Text variant="label" numberOfLines={2}>
        {item.title}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {when}
      </Text>
      <IconText icon={People}>{going}</IconText>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  tile: { width: TILE, gap: 6 },
  poster: { width: TILE, height: 190, overflow: 'hidden' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  tag: { position: 'absolute', left: 8, top: 8, right: 8 },
});
