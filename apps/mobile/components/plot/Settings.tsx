import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../../src/theme/theme';
import { ChevronRight } from '../icons';
import { Card, type GlyphIcon, Icon, Text } from '../ui';

/**
 * One grouped card of setting rows (D-199): hairline dividers inset by the card's padding. The last row's
 * divider is tucked under the card's own edge so the group never shows a double line.
 */
export function SettingsGroup({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Card style={styles.group} testID={testID}>
      <View style={styles.tuck}>{children}</View>
    </Card>
  );
}

/** The rounded square an icon sits in at the start of a row. */
export function RowIcon({ icon }: { icon: GlyphIcon }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.iconWrap,
        { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.sm },
      ]}
    >
      {/* Ink-only icons: the accent is kept for the main action and selected states. */}
      <Icon icon={icon} size={18} color={theme.colors.text} accent={theme.colors.text} />
    </View>
  );
}

/** A row's error line, lined up under its label. */
export function RowError({ message, testID }: { message: string; testID?: string }) {
  return (
    <Text
      variant="caption"
      tone="danger"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={styles.error}
      testID={testID}
    >
      {message}
    </Text>
  );
}

export interface SettingRowProps {
  icon: GlyphIcon;
  label: string;
  /** The current value; `placeholder` styles it as not set yet. */
  value: string;
  placeholder?: boolean;
  onPress: () => void;
  error?: string | null;
  testID?: string;
  /** On the value text, for tests that read the current choice. */
  valueTestID?: string;
  /** Replaces the right chevron (e.g. a chevron that turns when a section expands). */
  trailing?: ReactNode;
  accessibilityHint?: string;
  /** Set for rows that expand in place instead of opening a sheet. */
  expanded?: boolean;
}

/**
 * Icon, label, the current value in muted text and a chevron; the whole row opens a sheet to change it.
 * Screen readers hear "label, value" (and the error, when there is one).
 */
export function SettingRow({
  icon,
  label,
  value,
  placeholder = false,
  onPress,
  error,
  testID,
  valueTestID,
  trailing,
  accessibilityHint,
  expanded,
}: SettingRowProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={expanded === undefined ? `${label}, ${value}` : label}
      accessibilityValue={expanded === undefined ? undefined : { text: value }}
      accessibilityHint={
        error ? `${error}. ${t('common.choose')}` : (accessibilityHint ?? t('common.choose'))
      }
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: theme.minTouchTarget + 12,
          borderBottomColor: theme.colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.line}>
        <RowIcon icon={icon} />
        <Text style={styles.label}>{label}</Text>
        <Text
          tone={error ? 'danger' : 'muted'}
          numberOfLines={2}
          style={[styles.value, placeholder && !error ? { color: theme.colors.textMuted } : null]}
          testID={valueTestID}
        >
          {value}
        </Text>
        {trailing ?? <Icon icon={ChevronRight} size={16} color={theme.colors.textMuted} />}
      </View>
      {error ? <RowError message={error} testID={testID ? `${testID}-error` : undefined} /> : null}
    </Pressable>
  );
}

/** A plain row container for rows that hold their own controls (e.g. date and time pills). */
export function SettingBlock({ children, testID }: { children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.row,
        { minHeight: theme.minTouchTarget + 12, borderBottomColor: theme.colors.border },
      ]}
    >
      {children}
    </View>
  );
}

/** Small print under a group (iOS settings style). */
export function GroupNote({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text variant="caption" tone="muted" style={styles.note} testID={testID}>
      {children}
    </Text>
  );
}

const ICON = 32;
const GAP = 12;

const styles = StyleSheet.create({
  group: { padding: 0, paddingHorizontal: 16, gap: 0 },
  tuck: { marginBottom: -StyleSheet.hairlineWidth },
  row: {
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: GAP },
  iconWrap: { width: ICON, height: ICON, alignItems: 'center', justifyContent: 'center' },
  label: { flexShrink: 1 },
  value: { flex: 1, textAlign: 'right' },
  error: { paddingLeft: ICON + GAP },
  note: { paddingHorizontal: 4, marginTop: -12 },
});
