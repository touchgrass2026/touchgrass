import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { readAppEnvironment } from '../src/config';
import { useTheme } from '../src/theme/theme';
import { Download } from './icons';
import { Button, Icon, Text } from './ui';

/** How often a running app looks for a new update (also on launch and on every return to the app). */
const CHECK_EVERY_MS = 30 * 60 * 1000;

/** Looks for a published update and downloads it quietly; never throws (offline, dev builds, etc.). */
export async function checkAndFetch(): Promise<void> {
  try {
    const check = await Updates.checkForUpdateAsync();
    if (check.isAvailable) await Updates.fetchUpdateAsync();
  } catch {
    // Offline or the update server is unreachable: try again next time.
  }
}

/**
 * Tells people when a new version is ready (D-217). Updates download in the background on launch, on
 * returning to the app and every half hour; once one is ready, a card offers Restart now (applies it in a
 * second) or Later. Without it an update only applied on the second cold start, so testers missed fixes.
 * Off in development and e2e builds, where there are no published updates.
 */
export function UpdateBanner() {
  const enabled = Updates.isEnabled && !__DEV__ && !readAppEnvironment().e2e;
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const running = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const check = (): void => {
      if (running.current) return;
      running.current = true;
      void checkAndFetch().finally(() => {
        running.current = false;
      });
    };
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [enabled]);

  const updateId = downloadedUpdate?.updateId ?? 'pending';
  if (!enabled || !isUpdatePending || dismissed === updateId) return null;
  return (
    <UpdateCard
      onRestart={() => void Updates.reloadAsync().catch(() => undefined)}
      onLater={() => {
        setDismissed(updateId);
      }}
    />
  );
}

/** The card itself: a short line and two buttons, above everything, below the status bar. */
export function UpdateCard({ onRestart, onLater }: { onRestart: () => void; onLater: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, { top: insets.top + 8 }]}
      testID="update-banner"
    >
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radii.lg,
          },
        ]}
      >
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: theme.colors.primary }]}>
            <Icon icon={Download} size={18} color={theme.colors.onPrimary} />
          </View>
          <View style={styles.text}>
            <Text variant="heading">{t('update.title')}</Text>
            <Text tone="muted">{t('update.body')}</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Button
            label={t('update.later')}
            variant="ghost"
            onPress={onLater}
            testID="update-later"
          />
          <Button label={t('update.restart')} onPress={onRestart} testID="update-restart" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 12, right: 12, zIndex: 2000, elevation: 2000 },
  card: {
    padding: 14,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
