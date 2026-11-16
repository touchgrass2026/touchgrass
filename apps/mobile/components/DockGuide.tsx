import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, type HostInstance, StyleSheet, View } from 'react-native';
import { readAppEnvironment } from '../src/config';
import { useTheme } from '../src/theme/theme';
import {
  GUIDE_STEPS,
  type GuideRect,
  type GuideStep,
  measureInWindowOf,
  useGuideTargets,
} from './guide/targets';
import { Button, Text } from './ui';

export { GUIDE_STEPS as DOCK_GUIDE_STEPS, type GuideStep as DockGuideStep } from './guide/targets';
/** v2 (D-205): the tour measures its targets and starts with List / Map; v1 drew the ring from a guess. */
export const DOCK_GUIDE_KEY = 'tg:dock-guide:v3';

/** Has this install seen the guide? Reset from Settings → Replay tutorial. */
export async function resetDockGuide(): Promise<void> {
  await AsyncStorage.removeItem(DOCK_GUIDE_KEY);
}

/** Space between a target and its ring, and between the ring and the tip. */
const RING_PAD = 6;
const GAP = 14;
const MARGIN = 16;

/**
 * First-launch tour (D-198, D-205), following coach-mark guidance: one short tip at a time, each pointing
 * at one control, Back and Skip always available, shown once per install. Each control registers its
 * on-screen box with `useGuideTarget`, so the ring sits exactly on it; steps whose control is not on
 * screen (the map switch when maps are off) are left out.
 *
 * It draws in the same window as the controls (D-214): an overlay over the tabs, not a Modal. A Modal is a
 * separate Android window that starts at the very top of the screen, while targets are measured from below
 * the status bar, which put the ring a status bar too high. The overlay measures its own origin and
 * subtracts it, so ring and target share one coordinate system on every device.
 */
export function DockGuide() {
  const { t } = useTranslation();
  const theme = useTheme();
  const rects = useGuideTargets((s) => s.rects);
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const root = useRef<HostInstance | null>(null);
  const [frame, setFrame] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (readAppEnvironment().e2e) return;
    let alive = true;
    void AsyncStorage.getItem(DOCK_GUIDE_KEY)
      .then((seen) => {
        if (alive && !seen) setActive(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // The steps that can be shown now: those whose control has been measured.
  const steps = useMemo(
    () => GUIDE_STEPS.filter((k): k is GuideStep => rects[k] !== undefined),
    [rects],
  );

  const finish = (): void => {
    setActive(false);
    void AsyncStorage.setItem(DOCK_GUIDE_KEY, '1').catch(() => undefined);
  };

  // Android Back skips the tour, as it closed the old modal.
  useEffect(() => {
    if (!active) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setActive(false);
      void AsyncStorage.setItem(DOCK_GUIDE_KEY, '1').catch(() => undefined);
      return true;
    });
    return () => {
      sub.remove();
    };
  }, [active]);

  // Wait until the dock itself has been measured before starting.
  if (!active || rects.plot === undefined) return null;
  const step = Math.min(index, steps.length - 1);
  const key = steps[step];
  const target: GuideRect | undefined = key ? rects[key] : undefined;
  if (!key || !target) return null;
  const last = step === steps.length - 1;

  const measureRoot = (): void => {
    requestAnimationFrame(() => {
      measureInWindowOf(root.current, (x, y, width, height) => {
        if (width > 0 && height > 0) setFrame({ x, y, width, height });
      });
    });
  };
  // Until the overlay knows where it sits, draw only the dim layer.
  if (!frame)
    return (
      <View
        ref={root}
        collapsable={false}
        onLayout={measureRoot}
        style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
        testID="dock-guide-backdrop"
      />
    );
  const screenW = frame.width;
  const screenH = frame.height;
  // The target's box in the overlay's own coordinates.
  const rect = { ...target, x: target.x - frame.x, y: target.y - frame.y };

  const ring = {
    left: rect.x - RING_PAD,
    top: rect.y - RING_PAD,
    width: rect.width + RING_PAD * 2,
    height: rect.height + RING_PAD * 2,
  };
  const centreX = rect.x + rect.width / 2;
  // Tip above controls in the lower half of the screen, below the others.
  const above = rect.y + rect.height / 2 > screenH / 2;
  const cardWidth = Math.min(340, screenW - MARGIN * 2);
  const cardLeft = Math.min(
    Math.max(MARGIN, centreX - cardWidth / 2),
    screenW - cardWidth - MARGIN,
  );
  const cardPlace = above
    ? { bottom: screenH - ring.top + GAP }
    : { top: ring.top + ring.height + GAP };
  const arrowPlace = above
    ? {
        bottom: screenH - ring.top + GAP - 9,
        borderTopWidth: 9,
        borderTopColor: theme.colors.surface,
      }
    : {
        top: ring.top + ring.height + GAP - 9,
        borderBottomWidth: 9,
        borderBottomColor: theme.colors.surface,
      };

  return (
    <View
      ref={root}
      collapsable={false}
      onLayout={measureRoot}
      accessibilityViewIsModal
      style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
      testID="dock-guide-backdrop"
    >
      {/* Ring around the control, over the dimmed screen. */}
      <View
        pointerEvents="none"
        testID="dock-guide-ring"
        style={[
          styles.ring,
          ring,
          {
            borderRadius: Math.min(ring.width, ring.height) / 2,
            borderColor: theme.colors.primary,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.arrow,
          arrowPlace,
          { left: Math.min(Math.max(MARGIN + 12, centreX - 9), screenW - MARGIN - 30) },
        ]}
      />
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          cardPlace,
          {
            width: cardWidth,
            left: cardLeft,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.lg,
            borderColor: theme.colors.border,
          },
        ]}
        testID="dock-guide"
      >
        <Text variant="caption" tone="muted">
          {t('guide.progress', { current: step + 1, total: steps.length })}
        </Text>
        <Text variant="heading">{t(`guide.${key}Title`)}</Text>
        <Text>{t(`guide.${key}Body`)}</Text>
        <View style={styles.actions}>
          <Button
            label={t('guide.skip')}
            variant="ghost"
            onPress={finish}
            testID="dock-guide-skip"
          />
          <View style={styles.grow} />
          {step > 0 ? (
            <Button
              label={t('common.back')}
              variant="secondary"
              onPress={() => {
                setIndex(step - 1);
              }}
              testID="dock-guide-back"
            />
          ) : null}
          <Button
            label={last ? t('guide.done') : t('guide.next')}
            onPress={() => {
              if (last) finish();
              else setIndex(step + 1);
            }}
            testID="dock-guide-next"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    elevation: 1000,
  },
  card: { position: 'absolute', padding: 16, gap: 6, borderWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  grow: { flex: 1 },
  arrow: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  ring: { position: 'absolute', borderWidth: 3 },
});
