import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { CalendarDays, Compass, MessageCircle, Plus, Users } from './icons';
import { useAuthStore } from '../src/stores/auth-store';
import { useTheme } from '../src/theme/theme';
import { DockGuide, type DockGuideStep } from './DockGuide';
import { AnimatedPressable, Icon, type GlyphIcon, Pop, Text, usePressScale } from './ui';

/** Tabs shown in the dock, in order; the Plot button sits in the middle. Profile and settings open from headers. */
export const DOCK_TABS = ['discover', 'plans', 'chats', 'squad'] as const;
const ICONS: Record<(typeof DOCK_TABS)[number], GlyphIcon> = {
  discover: Compass,
  plans: CalendarDays,
  chats: MessageCircle,
  squad: Users,
};

/** The mock's bottom dock: frosted bar, lime active tab, big lime "+" in the centre to plot a plan. */
export function DockTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  insets,
}: BottomTabBarProps) {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const plotPress = usePressScale(0.9);
  // Where each dock button sits, for the first-launch guide (D-198). The bar spans the full width.
  const [slots, setSlots] = useState<Partial<Record<DockGuideStep, number>>>({});
  const [barHeight, setBarHeight] = useState(0);
  const tutorialDone = useAuthStore((s) => s.session?.user.tutorialComplete === true);
  const measure =
    (key: DockGuideStep) => (e: { nativeEvent: { layout: { x: number; width: number } } }) => {
      const { x, width } = e.nativeEvent.layout;
      setSlots((prev) => (prev[key] === x + width / 2 ? prev : { ...prev, [key]: x + width / 2 }));
    };
  const visible = DOCK_TABS.map((name) => state.routes.find((r) => r.name === name)).filter(
    (r): r is (typeof state.routes)[number] => r !== undefined,
  );

  const tab = (route: (typeof state.routes)[number]) => {
    const focused = state.routes[state.index]?.key === route.key;
    const title = descriptors[route.key]?.options.title;
    const label = typeof title === 'string' ? title : route.name;
    const color = focused ? theme.colors.primary : theme.colors.textMuted;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected: focused }}
        testID={`dock-${route.name}`}
        onLayout={measure(route.name as DockGuideStep)}
        onPress={() => {
          const event = emitter.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        }}
        style={[styles.tab, { minHeight: theme.minTouchTarget }]}
      >
        <Pop trigger={focused} when={focused}>
          <Icon
            icon={ICONS[route.name as (typeof DOCK_TABS)[number]]}
            size={20}
            color={color}
            strokeWidth={focused ? 2.4 : 1.8}
          />
        </Pop>
        <Text
          variant="caption"
          numberOfLines={1}
          style={{ color, fontWeight: focused ? '700' : '500', fontSize: 11 }}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  const half = Math.ceil(visible.length / 2);
  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e) => {
        setBarHeight(e.nativeEvent.layout.height);
      }}
      style={[
        styles.bar,
        {
          paddingBottom: Math.max(insets.bottom, 10),
          backgroundColor: theme.colors.background,
          borderTopColor: theme.colors.border,
        },
      ]}
    >
      {visible.slice(0, half).map(tab)}
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={t('events.plot')}
        accessibilityHint={t('a11y.opensScreen', { screen: t('events.plot') })}
        testID="dock-plot"
        onLayout={measure('plot')}
        onPress={() => {
          router.push('/plot');
        }}
        onPressIn={plotPress.onPressIn}
        onPressOut={plotPress.onPressOut}
        style={[
          styles.plot,
          {
            backgroundColor: theme.colors.primary,
            borderColor: theme.colors.background,
            width: 54,
            height: 54,
          },
          plotPress.scaleStyle,
        ]}
      >
        <Icon icon={Plus} size={24} color={theme.colors.onPrimary} strokeWidth={2.6} />
      </AnimatedPressable>
      {visible.slice(half).map(tab)}
      {tutorialDone && barHeight > 0 ? <DockGuide slots={slots} dockHeight={barHeight} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  plot: {
    marginTop: -28,
    borderRadius: 27,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#E5FB46',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
});
