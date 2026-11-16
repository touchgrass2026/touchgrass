import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { DockGuide } from '../../../components/DockGuide';
import { DockTabBar } from '../../../components/DockTabBar';
import { useAuthStore } from '../../../src/stores/auth-store';
import { useTheme } from '../../../src/theme/theme';

/**
 * Bottom dock (D-144): Explore, Plans, the Plot button, Chats, Squad. Profile and settings stay tabs so their
 * state survives switching, but open from the avatar on Explore and from Profile instead of the dock.
 */
/** Explore is home. Without this the tabs opened on the first file alphabetically (Chats). */
export const unstable_settings = { initialRouteName: 'discover' };

export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const tutorialDone = useAuthStore((s) => s.session?.user.tutorialComplete === true);
  return (
    <View style={styles.fill}>
      <Tabs
        tabBar={(props) => <DockTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Tabs.Screen
          name="discover"
          options={{
            title: t('nav.explore'),
            tabBarAccessibilityLabel: t('nav.explore'),
          }}
        />
        <Tabs.Screen
          name="plans"
          options={{
            title: t('nav.events'),
            tabBarAccessibilityLabel: t('nav.events'),
          }}
        />
        <Tabs.Screen
          name="chats"
          options={{
            title: t('nav.chats'),
            tabBarAccessibilityLabel: t('nav.chats'),
          }}
        />
        <Tabs.Screen
          name="squad"
          options={{
            title: t('nav.squad'),
            tabBarAccessibilityLabel: t('nav.squad'),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: t('nav.profile'),
            tabBarAccessibilityLabel: t('nav.profile'),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: t('nav.settings'),
            tabBarAccessibilityLabel: t('nav.settings'),
          }}
        />
      </Tabs>
      {/* The first-launch tour sits over the tabs, in the same window as what it points at (D-214). */}
      {tutorialDone ? <DockGuide /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
