import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { mediaLibrary } from './media-library';

/** A Lore photo to keep: a short-lived full-size link and the item it belongs to. */
export interface LorePhotoLink {
  id: string;
  url: string;
}

export type GallerySaveResult =
  | { status: 'saved'; count: number }
  /** The person said no to adding photos; Settings is the only way back. */
  | { status: 'denied' }
  /** This build has no photo library module (pre-D-218 APK): use the share sheet. */
  | { status: 'unavailable' };

/** The photo downloaded into the app cache, ready for the gallery or the share sheet. */
async function download(photo: LorePhotoLink): Promise<string> {
  const file = await File.downloadFileAsync(
    photo.url,
    new File(Paths.cache, `lore-${photo.id}.webp`),
    { idempotent: true },
  );
  return file.uri;
}

/** "Save to phone" is offered only where the build can write to the photo library (D-218). */
export function canSaveToGallery(): boolean {
  return mediaLibrary() !== null;
}

/**
 * Saves Lore photos into the phone's gallery (D-218). Asks for add-only photo access first (iOS "Add
 * Photos Only"; nothing to ask on Android 13+). Each photo is downloaded to the cache and handed to the
 * system photo library; nothing leaves the device.
 */
export async function saveToGallery(photos: LorePhotoLink[]): Promise<GallerySaveResult> {
  const library = mediaLibrary();
  if (!library) return { status: 'unavailable' };
  const permission = await library.requestPermissionsAsync(true);
  if (!permission.granted) return { status: 'denied' };
  let count = 0;
  for (const photo of photos) {
    await library.saveToLibraryAsync(await download(photo));
    count += 1;
  }
  return { status: 'saved', count };
}

/**
 * Shares one Lore photo (F-AFT-04): downloaded to the app cache, then the system share sheet opens, where
 * people send it on (or keep it, through whatever the sheet offers). Nothing leaves the device without
 * their action.
 */
export async function sharePhoto(photo: LorePhotoLink): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(await download(photo), { mimeType: 'image/webp' });
  return true;
}
