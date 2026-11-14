import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../src/theme/theme';
import { FieldShell, Sheet } from './DateTimeFields';
import { Grid } from './icons';
import { type PickOption, PickList } from './PickList';
import { Button, Text } from './ui';

export interface MultiSelectFieldProps {
  label: string;
  /** Shown in the field before anything is chosen. */
  placeholder: string;
  options: PickOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  searchLabel?: string;
  error?: string | null;
  testID?: string;
  /** Lets people type their own option when it is not in the list; return the new option's id. */
  onCreate?: (text: string) => string;
  /** Hide the search box for short lists (default: search from 9 options). */
  searchFrom?: number;
}

/**
 * Several choices from a long list (D-198), like a booking app's filter: a field that shows what is picked as
 * small tags, opening a sheet with a searchable checklist and Done. Replaces walls of chips.
 */
export function MultiSelectField({
  label,
  placeholder,
  options,
  selected,
  onChange,
  max,
  searchLabel,
  error,
  testID,
  onCreate,
  searchFrom = 9,
}: MultiSelectFieldProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const chosen = selected.flatMap((id) => {
    const o = options.find((x) => x.id === id);
    return o ? [o] : [];
  });
  const display =
    chosen.length === 0
      ? placeholder
      : chosen.length <= 2
        ? chosen.map((o) => o.label).join(', ')
        : t('common.selectedSummary', {
            first: chosen
              .slice(0, 2)
              .map((o) => o.label)
              .join(', '),
            count: chosen.length - 2,
          });
  return (
    <View style={styles.wrap}>
      <FieldShell
        label={max ? `${label} (${String(chosen.length)}/${String(max)})` : label}
        display={display}
        error={error}
        hint={t('common.choose')}
        icon={Grid}
        testID={testID}
        onOpen={() => {
          setOpen(true);
        }}
      />
      {chosen.length > 2 ? (
        <View style={styles.tags} testID={testID ? `${testID}-tags` : undefined}>
          {chosen.map((o) => (
            <View
              key={o.id}
              style={[
                styles.tag,
                { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.pill },
              ]}
            >
              <Text variant="caption">{o.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {open ? (
        <Sheet
          title={label}
          onClose={() => {
            setOpen(false);
          }}
          testID={testID ? `${testID}-sheet` : undefined}
        >
          <PickList
            label={label}
            searchLabel={searchLabel}
            mode="multi"
            max={max}
            options={options}
            selected={selected}
            onChange={onChange}
            testIDPrefix={testID ?? 'multi'}
            searchFrom={searchFrom}
            onCreate={
              onCreate
                ? (text) => {
                    const id = onCreate(text);
                    if (!selected.includes(id) && (max === undefined || selected.length < max))
                      onChange([...selected, id]);
                  }
                : undefined
            }
          />
          <Button
            label={t('common.done')}
            onPress={() => {
              setOpen(false);
            }}
            testID={testID ? `${testID}-done` : undefined}
          />
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 4 },
});
