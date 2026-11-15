import { type CategoryHue, media } from '@touchgrass/shared';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../src/theme/theme';
import { Icon, type GlyphIcon } from './Icon';
import { Text } from './Text';

export type PillTone = 'primary' | 'accent' | 'glass' | 'dark';

/**
 * Small non-interactive label ("PLAN", "Women only", "100 m away"). Decorative inside cards whose own label
 * already says the same thing, so callers hide it from screen readers there.
 */
export function Pill({
  label,
  tone = 'glass',
  icon,
  hue,
  testID,
}: {
  label: string;
  tone?: PillTone;
  icon?: GlyphIcon;
  /** A category hue (D-204): tinted background, light label, icon in the solid hue. Overrides `tone`. */
  hue?: CategoryHue;
  testID?: string;
}) {
  const theme = useTheme();
  const look = {
    primary: { bg: theme.colors.primary, fg: theme.colors.onPrimary, border: theme.colors.primary },
    accent: { bg: theme.colors.accent, fg: theme.colors.onAccent, border: theme.colors.accent },
    glass: { bg: theme.colors.surfaceAlt, fg: theme.colors.text, border: theme.colors.border },
    // Over photos: a dark scrim keeps light text readable on any image.
    dark: { bg: media.chip, fg: media.text, border: media.chipBorder },
  }[tone];
  const fg = hue ? hue.text : look.fg;
  const bg = hue ? hue.soft : look.bg;
  const border = hue ? hue.soft : look.border;
  const iconColor = hue ? hue.solid : look.fg;
  return (
    <View
      testID={testID}
      style={[
        styles.pill,
        { backgroundColor: bg, borderColor: border, borderRadius: theme.radii.pill },
      ]}
    >
      {icon ? (
        <Icon
          icon={icon}
          size={12}
          color={iconColor}
          accent={hue ? iconColor : undefined}
          strokeWidth={2.5}
        />
      ) : null}
      <Text variant="caption" numberOfLines={1} style={{ color: fg, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
