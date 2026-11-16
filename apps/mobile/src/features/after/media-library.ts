import { requireOptionalNativeModule } from 'expo';
import type * as MediaLibrary from 'expo-media-library/legacy';

export type MediaLibraryModule = Pick<
  typeof MediaLibrary,
  'requestPermissionsAsync' | 'saveToLibraryAsync'
>;

let loaded: MediaLibraryModule | null | undefined;

/**
 * The photo library (D-218), loaded on first use and only when this build has its native module. Builds
 * from before D-218 run the same JavaScript through over-the-air updates but lack the module, and importing
 * it there would crash, so this answers null and the app offers the share sheet instead.
 */
export function mediaLibrary(): MediaLibraryModule | null {
  if (loaded !== undefined) return loaded;
  try {
    loaded = requireOptionalNativeModule('ExpoMediaLibrary')
      ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module, loaded lazily
        (require('expo-media-library/legacy') as typeof MediaLibrary)
      : null;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Tests only: forget what was loaded. */
export function resetMediaLibraryForTests(): void {
  loaded = undefined;
}
