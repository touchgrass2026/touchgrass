import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { DOCK_GUIDE_KEY, DockGuide } from '../components/DockGuide';
import * as targets from '../components/guide/targets';
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

/** The overlay sits below a 24 pt status bar: its own window origin, which the ring must subtract (D-214). */
const OVERLAY = { x: 0, y: 24, width: 390, height: 820 };

/** Renders the tour and lets its overlay learn where it sits, as the native layout pass would. */
async function layoutOverlay(): Promise<void> {
  const backdrop = await screen.findByTestId('dock-guide-backdrop');
  await act(async () => {
    await fireEvent(backdrop, 'layout', { nativeEvent: { layout: OVERLAY } });
    await new Promise((r) => setTimeout(r, 30));
  });
}

async function renderTour(): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  const view = await renderWithProviders(<DockGuide />);
  await layoutOverlay();
  return view;
}

describe('first-launch tour (D-198, D-205, D-214)', () => {
  beforeEach(async () => {
    jest.spyOn(targets, 'measureInWindowOf').mockImplementation((_node, done) => {
      done(OVERLAY.x, OVERLAY.y, OVERLAY.width, OVERLAY.height);
    });
    resetStores();
    useGuideTargets.setState({ rects: {}, measurers: {} });
    await AsyncStorage.clear();
  });

  it('starts at List or map, then walks the five dock buttons, then never again', async () => {
    measureAll();
    const first = await renderTour();
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
    await renderTour();
    await screen.findByText('List or map');
    for (let i = 0; i < 3; i += 1) await fireEvent.press(screen.getByTestId('dock-guide-next'));
    expect(await screen.findByText('Plot a plan')).toBeOnTheScreen();
    const ring = StyleSheet.flatten(screen.getByTestId('dock-guide-ring').props.style) as {
      left: number;
      top: number;
      width: number;
      height: number;
    };
    // The raised + button's box (y 752 in the window) moved into the overlay's own coordinates (y - 24).
    expect(ring).toMatchObject({ left: 162, top: 722, width: 66, height: 66 });
  });

  it('re-measures when it opens, so a control moved after its first layout is ringed where it is now (D-216)', async () => {
    // First measured at y 120; the safe area inset then pushed the screen down 30 without the switch's own
    // layout changing, so only a fresh measurement knows it is now at y 150.
    measureAll();
    const moved = { ...BOXES.view, y: 150 };
    const measureView = jest.fn(() => {
      useGuideTargets.getState().set('view', moved);
    });
    useGuideTargets.getState().setMeasurer('view', measureView);
    await renderTour();
    await screen.findByText('List or map');
    expect(measureView).toHaveBeenCalled();
    const ring = StyleSheet.flatten(screen.getByTestId('dock-guide-ring').props.style) as {
      top: number;
    };
    // 150 in the window, minus the overlay's 24 origin, minus the 6 ring padding.
    expect(ring.top).toBe(120);
  });

  it('leaves out a control that is not on screen, and waits for the dock', async () => {
    measureAll(['view']);
    await renderWithProviders(<DockGuide />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('dock-guide-backdrop')).toBeNull();
    await act(() => {
      measureAll(['discover', 'plans', 'plot', 'chats', 'squad']);
      useGuideTargets.getState().set('view', null);
    });
    await layoutOverlay();
    expect(await screen.findByText('Explore')).toBeOnTheScreen();
    expect(screen.getByText('1 of 5')).toBeOnTheScreen();
  });

  it('Back returns to the previous tip, and the first tip has none', async () => {
    measureAll();
    await renderTour();
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
    await renderTour();
    await fireEvent.press(await screen.findByTestId('dock-guide-skip'));
    expect(screen.queryByTestId('dock-guide')).toBeNull();
    expect(await AsyncStorage.getItem(DOCK_GUIDE_KEY)).toBe('1');
  });
});
