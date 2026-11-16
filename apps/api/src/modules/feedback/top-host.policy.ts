import { LIMITS } from '@touchgrass/shared';

const A = LIMITS.after;

/** Ratings a host received inside the top-host window. */
export interface RecentHostRatings {
  count: number;
  sum: number;
}

/** Start of the window the "Top host" rule looks at (D-210). */
export function topHostWindowStart(now: Date): Date {
  return new Date(now.getTime() - A.topHostWindowDays * 24 * 3600 * 1000);
}

/**
 * "Top host" (D-210): at least `topHostMinRatings` (5) host ratings from guests in the last
 * `topHostWindowDays` (90) days, averaging at least `topHostMinAverage` (4.5) stars. The average is exact
 * (not the one-decimal display value), so 4.46 does not round its way in.
 */
export function isTopHost(r: RecentHostRatings): boolean {
  return r.count >= A.topHostMinRatings && r.sum >= A.topHostMinAverage * r.count;
}
