import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';
import { DOCK_GUIDE_KEY, DockGuide } from '../components/DockGuide';
import { renderWithProviders, resetStores } from '../test-utils';

describe('first-launch dock guide (D-198)', () => {
  beforeEach(async () => {
    resetStores();
    await AsyncStorage.clear();
  });

  const slots = { discover: 40, plans: 110, plot: 180, chats: 250, squad: 320 };

  it('walks the five dock buttons one tip at a time, then never again', async () => {
    const first = await renderWithProviders(<DockGuide slots={slots} dockHeight={70} />);
    expect(await screen.findByText('Explore')).toBeOnTheScreen();
    expect(screen.getByText('1 of 5')).toBeOnTheScreen();
    for (const title of ['Plans', 'Plot a plan', 'Chats', 'Squad']) {
      await fireEvent.press(screen.getByTestId('dock-guide-next'));
      expect(await screen.findByText(title)).toBeOnTheScreen();
    }
    expect(screen.getByRole('button', { name: 'Got it' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('dock-guide-next'));
    expect(screen.queryByTestId('dock-guide')).toBeNull();
    expect(await AsyncStorage.getItem(DOCK_GUIDE_KEY)).toBe('1');
    await first.unmount();
    await renderWithProviders(<DockGuide slots={slots} dockHeight={70} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('dock-guide')).toBeNull();
  });

  it('Back returns to the previous tip, and the first tip has none', async () => {
    await renderWithProviders(<DockGuide slots={slots} dockHeight={70} />);
    expect(await screen.findByText('1 of 5')).toBeOnTheScreen();
    expect(screen.queryByTestId('dock-guide-back')).toBeNull();
    await fireEvent.press(screen.getByTestId('dock-guide-next'));
    expect(await screen.findByText('2 of 5')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('dock-guide-back'));
    expect(await screen.findByText('1 of 5')).toBeOnTheScreen();
    expect(await AsyncStorage.getItem(DOCK_GUIDE_KEY)).toBeNull();
  });

  it('Skip ends it at once', async () => {
    await renderWithProviders(<DockGuide slots={slots} dockHeight={70} />);
    await fireEvent.press(await screen.findByTestId('dock-guide-skip'));
    expect(screen.queryByTestId('dock-guide')).toBeNull();
    expect(await AsyncStorage.getItem(DOCK_GUIDE_KEY)).toBe('1');
  });
});
