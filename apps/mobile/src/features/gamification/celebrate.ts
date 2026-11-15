import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BadgeView } from '@touchgrass/shared';

/** Badges this person has already been shown, per account on this install (D-205). */
export function seenBadgesKey(userId: string): string {
  return `tg:badges-seen:v1:${userId}`;
}

/** The badge keys already celebrated, or null when this install has never checked for this account. */
export async function loadSeenBadges(userId: string): Promise<Set<string> | null> {
  try {
    const raw = await AsyncStorage.getItem(seenBadgesKey(userId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : []);
  } catch {
    return null;
  }
}

export async function saveSeenBadges(userId: string, seen: Set<string>): Promise<void> {
  await AsyncStorage.setItem(seenBadgesKey(userId), JSON.stringify([...seen]));
}

/** Earned badges not celebrated yet, oldest first, so a burst plays in the order they were won. */
export function newlyEarned(items: readonly BadgeView[], seen: ReadonlySet<string>): BadgeView[] {
  return items
    .filter((b) => b.earnedAt !== null && !seen.has(b.key))
    .sort((a, b) => (a.earnedAt ?? '').localeCompare(b.earnedAt ?? ''));
}
