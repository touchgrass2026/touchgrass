import { act, screen } from '@testing-library/react-native';
import { Keyboard, StyleSheet, TextInput } from 'react-native';
import * as targets from '../components/guide/targets';
import { Screen, Text, TextField } from '../components/ui';
import { renderWithProviders, resetStores } from '../test-utils';

type Handler = (e: { endCoordinates: { screenY: number } }) => void;

describe('keyboard never covers what you type (D-222)', () => {
  let handlers: Record<string, Handler>;
  beforeEach(() => {
    resetStores();
    handlers = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, fn: Handler) => {
      handlers[event] = fn;
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);
    // The screen body fills y 100..900 of the window; the focused field sits at y 820.
    jest.spyOn(targets, 'measureInWindowOf').mockImplementation((node, done) => {
      if (node && node === TextInput.State.currentlyFocusedInput()) done(16, 820, 300, 48);
      else done(0, 100, 400, 800);
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const body = (): Record<string, unknown> =>
    StyleSheet.flatten(screen.getByTestId('form-screen-body').props.style) as Record<
      string,
      unknown
    >;

  it('lifts the screen and its pinned button by however much the keyboard covers, then drops back', async () => {
    await renderWithProviders(
      <Screen testID="form-screen" footer={<Text>Publish</Text>}>
        <TextField label="Name" value="" onChangeText={() => undefined} testID="name" />
      </Screen>,
    );
    expect(body().paddingBottom).toBe(0);
    const show = handlers.keyboardDidShow ?? handlers.keyboardWillShow;
    const hide = handlers.keyboardDidHide ?? handlers.keyboardWillHide;
    // Keyboard top at y 600: it covers 900 - 600 = 300 of the screen.
    await act(async () => {
      show?.({ endCoordinates: { screenY: 600 } });
      await Promise.resolve();
    });
    expect(body().paddingBottom).toBe(300);
    await act(async () => {
      hide?.({ endCoordinates: { screenY: 1000 } });
      await Promise.resolve();
    });
    expect(body().paddingBottom).toBe(0);
  });

  it('a keyboard that covers nothing of the screen moves nothing', async () => {
    await renderWithProviders(
      <Screen testID="form-screen">
        <Text>Hi</Text>
      </Screen>,
    );
    const show = handlers.keyboardDidShow ?? handlers.keyboardWillShow;
    await act(async () => {
      show?.({ endCoordinates: { screenY: 950 } });
      await Promise.resolve();
    });
    expect(body().paddingBottom).toBe(0);
  });
});
