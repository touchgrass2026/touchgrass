import type { GeoPoint } from '@touchgrass/shared';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

const coords = (p: GeoPoint): string => `${String(p.lat)},${String(p.lng)}`;

/** Google Maps directions (D-211): opens the Maps app where installed, the browser otherwise. */
export function googleDirectionsUrl(point: GeoPoint): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coords(point)}`;
}

/** Apple Maps directions, with the place name as the pin's label. */
export function appleDirectionsUrl(point: GeoPoint, placeName: string | null): string {
  const q = placeName ? `&q=${encodeURIComponent(placeName)}` : '';
  return `https://maps.apple.com/?daddr=${coords(point)}${q}`;
}

/** The scheme iOS reports when Google Maps is installed (listed in `LSApplicationQueriesSchemes`). */
export const GOOGLE_MAPS_SCHEME = 'comgooglemaps://';

/**
 * Directions to a plan's revealed spot. Google Maps everywhere; on iOS, Apple Maps only when Google Maps isn't
 * installed. Callers pass only an `exact` location (the API sends that only once the viewer may see it).
 */
export async function directionsUrl(
  point: GeoPoint,
  placeName: string | null,
  os: string = Platform.OS,
): Promise<string> {
  if (os !== 'ios') return googleDirectionsUrl(point);
  const hasGoogleMaps = await Linking.canOpenURL(GOOGLE_MAPS_SCHEME).catch(() => false);
  return hasGoogleMaps ? googleDirectionsUrl(point) : appleDirectionsUrl(point, placeName);
}

export async function openDirections(point: GeoPoint, placeName: string | null): Promise<void> {
  await Linking.openURL(await directionsUrl(point, placeName));
}
