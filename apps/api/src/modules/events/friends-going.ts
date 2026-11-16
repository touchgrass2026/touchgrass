import type { EventVisibility } from '@touchgrass/shared';
import { isLetIn, type ViewerFacts } from './event.policy.js';

/** Faces shown with "Meera, Ravi and 2 friends are going" (D-210). */
export const FRIENDS_GOING_FACES = 3;

export interface FriendsGoingViewer {
  userId: string;
  squad: ReadonlySet<string>;
  blocked: ReadonlySet<string>;
}

/**
 * Whether the viewer may learn who holds a seat at all. Private (`approval`) plans keep their guest list for
 * the people the host let in (D-179), so outsiders see no names or faces there, friends included.
 */
export function guestListVisible(
  visibility: EventVisibility,
  facts: Pick<ViewerFacts, 'hostRole' | 'invited' | 'rsvp'>,
): boolean {
  return visibility !== 'approval' || isLetIn(facts);
}

/**
 * Squad members holding a seat, in the order they pulled up (D-210). Never the viewer, never anyone blocked
 * either way, and never anyone who hid themselves from who's-going lists (`shown` holds those who did not):
 * they are neither shown nor counted, so the count cannot give them away.
 */
export function friendsGoing(
  seatHolders: readonly string[],
  viewer: FriendsGoingViewer,
  shown: ReadonlySet<string>,
): { ids: string[]; total: number } {
  const ids = seatHolders.filter(
    (u) => u !== viewer.userId && viewer.squad.has(u) && !viewer.blocked.has(u) && shown.has(u),
  );
  return { ids: ids.slice(0, FRIENDS_GOING_FACES), total: ids.length };
}
