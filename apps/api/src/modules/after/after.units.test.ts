import { describe, expect, it } from 'vitest';
import { DISCOVERY_WEIGHTS, scoreEvent } from '../discovery/ranking.js';
import { feedbackBlock, feedbackOpenUntil, tally } from '../feedback/feedback.policy.js';
import {
  closingReminderWindow,
  coverSource,
  loreAccess,
  loreClosed,
  loreClosesAt,
} from '../lore/lore.policy.js';
import { reconnectState } from './after.service.js';

const END = new Date('2026-11-01T14:30:00.000Z');
const DAY = 86_400_000;

describe('feedback window (F-AFT-02)', () => {
  const plan = { status: 'completed', endsAt: END };
  const guest = { checkedIn: true, isHost: false };
  it('checked-in guests, after the end, for 14 days', () => {
    expect(feedbackBlock(guest, plan, new Date(END.getTime() + DAY))).toBeNull();
    expect(feedbackBlock(guest, plan, new Date(END.getTime() - 1))).toBe('NOT_YET');
    expect(feedbackBlock(guest, plan, new Date(END.getTime() + 14 * DAY + 1))).toBe(
      'FEEDBACK_CLOSED',
    );
    expect(feedbackBlock({ checkedIn: false, isHost: false }, plan, END)).toBe('NOT_ATTENDED');
    expect(feedbackBlock({ checkedIn: true, isHost: true }, plan, END)).toBe('HOST');
    expect(feedbackBlock(guest, { ...plan, status: 'cancelled' }, END)).toBe('FEEDBACK_CLOSED');
    expect(feedbackOpenUntil(END).getTime()).toBe(END.getTime() + 14 * DAY);
  });
  it('tallies tags, most common first then alphabetically', () => {
    expect(tally([['b', 'a'], ['a'], ['c', 'b']], 2)).toEqual([
      { tag: 'a', count: 2 },
      { tag: 'b', count: 2 },
    ]);
  });
});

describe('reconnect state (F-AFT-03)', () => {
  it('squad wins, then my pull, then theirs', () => {
    expect(reconnectState('squad', true, true)).toBe('squad');
    expect(reconnectState('request_sent', true, false)).toBe('pulled');
    expect(reconnectState('none', false, true)).toBe('pulled_you');
    expect(reconnectState('request_received', false, false)).toBe('pulled_you');
    expect(reconnectState('request_sent', false, false)).toBe('request_sent');
    expect(reconnectState('none', false, false)).toBe('none');
  });
});

describe('Lore access (F-AFT-04, D-218)', () => {
  const started = {
    status: 'completed',
    startsAt: new Date(END.getTime() - 2 * 3_600_000),
    endsAt: END,
  };
  const outsider = { seated: false, attended: false, isHost: false, squadOfAttendee: false };
  const open = { visibility: 'attendees' as const, guestsCanAdd: true };
  const hostsOnly = { ...open, guestsCanAdd: false };
  it('everyone holding a seat and hosts see and add; squads only see when allowed', () => {
    expect(loreAccess({ ...outsider, attended: true, seated: true }, started, open, END)).toEqual({
      view: true,
      add: true,
      manage: false,
      closed: false,
    });
    // Going but never checked in: still in the plan, so they add too.
    expect(loreAccess({ ...outsider, seated: true }, started, open, END)).toEqual({
      view: true,
      add: true,
      manage: false,
      closed: false,
    });
    expect(loreAccess({ ...outsider, isHost: true }, started, open, END)).toEqual({
      view: true,
      add: true,
      manage: true,
      closed: false,
    });
    expect(loreAccess({ ...outsider, squadOfAttendee: true }, started, open, END).view).toBe(false);
    expect(
      loreAccess(
        { ...outsider, squadOfAttendee: true },
        started,
        { ...open, visibility: 'friends_of_attendees' },
        END,
      ),
    ).toEqual({ view: true, add: false, manage: false, closed: false });
    expect(
      loreAccess(outsider, started, { ...open, visibility: 'friends_of_attendees' }, END),
    ).toEqual({ view: false, add: false, manage: false, closed: false });
    expect(coverSource(['a', 'b'])).toBe('a,b');
  });

  it('hosts can keep adding to themselves; guests still see the album', () => {
    expect(loreAccess({ ...outsider, seated: true }, started, hostsOnly, END)).toEqual({
      view: true,
      add: false,
      manage: false,
      closed: false,
    });
    expect(loreAccess({ ...outsider, isHost: true }, started, hostsOnly, END).add).toBe(true);
  });

  it('opens at the start, closes 7 days after the end, never for cancelled plans', () => {
    const seated = { ...outsider, seated: true };
    expect(
      loreAccess(seated, { ...started, startsAt: new Date(END.getTime() + 1) }, open, END).view,
    ).toBe(false);
    expect(loreAccess(seated, { ...started, status: 'cancelled' }, open, END)).toEqual({
      view: false,
      add: false,
      manage: false,
      closed: false,
    });
    const lastMoment = new Date(END.getTime() + 7 * DAY - 1);
    expect(loreAccess(seated, started, open, lastMoment).view).toBe(true);
    expect(loreClosesAt(END).getTime()).toBe(END.getTime() + 7 * DAY);
    const closedAt = new Date(END.getTime() + 7 * DAY);
    expect(loreClosed(END, closedAt)).toBe(true);
    expect(loreClosed(END, lastMoment)).toBe(false);
    // People who would have seen it are told it closed; everyone else still gets "not found".
    expect(loreAccess(seated, started, open, closedAt)).toEqual({
      view: false,
      add: false,
      manage: false,
      closed: true,
    });
    expect(loreAccess({ ...outsider, isHost: true }, started, open, closedAt).manage).toBe(false);
    expect(loreAccess(outsider, started, open, closedAt).closed).toBe(false);
  });

  it('reminds about plans whose album closes within the next day', () => {
    const now = new Date('2026-11-10T10:00:00.000Z');
    const w = closingReminderWindow(now);
    expect(w.endedAfter.toISOString()).toBe('2026-11-03T10:00:00.000Z');
    expect(w.endedBefore.toISOString()).toBe('2026-11-04T10:00:00.000Z');
  });
});

describe('top hosts in ranking (F-AFT-05)', () => {
  const base = {
    interestMatches: 0,
    vibeMatches: 0,
    squadGoing: 0,
    friendsOfFriendsGoing: 0,
    distanceMeters: 8000,
    hoursUntilStart: 120,
    fillRatio: 0,
    soloFriendly: false,
    viewerSquadSize: 10,
    weatherFit: 0 as const,
    hoursSincePublished: 200,
    hostRating: null,
  };
  it('5★ hosts earn the full weight and a reason; ≤3.5★ and unrated hosts are neutral', () => {
    const top = scoreEvent({ ...base, hostRating: 5 });
    const plain = scoreEvent(base);
    expect(top.score - plain.score).toBeCloseTo(DISCOVERY_WEIGHTS.hostRating);
    expect(top.reasons).toContain('top_host');
    expect(scoreEvent({ ...base, hostRating: 3.2 }).score).toBe(plain.score);
  });
});
