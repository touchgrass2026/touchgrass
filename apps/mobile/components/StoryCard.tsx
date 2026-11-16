import {
  type CategoryLike,
  media,
  type StoryGradientName,
  type StorySolidName,
  storyGradients,
  storySolids,
} from '@touchgrass/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, type TextStyle, View } from 'react-native';
import { PlanArt } from './PlanArt';
import { Text } from './ui';

export type StoryCardRef = ComponentRef<typeof View>;

/**
 * What goes behind a story card (D-212): a gradient or solid colour from the tokens, the plan's category
 * artwork, or a photo (the plan's cover, or one the member picked, which never leaves the phone).
 */
export type StoryBackground =
  | { kind: 'gradient'; name: StoryGradientName }
  | { kind: 'solid'; name: StorySolidName }
  | { kind: 'art'; category: CategoryLike | string | null }
  | { kind: 'photo'; source: 'cover' | 'mine'; uri: string };

/** The brand's own lime, as the card always looked before backgrounds could be picked. */
export const DEFAULT_STORY_BACKGROUND: StoryBackground = { kind: 'solid', name: 'lime' };

export function storyBackgroundKey(b: StoryBackground): string {
  switch (b.kind) {
    case 'gradient':
    case 'solid':
      return `${b.kind}-${b.name}`;
    case 'art':
      return 'art';
    case 'photo':
      return `photo-${b.source}`;
  }
}

/** Photos and artwork get the `media` scrims and white text, so the words read over anything. */
const needsScrim = (b: StoryBackground): boolean => b.kind === 'photo' || b.kind === 'art';

function inkFor(b: StoryBackground): string {
  if (b.kind === 'gradient') return storyGradients[b.name].ink;
  if (b.kind === 'solid') return storySolids[b.name].ink;
  return media.text;
}

function Backdrop({ background }: { background: StoryBackground }) {
  const testID = `story-backdrop-${storyBackgroundKey(background)}`;
  switch (background.kind) {
    case 'gradient':
      return (
        <LinearGradient
          colors={storyGradients[background.name].colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
          testID={testID}
        />
      );
    case 'solid':
      return (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: storySolids[background.name].color }]}
          testID={testID}
        />
      );
    case 'art':
      return (
        <View style={StyleSheet.absoluteFill} testID={testID}>
          <PlanArt category={background.category} iconSize={96} />
        </View>
      );
    case 'photo':
      return (
        <Image
          source={{ uri: background.uri }}
          contentFit="cover"
          style={StyleSheet.absoluteFill}
          accessible={false}
          importantForAccessibility="no"
          accessibilityIgnoresInvertColors
          testID={testID}
        />
      );
  }
}

/** A 9:16 card drawn for capture (Instagram Stories, WhatsApp status), F-GRW-02, on any background (D-212). */
export const StoryCard = forwardRef<
  StoryCardRef,
  {
    title: string;
    lines: string[];
    footer: string;
    background?: StoryBackground;
    testID?: string;
  }
>(function StoryCard({ title, lines, footer, background = DEFAULT_STORY_BACKGROUND, testID }, ref) {
  const { t } = useTranslation();
  const scrim = needsScrim(background);
  const ink: TextStyle = {
    color: inkFor(background),
    ...(scrim
      ? {
          textShadowColor: media.textShadow,
          textShadowRadius: 6,
          textShadowOffset: { width: 0, height: 1 },
        }
      : null),
  };
  return (
    <View ref={ref} collapsable={false} style={styles.card} testID={testID}>
      <Backdrop background={background} />
      {scrim ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="story-scrim">
          <LinearGradient
            colors={[media.scrimTop, media.clear]}
            style={styles.scrimTop}
            pointerEvents="none"
          />
          <LinearGradient
            colors={[media.clear, media.scrim, media.scrim]}
            locations={[0, 0.5, 1]}
            style={styles.scrimBottom}
            pointerEvents="none"
          />
        </View>
      ) : null}
      <Text variant="label" style={ink}>
        {t('brand.name')}
      </Text>
      <View style={styles.body}>
        <Text variant="display" accessibilityRole="header" style={ink}>
          {title}
        </Text>
        {lines.map((l) => (
          <Text key={l} variant="title" style={ink}>
            {l}
          </Text>
        ))}
        <Text variant="label" style={[ink, styles.footer]}>
          {footer}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    aspectRatio: 9 / 16,
    padding: 28,
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  body: { gap: 14 },
  footer: { marginTop: 10 },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: '25%' },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%' },
});
