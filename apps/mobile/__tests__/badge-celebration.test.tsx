import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { BadgeView } from '@touchgrass/shared';
import { BadgeCelebration } from '../components/BadgeCelebration';
import { seenBadgesKey } from '../src/features/gamification/celebrate';
import { useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi, ids } from '../test/fake-api';
import { mockRouter, renderWithProviders, resetStores } from '../test-utils';

const badge = (over: Partial<BadgeView>): BadgeView => ({
  key: 'grass_toucher',
  name: { en: 'Grass Toucher', te: 'te', hi: 'hi' },
  description: { en: 'Checked in to your first plan.', te: 'te', hi: 'hi' },
  emoji: '',
  earnedAt: '2026-11-10T10:00:00.000Z',
  progress: { current: 1, target: 1 },
  ...over,
});

const earlyBird = badge({
  key: 'early_bird',
  name: { en: 'Early Bird', te: 'te', hi: 'hi' },
  description: { en: 'Pulled up to a morning plan.', te: 'te', hi: 'hi' },
  earnedAt: '2026-11-12T07:00:00.000Z',
});
const notYet = badge({
  key: 'main_character',
  name: { en: 'Main Character', te: 'te', hi: 'hi' },
  earnedAt: null,
  progress: { current: 1, target: 5 },
});

let api: FakeApi;
beforeEach(async () => {
  resetStores();
  await AsyncStorage.clear();
  await useAuthStore.getState().signIn(
    authResponseFixture({
      user: {
        id: ids.me,
        status: 'active',
        onboardingComplete: true,
        tutorialComplete: true,
        roles: [],
      },
    }) as never,
  );
  api = new FakeApi();
});

const seenNow = async (): Promise<string[]> =>
  JSON.parse((await AsyncStorage.getItem(seenBadgesKey(ids.me))) ?? '[]') as string[];

describe('badge celebration (D-205)', () => {
  it('records badges already earned on first check, without a celebration', async () => {
    api.on('GET', '/v1/me/badges', { status: 200, body: { items: [badge({}), notYet] } });
    await renderWithProviders(<BadgeCelebration />, { fetchFn: api.fetch });
    await waitFor(async () => {
      expect(await seenNow()).toEqual(['grass_toucher']);
    });
    expect(screen.queryByTestId('badge-celebration')).toBeNull();
  });

  it('celebrates each new badge in the order it was won, once', async () => {
    await AsyncStorage.setItem(seenBadgesKey(ids.me), JSON.stringify([]));
    api.on('GET', '/v1/me/badges', {
      status: 200,
      body: { items: [earlyBird, badge({}), notYet] },
    });
    await renderWithProviders(<BadgeCelebration />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('badge-celebration')).toBeOnTheScreen();
    expect(screen.getByText('Badge unlocked')).toBeOnTheScreen();
    expect(screen.getByText('Grass Toucher')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('badge-celebration-close'));
    expect(await screen.findByText('Early Bird')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('badge-celebration-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('badge-celebration')).toBeNull();
    });
    expect((await seenNow()).sort()).toEqual(['early_bird', 'grass_toucher']);
    expect(screen.queryByText('Main Character')).toBeNull();
  });

  it('See your badges opens the badges screen', async () => {
    await AsyncStorage.setItem(seenBadgesKey(ids.me), JSON.stringify(['grass_toucher']));
    api.on('GET', '/v1/me/badges', { status: 200, body: { items: [badge({}), earlyBird] } });
    await renderWithProviders(<BadgeCelebration />, { fetchFn: api.fetch });
    expect(await screen.findByText('Early Bird')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('badge-celebration-see'));
    expect(mockRouter.push).toHaveBeenCalledWith('/badges');
    await waitFor(async () => {
      expect((await seenNow()).sort()).toEqual(['early_bird', 'grass_toucher']);
    });
  });

  it('waits until the tutorial is done', async () => {
    await useAuthStore.getState().signIn(
      authResponseFixture({
        user: {
          id: ids.me,
          status: 'active',
          onboardingComplete: true,
          tutorialComplete: false,
          roles: [],
        },
      }) as never,
    );
    api.on('GET', '/v1/me/badges', { status: 200, body: { items: [badge({})] } });
    await renderWithProviders(<BadgeCelebration />, { fetchFn: api.fetch });
    await new Promise((r) => setTimeout(r, 30));
    expect(api.callsTo('GET', '/v1/me/badges')).toHaveLength(0);
  });
});
