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
const PALETTES: readonly [string, string][] = [
  ['#1F3A26', '#0B130E'],
  ['#3B2A5C', '#120C1F'],
  ['#1E3A5F', '#0A1422'],
  ['#5C2A33', '#1F0C10'],
  ['#2F4A3A', '#0E1A14'],
  ['#4A3B1E', '#18120A'],
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
 * a gradient picked from the plan id, soft rings and an icon that fits its category.
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
      colors={palette ?? ['#1F3A26', '#0B130E']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[StyleSheet.absoluteFill, styles.center]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.ring, styles.ringBig]} />
      <View style={[styles.ring, styles.ringSmall]} />
      <Icon icon={glyphFor(category)} size={iconSize} color="#E5FB46" strokeWidth={1.4} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ring: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  ringBig: { width: 260, height: 260, borderRadius: 130, right: -80, top: -90 },
  ringSmall: { width: 140, height: 140, borderRadius: 70, left: -40, bottom: -50 },
});
