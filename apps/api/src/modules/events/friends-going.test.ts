import { describe, expect, it } from 'vitest';
import { FRIENDS_GOING_FACES, friendsGoing, guestListVisible } from './friends-going.js';

const viewer = {
  userId: 'me',
  squad: new Set(['a', 'b', 'c', 'd', 'e', 'hidden', 'blocked']),
  blocked: new Set(['blocked', 'stranger-blocked']),
};
const shown = new Set(['a', 'b', 'c', 'd', 'e', 'blocked', 'x', 'me']);

describe('friendsGoing (D-210)', () => {
  it('keeps only squad members, in seat order, with at most three faces', () => {
    const r = friendsGoing(['x', 'b', 'a', 'c', 'd', 'e'], viewer, shown);
    expect(r.ids).toEqual(['b', 'a', 'c']);
    expect(r.ids).toHaveLength(FRIENDS_GOING_FACES);
    expect(r.total).toBe(5);
  });

  it('never shows or counts the viewer, blocked people or people who hide their attendance', () => {
    const r = friendsGoing(['me', 'blocked', 'hidden', 'a'], viewer, shown);
    expect(r).toEqual({ ids: ['a'], total: 1 });
  });

  it('is empty when no friends hold a seat', () => {
    expect(friendsGoing(['x', 'y'], viewer, shown)).toEqual({ ids: [], total: 0 });
    expect(friendsGoing([], viewer, shown)).toEqual({ ids: [], total: 0 });
  });
});

describe('guestListVisible', () => {
  const outsider = { hostRole: null, invited: false, rsvp: null };
  it('opens the guest list of public plans to everyone', () => {
    expect(guestListVisible('public', outsider)).toBe(true);
    expect(guestListVisible('friends_of_friends', outsider)).toBe(true);
  });
  it('keeps private plans for people the host let in', () => {
    expect(guestListVisible('approval', outsider)).toBe(false);
    expect(guestListVisible('approval', { ...outsider, invited: true })).toBe(true);
    expect(guestListVisible('approval', { ...outsider, rsvp: 'going' })).toBe(true);
    expect(guestListVisible('approval', { ...outsider, hostRole: 'co_host' })).toBe(true);
  });
});
