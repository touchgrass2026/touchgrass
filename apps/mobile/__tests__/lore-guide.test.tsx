import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { LORE_GUIDE_KEY, LoreGuide, resetLoreGuide } from '../components/LoreGuide';
import { loreCountdown } from '../src/features/after/lore-window';
import { renderWithProviders, resetStores } from '../test-utils';

describe('Lore tour on first open (D-218)', () => {
  beforeEach(async () => {
    resetStores();
    await AsyncStorage.clear();
  });

  it('walks add, who sees it, save vs share and the 7-day close, with Back; then never again', async () => {
    const first = await renderWithProviders(<LoreGuide canSave />);
    expect(await screen.findByText('Add your photos')).toBeOnTheScreen();
    expect(screen.getByText('1 of 4')).toBeOnTheScreen();
    expect(screen.getByTestId('lore-guide')).toHaveTextContent(/up to 30 photos/);
    expect(screen.getByTestId('lore-guide')).toHaveTextContent(/checked before they appear/);
    expect(screen.queryByTestId('lore-guide-back')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Who can see it')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Add your photos')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Save or share')).toBeOnTheScreen();
    expect(screen.getByTestId('lore-guide')).toHaveTextContent(/Save to phone puts photos/);
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Lore closes after 7 days')).toBeOnTheScreen();
    expect(screen.getByText('4 of 4')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByTestId('lore-guide')).toBeNull());
    expect(await AsyncStorage.getItem(LORE_GUIDE_KEY)).toBe('1');
    await first.unmount();

    await renderWithProviders(<LoreGuide canSave />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('lore-guide')).toBeNull();

    // Settings → Replay tutorial brings it back.
    await resetLoreGuide();
    expect(await AsyncStorage.getItem(LORE_GUIDE_KEY)).toBeNull();
  });

  it('Skip ends it at once; without "Save to phone" the save step talks about Share', async () => {
    await renderWithProviders(<LoreGuide canSave={false} />);
    // The tour waits for storage to say it has not been seen.
    await new Promise((r) => setTimeout(r, 50));
    expect(await screen.findByText('Add your photos')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('lore-guide')).toHaveTextContent(
      /Open a photo and tap Share to keep it or send it on through another app\./,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(screen.queryByTestId('lore-guide')).toBeNull());
    expect(await AsyncStorage.getItem(LORE_GUIDE_KEY)).toBe('1');
  });

  it('stays out of the way in end-to-end builds', async () => {
    const extra = Constants.expoConfig?.extra as Record<string, unknown>;
    extra.e2e = true;
    try {
      await renderWithProviders(<LoreGuide canSave />);
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByTestId('lore-guide')).toBeNull();
    } finally {
      delete extra.e2e;
    }
  });
});

describe('Lore countdown (D-218)', () => {
  const now = new Date('2026-11-10T10:00:00.000Z');
  it('whole days rounded up, "soon" in the last day, nothing once closed', () => {
    expect(loreCountdown(new Date('2026-11-13T09:00:00.000Z'), now)).toEqual({
      days: 3,
      soon: false,
    });
    expect(loreCountdown(new Date('2026-11-10T15:00:00.000Z'), now)).toEqual({
      days: 1,
      soon: true,
    });
    expect(loreCountdown(now, now)).toBeNull();
  });
});
