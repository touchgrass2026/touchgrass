import {
  fillParams,
  type NotificationKind,
  type NotificationParams,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
  translate,
} from '@touchgrass/shared';

/**
 * The two-hours-ahead reminder (D-211). With a place people may already see, it reads "Starts at 7pm at
 * Lamakaan. Tap for directions." and opens the plan with directions ready; without one (a mystery spot before
 * its reveal, or no place on file) it stays the plain "starts soon" copy, so nothing leaks.
 */
export function soonReminder(
  plan: { id: string; title: string },
  when: { at: string; tz: string },
  place: string | null,
): { kind: NotificationKind; params: NotificationParams } {
  if (!place)
    return { kind: 'reminder_soon', params: { title: plan.title, eventId: plan.id, when } };
  return {
    kind: 'reminder_soon_place',
    params: {
      title: plan.title,
      eventId: plan.id,
      when,
      time: { ...when, clock: true },
      place,
    },
  };
}

/** "3 picks" / "1 pick" in every language, as a per-language param (the template has no plural rules). */
export function picksLabel(count: number): Record<SupportedLanguage, string> {
  const key =
    count === 1
      ? 'notifications.kinds.weekendDigest.one'
      : 'notifications.kinds.weekendDigest.other';
  const out = {} as Record<SupportedLanguage, string>;
  for (const lang of SUPPORTED_LANGUAGES)
    out[lang] = fillParams(translate(key, lang), { count }, lang);
  return out;
}
