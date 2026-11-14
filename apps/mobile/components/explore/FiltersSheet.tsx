import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { localized, useInterests, useVibeTags } from '../../src/features/catalog/api';
import {
  DEFAULT_FILTERS,
  type DiscoverFilters,
  TOGGLES,
} from '../../src/features/discovery/filters';
import { Sheet } from '../DateTimeFields';
import { MultiSelectField } from '../MultiSelectField';
import { SegmentedTabs } from '../SegmentedTabs';
import { SelectField } from '../SelectField';
import { Button, SwitchRow, Text } from '../ui';

const RADII = ['2', '5', '10', '25', '50'] as const;
const SORTS = ['recommended', 'soonest', 'nearest'] as const;

/**
 * Explore filters as a bottom sheet (D-198), the booking-app pattern: grouped sections (sort, distance,
 * what it's good for, category, mood), dropdowns instead of chip walls, and a pinned Reset / Show plans
 * footer. Changes apply as they are made; Show plans closes the sheet.
 */
export function FiltersSheet({
  filters,
  onChange,
  onClose,
}: {
  filters: DiscoverFilters;
  onChange: (next: DiscoverFilters) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const interests = useInterests();
  const vibes = useVibeTags();
  const set = <K extends keyof DiscoverFilters>(k: K, v: DiscoverFilters[K]): void => {
    onChange({ ...filters, [k]: v });
  };
  return (
    <Sheet
      title={t('discover.filters')}
      onClose={onClose}
      testID="filters-panel"
      footer={
        <>
          <View style={styles.grow}>
            <Button
              label={t('discover.clearFilters')}
              variant="ghost"
              onPress={() => {
                onChange(DEFAULT_FILTERS);
              }}
              testID="clear-filters"
            />
          </View>
          <View style={styles.grow}>
            <Button label={t('discover.showPlans')} onPress={onClose} testID="filters-apply" />
          </View>
        </>
      }
    >
      <Section title={t('discover.sortLabel')}>
        <SegmentedTabs
          tabs={SORTS.map((s) => ({ key: s, label: t(`discover.sort_${s}`) }))}
          value={filters.sort}
          onChange={(s) => {
            set('sort', s);
          }}
          testIDPrefix="sort"
        />
      </Section>
      <Section title={t('discover.distanceLabel')}>
        <SegmentedTabs
          tabs={RADII.map((km) => ({ key: km, label: t('discover.km', { km }) }))}
          value={String(filters.radiusKm) as (typeof RADII)[number]}
          onChange={(km) => {
            set('radiusKm', Number(km));
          }}
          testIDPrefix="radius"
        />
      </Section>
      <Section title={t('discover.goodFor')}>
        <View>
          {TOGGLES.map((k) => (
            <SwitchRow
              key={k}
              label={t(`discover.${k}`)}
              value={filters[k]}
              onChange={(v) => {
                set(k, v);
              }}
              testID={`toggle-${k}`}
            />
          ))}
        </View>
      </Section>
      <SelectField
        label={t('discover.category')}
        placeholder={t('discover.anyCategory')}
        options={[
          { id: 'any', label: t('discover.anyCategory') },
          ...(interests.data?.items ?? []).map((i) => ({
            id: i.id,
            label: localized(i.name, i18n.language),
          })),
        ]}
        value={filters.categoryId ?? 'any'}
        onChange={(id) => {
          set('categoryId', id === 'any' ? null : id);
        }}
        testID="filter-category"
      />
      <MultiSelectField
        label={t('discover.vibes')}
        placeholder={t('discover.anyVibe')}
        options={(vibes.data?.items ?? []).map((v) => ({
          id: v.id,
          label: localized(v.name, i18n.language),
        }))}
        selected={filters.vibeTagIds}
        onChange={(ids) => {
          set('vibeTagIds', ids);
        }}
        max={5}
        searchFrom={99}
        testID="filter-vibe"
      />
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="overline" tone="muted" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  grow: { flex: 1 },
});
