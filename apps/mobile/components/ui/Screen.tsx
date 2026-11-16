import type { ReactNode, RefObject } from 'react';
import { useRef, useState } from 'react';
import {
  type HostInstance,
  RefreshControl,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { rememberScrollOffset, useKeyboardLift } from '../../src/hooks/use-keyboard-lift';
import { useTheme } from '../../src/theme/theme';
import { OfflineBanner } from './OfflineBanner';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  testID?: string;
  /** Lets a screen scroll a field into view (e.g. a search whose results open below it). */
  scrollRef?: RefObject<ScrollViewInstance | null>;
  /** Pinned under the scrolling content, above the safe area (e.g. a form's main action). */
  footer?: ReactNode;
  /** Pull to refresh (D-215): called on pull-down; the spinner shows until it settles. */
  onRefresh?: () => Promise<unknown>;
}

/** Room between blocks on a screen: generous, so each section reads on its own (D-151). */
const SECTION_GAP = 22;

/** Base screen: safe area, themed background, offline banner, scroll so 200% text never clips. */
export function Screen({
  children,
  scroll = true,
  testID,
  scrollRef,
  footer,
  onRefresh,
}: ScreenProps) {
  const theme = useTheme();
  // Keep the field being typed in, and the pinned footer, above the keyboard (D-222).
  const body = useRef<HostInstance | null>(null);
  const ownScroll = useRef<ScrollViewInstance | null>(null);
  const scrollView = scrollRef ?? ownScroll;
  const lift = useKeyboardLift(body, scroll ? scrollView : null);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = (): void => {
    if (!onRefresh) return;
    setRefreshing(true);
    void onRefresh()
      .catch(() => undefined)
      .finally(() => {
        setRefreshing(false);
      });
  };
  const content = (
    <View
      style={[
        styles.content,
        {
          paddingHorizontal: theme.spacing.xl - 4,
          paddingTop: theme.spacing.md,
          paddingBottom: footer ? theme.spacing.xl : theme.spacing.xxxl,
          gap: SECTION_GAP,
        },
      ]}
    >
      {children}
    </View>
  );
  return (
    <SafeAreaView
      testID={testID}
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      edges={['top', 'bottom']}
    >
      <OfflineBanner />
      {/* Everything below the banner rises above the keyboard by however much it would cover (D-222). */}
      <View
        ref={body}
        collapsable={false}
        style={[styles.body, { paddingBottom: lift }]}
        testID={testID ? `${testID}-body` : undefined}
      >
        {scroll ? (
          // "handled": a tap on a result while the keyboard is open selects it, instead of only closing the
          // keyboard (search results on Plot and Search were unpickable on the first tap).
          <ScrollView
            ref={scrollView}
            onScroll={(e) => {
              rememberScrollOffset(scrollView.current, e.nativeEvent.contentOffset.y);
            }}
            scrollEventThrottle={32}
            contentContainerStyle={styles.grow}
            keyboardShouldPersistTaps="handled"
            testID={testID ? `${testID}-scroll` : undefined}
            keyboardDismissMode="on-drag"
            refreshControl={
              onRefresh ? (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={refresh}
                  tintColor={theme.colors.primary}
                  colors={[theme.colors.primary]}
                  progressBackgroundColor={theme.colors.surface}
                />
              ) : undefined
            }
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
        {footer ? (
          <View
            style={[
              styles.footer,
              {
                backgroundColor: theme.colors.background,
                borderTopColor: theme.colors.border,
                paddingHorizontal: theme.spacing.xl - 4,
                paddingVertical: theme.spacing.md,
                gap: theme.spacing.sm,
              },
            ]}
          >
            {footer}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  root: { flex: 1 },
  grow: { flexGrow: 1 },
  content: { flexGrow: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
});
