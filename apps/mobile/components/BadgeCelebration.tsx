import type { BadgeView } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  AppState,
  Easing,
  Modal,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { readAppEnvironment } from '../src/config';
import { localized } from '../src/features/catalog/api';
import { useBadges } from '../src/features/engagement/api';
import { badgeIcon } from '../src/features/gamification/badge-icons';
import {
  loadSeenBadges,
  newlyEarned,
  saveSeenBadges,
} from '../src/features/gamification/celebrate';
import { useAuthStore } from '../src/stores/auth-store';
import { useTheme } from '../src/theme/theme';
import { Button, Icon, Text } from './ui';

/** How often badges are re-checked while the app is open (also on every return to the foreground). */
const CHECK_EVERY_MS = 120_000;
const CONFETTI_PIECES = 22;

/**
 * Celebrates each badge as it is earned (D-205). Badges are re-checked on launch, on returning to the app
 * and every couple of minutes; any earned badge this install has not shown yet gets a moment of its own:
 * the medal, its name, a burst of confetti (none under Reduce Motion), and a way to see all badges. The
 * first check on an install records what is already earned without a fuss.
 */
export function BadgeCelebration() {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const ready = useAuthStore((s) => s.session?.user.tutorialComplete === true);
  const disabled = readAppEnvironment().e2e;
  const q = useBadges({
    enabled: ready && !disabled && userId !== null,
    refetchEvery: CHECK_EVERY_MS,
  });
  const refetch = useRef(q.refetch);
  refetch.current = q.refetch;
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<BadgeView[]>([]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refetch.current();
    });
    return () => {
      sub.remove();
    };
  }, []);

  // A different account on this phone has its own record.
  useEffect(() => {
    seen.current = null;
    setQueue([]);
  }, [userId]);

  const items = q.data?.items;
  useEffect(() => {
    if (!items || !userId) return;
    const run = { alive: true };
    void (async () => {
      const known = seen.current ?? (await loadSeenBadges(userId));
      if (!run.alive) return;
      if (known === null) {
        // First check on this install: what is already earned is old news.
        const all = new Set(items.filter((b) => b.earnedAt !== null).map((b) => b.key));
        seen.current = all;
        await saveSeenBadges(userId, all).catch(() => undefined);
        return;
      }
      seen.current = known;
      const fresh = newlyEarned(items, known);
      if (fresh.length > 0)
        setQueue((prev) => [...prev, ...fresh.filter((b) => !prev.some((p) => p.key === b.key))]);
    })();
    return () => {
      run.alive = false;
    };
  }, [items, userId]);

  const current = queue[0];
  if (!current || !userId) return null;
  const dismiss = (): void => {
    const next = new Set(seen.current ?? []);
    next.add(current.key);
    seen.current = next;
    void saveSeenBadges(userId, next).catch(() => undefined);
    setQueue((prev) => prev.slice(1));
  };
  return <Celebration badge={current} onClose={dismiss} />;
}

function Celebration({ badge, onClose }: { badge: BadgeView; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const name = localized(badge.name, i18n.language);
  const pop = useRef(new Animated.Value(theme.reduceMotion ? 1 : 0.6)).current;
  useEffect(() => {
    if (theme.reduceMotion) return;
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 10, bounciness: 12 }).start();
  }, [pop, theme.reduceMotion]);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
        {theme.reduceMotion ? null : <Confetti key={badge.key} />}
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.lg,
            },
          ]}
          testID="badge-celebration"
        >
          <Animated.View
            style={[
              styles.medal,
              { backgroundColor: theme.colors.primary, transform: [{ scale: pop }] },
            ]}
          >
            <Icon
              icon={badgeIcon(badge.key)}
              size={44}
              color={theme.colors.onPrimary}
              strokeWidth={2}
            />
          </Animated.View>
          <Text tone="muted">{t('badges.unlocked')}</Text>
          <Text variant="title" style={styles.centre}>
            {name}
          </Text>
          <Text style={styles.centre}>{localized(badge.description, i18n.language)}</Text>
          <View style={styles.actions}>
            <View style={styles.grow}>
              <Button
                label={t('badges.seeAll')}
                variant="secondary"
                onPress={() => {
                  onClose();
                  router.push('/badges');
                }}
                testID="badge-celebration-see"
              />
            </View>
            <View style={styles.grow}>
              <Button label={t('badges.nice')} onPress={onClose} testID="badge-celebration-close" />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** One burst of confetti falling from the top of the screen, in the brand colours. Decorative. */
function Confetti() {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const fall = useRef(new Animated.Value(0)).current;
  const pieces = useMemo(() => {
    const colours = [
      theme.colors.primary,
      theme.colors.accent,
      theme.colors.info,
      theme.colors.success,
      theme.colors.text,
    ];
    return Array.from({ length: CONFETTI_PIECES }, (_, i) => {
      // Spread evenly with a fixed wobble, so every burst looks alike and tests stay stable.
      const lane = (i + 0.5) / CONFETTI_PIECES;
      return {
        left: lane * width,
        drift: ((i % 5) - 2) * 18,
        delay: (i % 4) * 0.08,
        spin: i % 2 === 0 ? 1 : -1,
        colour: colours[i % colours.length] ?? theme.colors.primary,
        size: 6 + (i % 3) * 3,
      };
    });
  }, [theme.colors, width]);
  useEffect(() => {
    Animated.timing(fall, {
      toValue: 1,
      duration: 1800,
      easing: Easing.out((t: number) => Easing.quad(t)),
      useNativeDriver: true,
    }).start();
  }, [fall]);
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {pieces.map((p, i) => {
        const progress = fall.interpolate({
          inputRange: [p.delay, 1],
          outputRange: [0, 1],
          extrapolate: 'clamp',
        });
        return (
          <Animated.View
            key={i}
            style={[
              styles.piece,
              {
                left: p.left,
                width: p.size,
                height: p.size * 1.6,
                backgroundColor: p.colour,
                opacity: progress.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
                transform: [
                  {
                    translateY: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-40, height * 0.75],
                    }),
                  },
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, p.drift],
                    }),
                  },
                  {
                    rotate: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', `${p.spin * 540}deg`],
                    }),
                  },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 8,
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
  },
  medal: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  centre: { textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', marginTop: 12 },
  grow: { flex: 1 },
  piece: { position: 'absolute', top: 0, borderRadius: 2 },
});
