import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { ApiError } from './api-client';

/**
 * TanStack Query wired to NetInfo so queries pause offline and refetch on reconnect (F-PLT-04), and to
 * AppState so stale data refetches when the app comes back to the foreground and polling pauses in the
 * background (D-215). Without the AppState link new plans and stories only showed after a restart.
 */
export function createQueryClient(): QueryClient {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (state) => {
      setFocused(state === 'active');
    });
    return () => {
      sub.remove();
    };
  });
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    }),
  );
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 24 * 60 * 60 * 1000,
        retry: (failureCount, error) =>
          failureCount < 3 && (!(error instanceof ApiError) || error.retryable),
        networkMode: 'offlineFirst',
      },
      mutations: { networkMode: 'offlineFirst', retry: false },
    },
  });
}
