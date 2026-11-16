import {
  type CategoryLike,
  STORY_GRADIENT_NAMES,
  STORY_SOLID_NAMES,
  storyGradients,
  storySolids,
} from '@touchgrass/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { pickImage } from '../src/features/media/upload';
import { errorMessage } from '../src/lib/errors';
import { TOUCH_TARGET, useTheme } from '../src/theme/theme';
import { Check, Photo } from './icons';
import { PlanArt } from './PlanArt';
import { type StoryBackground, storyBackgroundKey } from './StoryCard';
import { Icon, Pressable, Text } from './ui';

/** Swatches are small 9:16 previews, comfortably above the touch-target minimum. */
const SWATCH_W = Math.max(TOUCH_TARGET, 52);
const SWATCH_H = Math.round((SWATCH_W * 16) / 9);

function Swatch({
  label,
  hint,
  selected,
  onPress,
  testID,
  children,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected }}
      onPress={onPress}
      testID={testID}
      style={[
        styles.swatch,
        {
          borderRadius: theme.radii.sm,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          borderWidth: selected ? 3 : 1,
        },
      ]}
    >
      <View style={[StyleSheet.absoluteFill, styles.inner]}>{children}</View>
      {/* Not by colour alone: the chosen one also carries a check. */}
      {selected ? (
        <View style={[styles.check, { backgroundColor: theme.colors.primary }]}>
          <Icon icon={Check} size={14} color={theme.colors.onPrimary} />
        </View>
      ) : null}
    </Pressable>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="overline" tone="muted" accessibilityRole="header">
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/**
 * Backgrounds for a story card (D-212): the plan's cover and artwork, the member's own photo (cropped 9:16,
 * kept on the phone, never uploaded), gradients from the category hues and a row of solid colours.
 */
export function StoryBackgroundPicker({
  value,
  onChange,
  coverUri,
  category,
}: {
  value: StoryBackground;
  onChange: (next: StoryBackground) => void;
  coverUri: string | null;
  category: CategoryLike | string | null;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [mine, setMine] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const selected = storyBackgroundKey(value);

  const pickMine = async (): Promise<void> => {
    setFailed(null);
    try {
      const uri = await pickImage([9, 16]);
      if (!uri) return;
      setMine(uri);
      onChange({ kind: 'photo', source: 'mine', uri });
    } catch (err) {
      setFailed(errorMessage(t, err) ?? t('share.bg.photoFailed'));
    }
  };

  return (
    <View style={styles.picker} testID="story-bg-picker">
      <Text variant="heading" accessibilityRole="header">
        {t('share.background')}
      </Text>
      <Row label={t('share.bg.photos')}>
        {coverUri ? (
          <Swatch
            label={t('share.bg.cover')}
            selected={selected === 'photo-cover'}
            onPress={() => {
              onChange({ kind: 'photo', source: 'cover', uri: coverUri });
            }}
            testID="story-bg-cover"
          >
            <Image
              source={{ uri: coverUri }}
              contentFit="cover"
              style={StyleSheet.absoluteFill}
              accessibilityIgnoresInvertColors
              accessible={false}
              importantForAccessibility="no"
            />
          </Swatch>
        ) : null}
        <Swatch
          label={t('share.bg.art')}
          selected={selected === 'art'}
          onPress={() => {
            onChange({ kind: 'art', category });
          }}
          testID="story-bg-art"
        >
          <PlanArt category={category} iconSize={18} />
        </Swatch>
        <Swatch
          label={t('share.bg.mine')}
          hint={t('share.bg.mineHint')}
          selected={selected === 'photo-mine'}
          onPress={() => void pickMine()}
          testID="story-bg-mine"
        >
          {mine ? (
            <Image
              source={{ uri: mine }}
              contentFit="cover"
              style={StyleSheet.absoluteFill}
              accessibilityIgnoresInvertColors
              accessible={false}
              importantForAccessibility="no"
            />
          ) : (
            <View
              style={[
                StyleSheet.absoluteFill,
                styles.center,
                { backgroundColor: theme.colors.surfaceAlt },
              ]}
            >
              <Icon icon={Photo} size={20} />
            </View>
          )}
        </Swatch>
      </Row>
      <Row label={t('share.bg.gradients')}>
        {STORY_GRADIENT_NAMES.map((name) => (
          <Swatch
            key={name}
            label={t(`share.bg.gradient.${name}`)}
            selected={selected === `gradient-${name}`}
            onPress={() => {
              onChange({ kind: 'gradient', name });
            }}
            testID={`story-bg-gradient-${name}`}
          >
            <LinearGradient
              colors={storyGradients[name].colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Swatch>
        ))}
      </Row>
      <Row label={t('share.bg.solids')}>
        {STORY_SOLID_NAMES.map((name) => (
          <Swatch
            key={name}
            label={t(`share.bg.solid.${name}`)}
            selected={selected === `solid-${name}`}
            onPress={() => {
              onChange({ kind: 'solid', name });
            }}
            testID={`story-bg-solid-${name}`}
          >
            <View style={[StyleSheet.absoluteFill, { backgroundColor: storySolids[name].color }]} />
          </Swatch>
        ))}
      </Row>
      <Text tone="muted" variant="caption">
        {t('share.bg.mineHint')}
      </Text>
      {failed ? (
        <Text tone="danger" accessibilityRole="alert" testID="story-bg-error">
          {failed}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { gap: 12 },
  section: { gap: 6 },
  row: { gap: 10, paddingVertical: 2 },
  swatch: { width: SWATCH_W, height: SWATCH_H, overflow: 'hidden' },
  inner: { overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  check: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
