import { useCallback, useEffect, useRef } from 'react';
import type { HostInstance, LayoutChangeEvent } from 'react-native';
import { create } from 'zustand';

/** What the first-launch tour points at, in order (D-205): the list/map switch on Explore, then the dock. */
export const GUIDE_STEPS = ['view', 'discover', 'plans', 'plot', 'chats', 'squad'] as const;
export type GuideStep = (typeof GUIDE_STEPS)[number];

/** A target's box in window coordinates. */
export interface GuideRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GuideTargets {
  rects: Partial<Record<GuideStep, GuideRect>>;
  set: (key: GuideStep, rect: GuideRect | null) => void;
}

export const useGuideTargets = create<GuideTargets>((set) => ({
  rects: {},
  set: (key, rect) => {
    set((s) => {
      const prev = s.rects[key];
      if (rect === null) {
        if (!prev) return s;
        return {
          rects: Object.fromEntries(Object.entries(s.rects).filter(([k]) => k !== key)),
        };
      }
      if (
        prev &&
        prev.x === rect.x &&
        prev.y === rect.y &&
        prev.width === rect.width &&
        prev.height === rect.height
      )
        return s;
      return { rects: { ...s.rects, [key]: rect } };
    });
  },
}));

/** A view's box in window coordinates (one place, so tests can stand in for the native measurement). */
export function measureInWindowOf(
  node: HostInstance | null,
  done: (x: number, y: number, width: number, height: number) => void,
): void {
  node?.measureInWindow(done);
}

/**
 * Registers a view as a tour target. Spread the result on the view: its real on-screen box is measured
 * after each layout, so the ring and the tip line up with it on every device.
 */
export function useGuideTarget(key: GuideStep): {
  ref: React.RefObject<HostInstance | null>;
  onLayout: (e: LayoutChangeEvent) => void;
  collapsable: false;
} {
  const ref = useRef<HostInstance | null>(null);
  const setRect = useGuideTargets((s) => s.set);
  // Forget the box when the view goes away, so the tour never points at a stale spot.
  useEffect(
    () => () => {
      setRect(key, null);
    },
    [key, setRect],
  );
  const onLayout = useCallback(() => {
    // Measure on the next frame, once the layout has been applied on screen.
    requestAnimationFrame(() => {
      measureInWindowOf(ref.current, (x, y, width, height) => {
        if (width > 0 && height > 0) setRect(key, { x, y, width, height });
      });
    });
  }, [key, setRect]);
  return { ref, onLayout, collapsable: false };
}
