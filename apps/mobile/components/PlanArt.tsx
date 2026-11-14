import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import {
  Book,
  Bowl,
  Compass,
  Dice,
  type GlyphIcon,
  Leaf,
  Sun,
  TreePine,
  Waves,
  Zap,
} from './icons';
import { Icon } from './ui';

/** Deep, brand-friendly gradients (dark enough for white text over them). */
const PALETTES: readonly [string, string, string][] = [
  ['#3E6B47', '#1F3A26', '#0B130E'],
  ['#6A4F9A', '#3B2A5C', '#120C1F'],
  ['#3A679C', '#1E3A5F', '#0A1422'],
  ['#9A4A57', '#5C2A33', '#1F0C10'],
  ['#55806A', '#2F4A3A', '#0E1A14'],
  ['#86703E', '#4A3B1E', '#18120A'],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A glyph that fits the plan's category, by keyword; the compass otherwise. */
function glyphFor(category: string | null | undefined): GlyphIcon {
  const c = (category ?? '').toLowerCase();
  if (/food|chai|biryani|caf|coffee|cook|brunch|dessert|bak|restaurant|street/.test(c)) return Bowl;
  if (/game|quiz|board|poker|chess/.test(c)) return Dice;
  if (/book|read|writ|study|learn|language/.test(c)) return Book;
  if (/swim|water|lake|beach|kayak/.test(c)) return Waves;
  if (/trek|hik|outdoor|nature|bird|garden|camp/.test(c)) return TreePine;
  if (/run|cycl|sport|fit|yoga|gym|cricket|football|badminton|boulder|dance/.test(c)) return Zap;
  if (/sun|morning|walk/.test(c)) return Sun;
  if (/wellness|mind|spiritual|sustain/.test(c)) return Leaf;
  return Compass;
}

/**
 * Artwork for a plan without a cover photo (D-198): one look everywhere (cards, rails, the plan screen),
 * a lit three-stop gradient picked from the plan id, a soft pool of light (no line patterns) and a quiet
 * icon that fits its category. The accent stays off it: the card's own action carries the accent.
 */
export function PlanArt({
  seed,
  category,
  iconSize = 40,
}: {
  seed: string;
  /** The category's slug or name, to pick a fitting icon. */
  category?: string | null;
  iconSize?: number;
}) {
  const palette = PALETTES[hash(seed) % PALETTES.length] ?? PALETTES[0];
  return (
    <LinearGradient
      colors={palette ?? ['#3E6B47', '#1F3A26', '#0B130E']}
      locations={[0, 0.45, 1]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={[StyleSheet.absoluteFill, styles.center]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.light} />
      <Icon
        icon={glyphFor(category)}
        size={iconSize}
        color="rgba(255,255,255,0.82)"
        strokeWidth={1.4}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  light: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    left: -110,
    top: -170,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
});
