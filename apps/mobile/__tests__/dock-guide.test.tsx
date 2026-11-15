import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { DOCK_GUIDE_KEY, DockGuide } from '../components/DockGuide';
import { type GuideRect, type GuideStep, useGuideTargets } from '../components/guide/targets';
import { renderWithProviders, resetStores } from '../test-utils';

/** Boxes as a 390 x 844 phone would measure them: the list/map switch near the top, the dock at the bottom. */
const BOXES: Record<GuideStep, GuideRect> = {
  view: { x: 16, y: 120, width: 358, height: 48 },
  discover: { x: 12, y: 780, width: 64, height: 48 },
  plans: { x: 80, y: 780, width: 64, height: 48 },
  plot: { x: 168, y: 752, width: 54, height: 54 },
  chats: { x: 246, y: 780, width: 64, height: 48 },
  squad: { x: 314, y: 780, width: 64, height: 48 },
};

function measureAll(only?: GuideStep[]): void {
  for (const [k, r] of Object.entries(BOXES) as [GuideStep, GuideRect][])
    if (!only || only.includes(k)) useGuideTargets.getState().set(k, r);
}

describe('first-launch tour (D-198, D-205)', () => {
  beforeEach(async () => {
    resetStores();
    useGuideTargets.setState({ rects: {} });
    await AsyncStorage.clear();
  });

  it('starts at List or map, then walks the five dock buttons, then never again', async () => {
    measureAll();
    const first = await renderWithProviders(<DockGuide />);
    expect(await screen.findByText('List or map')).toBeOnTheScreen();
    expect(screen.getByText('1 of 6')).toBeOnTheScreen();
    for (const title of ['Explore', 'Plans', 'Plot a plan', 'Chats', 'Squad']) {
      await fireEvent.press(screen.getByTestId('dock-guide-next'));
      expect(await screen.findByText(title)).toBeOnTheScreen();
    }
    expect(screen.getByRole('button', { name: 'Got it' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('dock-guide-next'));
    expect(screen.queryByTestId('dock-guide')).toBeNull();
    expect(await AsyncStorage.getItem(DOCK_GUIDE_KEY)).toBe('1');
    await first.unmount();
    await renderWithProviders(<DockGuide />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('dock-guide')).toBeNull();
  });

  it('draws the ring on the measured box of the control it describes', async () => {
    measureAll();
    await renderWithProviders(<DockGuide />);
    await screen.findByText('List or map');
    for (let i = 0; i < 3; i += 1) await fireEvent.press(screen.getByTestId('dock-guide-next'));
    expect(await screen.findByText('Plot a plan')).toBeOnTheScreen();
    const ring = StyleSheet.flatten(screen.getByTestId('dock-guide-ring').props.style) as {
      left: number;
      top: number;
      width: number;
      height: number;
    };
    // The raised + button: its own box, padded by 6 on every side.
    expect(ring).toMatchObject({ left: 162, top: 746, width: 66, height: 66 });
  });

  it('leaves out a control that is not on screen, and waits for the dock', async () => {
    measureAll(['view']);
    await renderWithProviders(<DockGuide />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('dock-guide')).toBeNull();
    await act(() => {
      measureAll(['discover', 'plans', 'plot', 'chats', 'squad']);
      useGuideTargets.getState().set('view', null);
    });
    expect(await screen.findByText('Explore')).toBeOnTheScreen();
    expect(screen.getByText('1 of 5')).toBeOnTheScreen();
  });

  it('Back returns to the previous tip, and the first tip has none', async () => {
    measureAll();
    await renderWithProviders(<DockGuide />);
    expect(await screen.findByText('1 of 6')).toBeOnTheScreen();
    expect(screen.queryByTestId('dock-guide-back')).toBeNull();
    await fireEvent.press(screen.getByTestId('dock-guide-next'));
    expect(await screen.findByText('2 of 6')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('dock-guide-back'));
    expect(await screen.findByText('1 of 6')).toBeOnTheScreen();
    expect(await AsyncStorage.getItem(DOCK_GUIDE_KEY)).toBeNull();
  });

  it('Skip ends it at once', async () => {
    measureAll();
    await renderWithProviders(<DockGuide />);
    await fireEvent.press(await screen.findByTestId('dock-guide-skip'));
    expect(screen.queryByTestId('dock-guide')).toBeNull();
    expect(await AsyncStorage.getItem(DOCK_GUIDE_KEY)).toBe('1');
  });
});
