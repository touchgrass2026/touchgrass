import { categoryHues, type FreeNowItem } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFreeNow, useSetFree } from '../../src/features/engagement/api';
import { formatTime } from '../../src/features/events/format';
import { useMyFace } from '../../src/features/me/api';
import { TOUCH_TARGET } from '../../src/theme/theme';
import { Zap } from '../icons';
import { RingBadge, StoryRing } from '../stories/StoryRing';
import { Button, FadeIn, Icon, Pulse, staggerDelay, Text, Pressable } from '../ui';
import { FreeNowSheet } from './FreeNowSheet';
import { useFlag } from '../../src/features/app-config/use-flag';

const SIZE = 50;
/** "Free now" reads in amber (D-207): your badge, your ring while you're free, and the squad's rings. */
const amber = categoryHues.amber;

/**
 * "I'm free now" (F-ENG-01, D-207): your face with a small amber lightning badge to say you're free (an amber
 * ring once you are), then squad members free right now in amber rings; tapping one starts a plan with them.
 */
export function FreeNowStrip() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const q = useFreeNow();
  const set = useSetFree();
  const face = useMyFace();
  const enabled = useFlag('free_now');
  const [selected, setSelected] = useState<FreeNowItem | null>(null);
  if (!q.data || !enabled) return null;
  const { me, items } = q.data;
  const free = me.until !== null;
  return (
    <View style={styles.wrap} testID="free-now">
      <View style={styles.header}>
        <View style={styles.title}>
          <Pulse>
            <Icon icon={Zap} size={14} color={amber.solid} strokeWidth={2.4} />
          </Pulse>
          <Text variant="overline" tone="muted" accessibilityRole="header">
            {t('free.title')}
          </Text>
        </View>
        {me.until ? (
          <Button
            label={t('free.clear')}
            variant="ghost"
            loading={set.isPending}
            onPress={() => void set.mutateAsync(null)}
            testID="free-clear"
          />
        ) : null}
      </View>
      {me.until ? (
        <Text variant="caption" style={{ color: amber.text }} testID="free-me">
          {t('free.youAreFree', { time: formatTime(me.until, i18n.language) })}
        </Text>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            me.until
              ? t('free.youAreFree', { time: formatTime(me.until, i18n.language) })
              : t('free.setTitle')
          }
          accessibilityHint={t('a11y.opensScreen', { screen: t('free.setTitle') })}
          onPress={() => {
            router.push('/free');
          }}
          // `free-set` while you're not free (Maestro and tests use it); `free-mine` once you are.
          testID={free ? 'free-mine' : 'free-set'}
          style={styles.person}
        >
          <StoryRing
            photo={face.photo}
            name={face.name}
            size={SIZE}
            kind={free ? 'seen' : 'none'}
            ringColor={free ? amber.solid : undefined}
            testID="free-me-ring"
            badge={
              <RingBadge color={amber.solid} testID="free-badge">
                <Icon icon={Zap} size={12} color={amber.onSolid} strokeWidth={2.6} filled />
              </RingBadge>
            }
          />
          <Text
            variant="caption"
            tone={free ? 'default' : 'muted'}
            numberOfLines={1}
            style={[styles.name, free ? styles.bold : null]}
          >
            {free ? t('free.you') : t('free.setTitle')}
          </Text>
        </Pressable>
        {items.map((f, i) => (
          <FadeIn key={f.person.id} delay={staggerDelay(i, 50)} testID={`free-${f.person.id}`}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={f.person.displayName}
              accessibilityHint={t('a11y.opensScreen', { screen: f.person.displayName })}
              // Read after the name: until when they're free, and their note.
              accessibilityValue={{
                text: [t('free.until', { time: formatTime(f.until, i18n.language) }), f.note]
                  .filter(Boolean)
                  .join(', '),
              }}
              onPress={() => {
                setSelected(f);
              }}
              testID={`free-person-${f.person.id}`}
              style={styles.person}
            >
              <StoryRing
                photo={f.person.photo}
                name={f.person.displayName}
                size={SIZE}
                kind="seen"
                ringColor={amber.solid}
              />
              <Text variant="caption" numberOfLines={1} style={[styles.name, styles.bold]}>
                {f.person.displayName}
              </Text>
              {f.note ? (
                <Text variant="caption" tone="muted" numberOfLines={1} style={styles.name}>
                  {f.note}
                </Text>
              ) : null}
            </Pressable>
          </FadeIn>
        ))}
        {items.length === 0 ? (
          <Text tone="muted" style={styles.nobody}>
            {t('free.nobody')}
          </Text>
        ) : null}
      </ScrollView>
      <FreeNowSheet
        item={selected}
        onClose={() => {
          setSelected(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { gap: 14, alignItems: 'flex-start', paddingVertical: 2 },
  person: { alignItems: 'center', gap: 4, width: 68, minHeight: TOUCH_TARGET },
  name: { textAlign: 'center', width: 68 },
  bold: { fontWeight: '700' },
  nobody: { alignSelf: 'center', maxWidth: 220 },
});
