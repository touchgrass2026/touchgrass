import { LIMITS, type LoreVisibility } from '@touchgrass/shared';

const DAY_MS = 24 * 3_600_000;

export interface LoreViewer {
  /** Holds a seat on the plan (going or checked in). */
  seated: boolean;
  /** Checked in at the plan (counts for "friends of attendees" albums, through the squad check). */
  attended: boolean;
  isHost: boolean;
  /** Squad of someone who attended (for "friends of attendees" albums). */
  squadOfAttendee: boolean;
}

export interface LoreSettings {
  visibility: LoreVisibility;
  /** Hosts let everyone holding a seat add photos (D-218). */
  guestsCanAdd: boolean;
}

/** When a plan's album closes and its photos are deleted: `availableDays` after the plan ends (D-218). */
export function loreClosesAt(endsAt: Date): Date {
  return new Date(endsAt.getTime() + LIMITS.lore.availableDays * DAY_MS);
}

export function loreClosed(endsAt: Date, now: Date): boolean {
  return now.getTime() >= loreClosesAt(endsAt).getTime();
}

/**
 * Pure rules (F-AFT-04, D-218). An album opens when its plan starts (never for cancelled or draft plans) and
 * closes `availableDays` after it ends. While open, everyone in the plan (a seat, or a host) sees it, and so do
 * attendees' squads when the hosts chose that. Hosts always add; guests add while the hosts allow it.
 * `closed` is true only for someone who would see the album if it were still open, so they get a "closed"
 * answer while everyone else gets "not found".
 */
export function loreAccess(
  viewer: LoreViewer,
  event: { status: string; startsAt: Date; endsAt: Date },
  settings: LoreSettings,
  now: Date,
): { view: boolean; add: boolean; manage: boolean; closed: boolean } {
  const none = { view: false, add: false, manage: false, closed: false };
  const live =
    (event.status === 'published' || event.status === 'completed') && now >= event.startsAt;
  if (!live) return none;
  const insider = viewer.seated || viewer.attended || viewer.isHost;
  const view =
    insider || (settings.visibility === 'friends_of_attendees' && viewer.squadOfAttendee);
  if (!view) return none;
  if (loreClosed(event.endsAt, now)) return { ...none, closed: true };
  return {
    view: true,
    add: viewer.isHost || (insider && settings.guestsCanAdd),
    manage: viewer.isHost,
    closed: false,
  };
}

/** The items a cover collage is made of, as a stable key (the collage is redrawn only when it changes). */
export function coverSource(itemIds: string[]): string {
  return itemIds.join(',');
}

/**
 * The "Lore closes tomorrow" window (D-218): albums of plans whose close falls within the next reminder
 * period, i.e. plans that ended in [now - available, now - available + reminder).
 */
export function closingReminderWindow(now: Date): { endedAfter: Date; endedBefore: Date } {
  const available = LIMITS.lore.availableDays * DAY_MS;
  const ahead = LIMITS.lore.closingReminderHours * 3_600_000;
  return {
    endedAfter: new Date(now.getTime() - available),
    endedBefore: new Date(now.getTime() - available + ahead),
  };
}
