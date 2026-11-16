const DAY_MS = 24 * 3_600_000;

/**
 * How long until a Lore album closes (D-218): whole days, rounded up ("closes in 3 days"), or `soon` inside
 * the last day. Null once it has closed.
 */
export function loreCountdown(closesAt: Date, now: Date): { days: number; soon: boolean } | null {
  const left = closesAt.getTime() - now.getTime();
  if (left <= 0) return null;
  return { days: Math.ceil(left / DAY_MS), soon: left < DAY_MS };
}
