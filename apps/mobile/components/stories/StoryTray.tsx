import type { StoryTrayEntry } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFlag } from '../../src/features/app-config/use-flag';
import { useMyFace } from '../../src/features/me/api';
import { useStoryTray } from '../../src/features/stories/api';
import { useTheme, TOUCH_TARGET } from '../../src/theme/theme';
import { Plus } from '../icons';
import { FadeIn, Icon, staggerDelay, Text, Pressable } from '../ui';
import { BADGE_SIZE, RingBadge, StoryRing } from './StoryRing';

const SIZE = 56;
const ITEM_WIDTH = 72;

/**
 * Squad stories (Phase 13, D-207) the Instagram way: "Your story" first (your face with a lime "+" to add one;
 * once you have a live story, your ringed face opens it and the "+" still adds more), then people with
 * something new (gradient ring), then the rest (muted ring). Hidden while the feature is switched off.
 */
export function StoryTray() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const enabled = useFlag('stories');
  const q = useStoryTray(enabled);
  const face = useMyFace();
  if (!enabled || !q.data) return null;
  const mine = q.data.items.find((i) => i.mine);
  const others = q.data.items.filter((i) => !i.mine);

  const open = (entry: StoryTrayEntry): void => {
    router.push({ pathname: '/stories/[userId]', params: { userId: entry.person.id } });
  };
  const add = (): void => {
    router.push('/stories/new');
  };
  const addBadge = (
    <RingBadge color={theme.colors.primary} testID="story-add-badge">
      <Icon icon={Plus} size={14} color={theme.colors.onPrimary} strokeWidth={2.8} />
    </RingBadge>
  );

  return (
    <View testID="story-tray">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <View style={styles.person}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mine ? t('stories.yours') : t('stories.add')}
            accessibilityHint={mine ? undefined : t('stories.addHint')}
            onPress={() => {
              if (mine) open(mine);
              else add();
            }}
            testID={mine ? 'story-mine' : 'story-add'}
            style={styles.face}
          >
            <StoryRing
              photo={mine?.person.photo ?? face.photo}
              name={mine?.person.displayName ?? face.name}
              size={SIZE}
              kind={mine ? (mine.unseen ? 'unseen' : 'seen') : 'none'}
              // Without a live story the badge is part of this one control.
              badge={mine ? undefined : addBadge}
            />
          </Pressable>
          {mine ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('stories.add')}
              accessibilityHint={t('stories.addHint')}
              onPress={add}
              testID="story-add-more"
              hitSlop={(TOUCH_TARGET - BADGE_SIZE) / 2}
              style={styles.addMore}
            >
              {addBadge}
            </Pressable>
          ) : null}
          <Text variant="caption" tone="muted" numberOfLines={1} style={styles.name}>
            {t('stories.yours')}
          </Text>
        </View>
        {others.map((entry, i) => (
          <FadeIn key={entry.person.id} delay={staggerDelay(i + 1, 50)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                entry.unseen
                  ? t('stories.personNew', { name: entry.person.displayName })
                  : t('stories.personSeen', { name: entry.person.displayName })
              }
              onPress={() => {
                open(entry);
              }}
              testID={`story-person-${entry.person.id}`}
              style={styles.person}
            >
              <StoryRing
                photo={entry.person.photo}
                name={entry.person.displayName}
                size={SIZE}
                kind={entry.unseen ? 'unseen' : 'seen'}
              />
              <Text
                variant="caption"
                numberOfLines={1}
                tone={entry.unseen ? undefined : 'muted'}
                style={[styles.name, entry.unseen ? styles.bold : null]}
              >
                {entry.person.displayName}
              </Text>
            </Pressable>
          </FadeIn>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10, alignItems: 'flex-start', paddingVertical: 2 },
  person: { alignItems: 'center', gap: 4, width: ITEM_WIDTH, minHeight: TOUCH_TARGET },
  face: { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET },
  // Over the bottom-right of your ringed face (the ring adds 10pt to SIZE).
  addMore: {
    position: 'absolute',
    top: SIZE + 10 - BADGE_SIZE,
    right: (ITEM_WIDTH - SIZE - 10) / 2,
  },
  name: { textAlign: 'center', width: ITEM_WIDTH },
  bold: { fontWeight: '700' },
});
