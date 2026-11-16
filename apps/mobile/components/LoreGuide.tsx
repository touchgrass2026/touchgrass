import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIMITS } from '@touchgrass/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { readAppEnvironment } from '../src/config';
import { useTheme } from '../src/theme/theme';
import { Button, Text } from './ui';

/** Seen once per install (D-218); Settings → Replay tutorial shows it again. */
export const LORE_GUIDE_KEY = 'tg:lore-guide:v1';
export const LORE_GUIDE_STEPS = ['add', 'see', 'save', 'close'] as const;
export type LoreGuideStep = (typeof LORE_GUIDE_STEPS)[number];

export async function resetLoreGuide(): Promise<void> {
  await AsyncStorage.removeItem(LORE_GUIDE_KEY);
}

/**
 * The first time someone opens a Lore album: four short cards (adding photos, who sees them, save vs share,
 * the 7-day window), with Back, Skip and Next like the dock tour. The cards sit at the bottom of the screen
 * instead of pointing at controls: the album scrolls and some controls are only there for hosts, so a ring
 * could point at something off screen (D-218). Off in e2e builds.
 */
export function LoreGuide({ canSave }: { canSave: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (readAppEnvironment().e2e) return undefined;
    let alive = true;
    void AsyncStorage.getItem(LORE_GUIDE_KEY)
      .then((seen) => {
        if (alive && !seen) setActive(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const finish = (): void => {
    setActive(false);
    void AsyncStorage.setItem(LORE_GUIDE_KEY, '1').catch(() => undefined);
  };

  if (!active) return null;
  const step = LORE_GUIDE_STEPS[index] ?? 'add';
  const last = index === LORE_GUIDE_STEPS.length - 1;
  const params = { max: LIMITS.after.lorePerPersonPerEvent, days: LIMITS.lore.availableDays };
  const body =
    step === 'save' && !canSave ? t('lore.tour.shareBody') : t(`lore.tour.${step}Body`, params);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={finish}>
      <View
        style={[
          styles.backdrop,
          { backgroundColor: theme.colors.overlay, paddingBottom: 16 + insets.bottom },
        ]}
      >
        <View
          accessibilityViewIsModal
          accessibilityLiveRegion="polite"
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.lg,
              borderColor: theme.colors.border,
            },
          ]}
          testID="lore-guide"
        >
          <Text variant="caption" tone="muted">
            {t('guide.progress', { current: index + 1, total: LORE_GUIDE_STEPS.length })}
          </Text>
          <Text variant="heading" accessibilityRole="header" testID={`lore-guide-${step}`}>
            {t(`lore.tour.${step}Title`, params)}
          </Text>
          <Text>{body}</Text>
          <View style={styles.actions}>
            <Button
              label={t('guide.skip')}
              variant="ghost"
              onPress={finish}
              testID="lore-guide-skip"
            />
            <View style={styles.grow} />
            {index > 0 ? (
              <Button
                label={t('common.back')}
                variant="secondary"
                onPress={() => {
                  setIndex(index - 1);
                }}
                testID="lore-guide-back"
              />
            ) : null}
            <Button
              label={last ? t('guide.done') : t('guide.next')}
              onPress={() => {
                if (last) finish();
                else setIndex(index + 1);
              }}
              testID="lore-guide-next"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', padding: 16 },
  card: { padding: 16, gap: 8, borderWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  grow: { flex: 1 },
});
