import { type RefObject, useEffect, useRef, useState } from 'react';
import {
  type HostInstance,
  Keyboard,
  type KeyboardEvent,
  Platform,
  type ScrollViewInstance,
  TextInput,
} from 'react-native';
import { measureInWindowOf } from '../../components/guide/targets';

/** Room left between the field being typed in and the top of the keyboard. */
const FIELD_GAP = 24;

/**
 * Keeps whatever is being typed in clear of the keyboard (D-222). The app draws edge to edge, so Android no
 * longer shrinks the window for the keyboard: fields and pinned buttons ended up under it. This returns how
 * far the keyboard overlaps `root` (measured in the window, so headers and safe areas don't matter) for the
 * screen to pad by, and once the screen has shrunk, scrolls the focused field into view inside `scroll`.
 */
export function useKeyboardLift(
  root: RefObject<HostInstance | null>,
  scroll: RefObject<ScrollViewInstance | null> | null,
): number {
  const [lift, setLift] = useState(0);
  const visibleHeight = useRef(0);

  useEffect(() => {
    // iOS announces the keyboard before it moves (smoother); Android only once it is up.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent): void => {
      const keyboardTop = e.endCoordinates.screenY;
      measureInWindowOf(root.current, (_x, y, _w, height) => {
        const overlap = Math.max(0, Math.round(y + height - keyboardTop));
        visibleHeight.current = height - overlap;
        setLift(overlap);
      });
    };
    const show = Keyboard.addListener(showEvent, onShow);
    const hide = Keyboard.addListener(hideEvent, () => {
      setLift(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [root]);

  // After the screen has made room, bring the field being typed in into view.
  useEffect(() => {
    if (lift === 0 || !scroll) return undefined;
    const timer = setTimeout(() => {
      const field = TextInput.State.currentlyFocusedInput();
      const view = scroll.current;
      if (!field || !view) return;
      measureInWindowOf(field, (_fx, fieldY, _fw, fieldHeight) => {
        measureInWindowOf(root.current, (_rx, rootY) => {
          const visibleBottom = rootY + visibleHeight.current;
          const below = fieldY + fieldHeight + FIELD_GAP - visibleBottom;
          // Scroll by exactly how far the field sits below the visible area.
          if (below > 0) scrollBy(view, below);
        });
      });
    }, 60);
    return () => {
      clearTimeout(timer);
    };
  }, [lift, root, scroll]);

  return lift;
}

/** ScrollView has no scrollBy; track the offset through its scroll events instead (see Screen). */
const offsets = new WeakMap<object, number>();
export function rememberScrollOffset(view: ScrollViewInstance | null, y: number): void {
  if (view) offsets.set(view, y);
}
function scrollBy(view: ScrollViewInstance, dy: number): void {
  const y = offsets.get(view) ?? 0;
  view.scrollTo({ y: y + dy, animated: true });
}
