import type { TFunction } from 'i18next';

/**
 * How long ago a story was posted or viewed (D-207), Instagram-style: "Just now", "12m", "3h". `long` is the
 * spoken form for screen readers ("3 hours ago"). Stories live 24 hours, so hours are the largest unit.
 */
export function storyAge(
  t: TFunction,
  iso: string,
  now: number = Date.now(),
): { short: string; long: string } {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return { short: t('stories.justNow'), long: t('stories.justNow') };
  if (minutes < 60)
    return {
      short: t('stories.ageMinutes', { count: minutes }),
      long: t('stories.ageMinutesLong', { count: minutes }),
    };
  const hours = Math.floor(minutes / 60);
  return {
    short: t('stories.ageHours', { count: hours }),
    long: t('stories.ageHoursLong', { count: hours }),
  };
}
