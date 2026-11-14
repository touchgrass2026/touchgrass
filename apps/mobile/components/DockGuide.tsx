import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import { readAppEnvironment } from '../src/config';
import { useTheme } from '../src/theme/theme';
import { Button, Text } from './ui';

/** The dock slots, left to right, as the guide walks them. */
export const DOCK_GUIDE_STEPS = ['discover', 'plans', 'plot', 'chats', 'squad'] as const;
export type DockGuideStep = (typeof DOCK_GUIDE_STEPS)[number];
export const DOCK_GUIDE_KEY = 'tg:dock-guide:v1';

/** Has this install seen the guide? Reset from Settings → Replay tutorial. */
export async function resetDockGuide(): Promise<void> {
  await AsyncStorage.removeItem(DOCK_GUIDE_KEY);
}

/**
 * First-launch guide to the dock (D-198), following coach-mark guidance: one short tip at a time, each
 * pointing at one button, Skip always available, shown once per install. Slot positions are measured by
 * the dock (`slots`: centre x of each button in window coordinates).
 */
export function DockGuide({
  slots,
  dockHeight,
}: {
  slots: Partial<Record<DockGuideStep, number>>;
  dockHeight: number;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (readAppEnvironment().e2e) return;
    let alive = true;
    void AsyncStorage.getItem(DOCK_GUIDE_KEY)
      .then((seen) => {
        if (alive && !seen) setStep(0);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const finish = (): void => {
    setStep(null);
    void AsyncStorage.setItem(DOCK_GUIDE_KEY, '1').catch(() => undefined);
  };

  if (step === null) return null;
  const key = DOCK_GUIDE_STEPS[step];
  if (!key) return null;
  const x = slots[key] ?? width / 2;
  const cardWidth = Math.min(320, width - 32);
  const left = Math.min(Math.max(16, x - cardWidth / 2), width - cardWidth - 16);
  const last = step === DOCK_GUIDE_STEPS.length - 1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={finish}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[
            styles.card,
            {
              width: cardWidth,
              left,
              bottom: dockHeight + 18,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.lg,
              borderColor: theme.colors.border,
            },
          ]}
          testID="dock-guide"
        >
          <Text variant="caption" tone="muted">
            {t('guide.progress', { current: step + 1, total: DOCK_GUIDE_STEPS.length })}
          </Text>
          <Text variant="heading">{t(`guide.${key}Title`)}</Text>
          <Text tone="muted">{t(`guide.${key}Body`)}</Text>
          <View style={styles.actions}>
            <Button
              label={t('guide.skip')}
              variant="ghost"
              onPress={finish}
              testID="dock-guide-skip"
            />
            <Button
              label={last ? t('guide.done') : t('guide.next')}
              onPress={() => {
                if (last) finish();
                else setStep(step + 1);
              }}
              testID="dock-guide-next"
            />
          </View>
        </View>
        {/* Arrow from the tip down to the button it describes. */}
        <View
          style={[
            styles.arrow,
            {
              left: x - 9,
              bottom: dockHeight + 10,
              borderTopColor: theme.colors.surface,
            },
          ]}
        />
        {/* Ring around that button, above the dimmed screen. */}
        <View
          style={[
            styles.ring,
            {
              left: x - 30,
              bottom: Math.max(4, dockHeight - 64),
              borderColor: theme.colors.primary,
            },
          ]}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  card: { position: 'absolute', padding: 16, gap: 6, borderWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 },
  arrow: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  ring: { position: 'absolute', width: 60, height: 60, borderRadius: 30, borderWidth: 3 },
});
