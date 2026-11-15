import { LIMITS } from '@touchgrass/shared';

const C = LIMITS.chat;

export type EventChatState = 'not_open' | 'open' | 'read_only' | 'ended';

export interface EventChatTimes {
  startsAt: Date;
  endsAt: Date;
  status: string;
  /** When a cancelled plan was called off (unknown: the planned end is used instead). */
  cancelledAt?: Date | null;
}

/**
 * Event chats (F-CHT-02, D-208): open 24 h before the start and stay writable until they close, 48 h after the
 * end. A cancelled plan's chat is read-only straight away and closes 48 h after the cancellation (or the planned
 * end, if that is sooner). A closed chat has ended: it leaves everyone's inbox and cannot be opened, but its
 * messages are kept (moderation, reports, account export and erasure).
 */
export function eventChatState(e: EventChatTimes, now: Date): EventChatState {
  if (e.status === 'draft') return 'not_open';
  if (eventChatEnded(eventChatClosesAt(e), now)) return 'ended';
  if (e.status === 'cancelled') return 'read_only';
  if (now.getTime() < eventChatOpensAt(e).getTime()) return 'not_open';
  return 'open';
}
export const eventChatOpensAt = (e: { startsAt: Date }): Date =>
  new Date(e.startsAt.getTime() - C.eventChatOpensBeforeMs);
/** When the chat closes and leaves the inbox. */
export function eventChatClosesAt(
  e: Pick<EventChatTimes, 'endsAt' | 'status' | 'cancelledAt'>,
): Date {
  const until =
    e.status === 'cancelled' && e.cancelledAt
      ? Math.min(e.endsAt.getTime(), e.cancelledAt.getTime())
      : e.endsAt.getTime();
  return new Date(until + C.eventChatClosesAfterMs);
}
/** Still usable up to and including the closing instant (the inbox query uses the same `>=`). */
export const eventChatEnded = (closesAt: Date, now: Date): boolean =>
  now.getTime() > closesAt.getTime();

/**
 * Direct messages (F-CHT-01): squad, or people who shared a plan in the last 30 days, chat freely; anyone else
 * starts with a message request. Blocks make each other unreachable.
 */
export function dmPermission(p: {
  blocked: boolean;
  squad: boolean;
  sharedRecentPlan: boolean;
}): 'direct' | 'request' | 'forbidden' {
  if (p.blocked) return 'forbidden';
  return p.squad || p.sharedRecentPlan ? 'direct' : 'request';
}

export function directKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function canDeleteForEveryone(sentAt: Date, now: Date): boolean {
  return now.getTime() - sentAt.getTime() <= C.deleteForEveryoneWindowMs;
}

/** "Forever" is stored as a far-future instant so a single comparison answers "is it muted now". */
export const MUTED_FOREVER = new Date('9999-12-31T00:00:00.000Z');
export function muteUntil(
  duration: 'off' | 'hour' | 'day' | 'week' | 'forever',
  now: Date,
): Date | null {
  const H = 3_600_000;
  switch (duration) {
    case 'off':
      return null;
    case 'hour':
      return new Date(now.getTime() + H);
    case 'day':
      return new Date(now.getTime() + 24 * H);
    case 'week':
      return new Date(now.getTime() + 7 * 24 * H);
    case 'forever':
      return MUTED_FOREVER;
  }
}

/** UUID v7 ids carry their creation time; messages are partitioned on it. */
export function uuidV7Time(id: string): Date {
  return new Date(parseInt(id.replace(/-/g, '').slice(0, 12), 16));
}

export function excerpt(text: string | null, max = 80): string | null {
  if (text === null) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A UUID v7 for a given instant (back-dated history such as seeds/imports; normal writes use uuidv7()). */
export function uuidV7At(at: Date, random: () => number = Math.random): string {
  const hex = at.getTime().toString(16).padStart(12, '0');
  const rand = Array.from({ length: 20 }, () => Math.floor(random() * 16).toString(16)).join('');
  const variant = ((parseInt(rand.charAt(3), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${rand.slice(0, 3)}-${variant}${rand.slice(4, 7)}-${rand.slice(7, 19)}`;
}
