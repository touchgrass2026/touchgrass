import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

/**
 * Refreshes a screen's data when you come back to its tab (D-215), not on the first visit (the queries
 * load then anyway). Pass the screen's refetch functions; only stale data is refetched by TanStack Query.
 */
export function useRefreshOnFocus(refetchers: readonly (() => Promise<unknown>)[]): void {
  const first = useRef(true);
  const latest = useRef(refetchers);
  latest.current = refetchers;
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      for (const refetch of latest.current) void refetch().catch(() => undefined);
    }, []),
  );
}
