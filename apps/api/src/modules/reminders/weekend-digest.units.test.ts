import { renderNotification } from '@touchgrass/shared';
import { describe, expect, it } from 'vitest';
import type { ViewerFacts } from '../events/event.policy.js';
import type { EventCore } from '../events/event-store.service.js';
import {
  isWeekendPick,
  rankWeekendPicks,
  weekendDigestDue,
  weekendWindow,
  weekRefId,
  zonedTimeToUtc,
} from '../discovery/weekend.js';
import { picksLabel, soonReminder } from './reminder-copy.js';

const IST = 'Asia/Kolkata';
const DUBAI = 'Asia/Dubai';
const BERLIN = 'Europe/Berlin';

describe('weekend window and send time per city zone (D-211)', () => {
  it('converts a local wall-clock time to UTC, across zones and DST', () => {
    expect(zonedTimeToUtc(2026, 11, 20, 17, 0, IST).toISOString()).toBe('2026-11-20T11:30:00.000Z');
    expect(zonedTimeToUtc(2026, 11, 20, 17, 0, DUBAI).toISOString()).toBe(
      '2026-11-20T13:00:00.000Z',
    );
    // Berlin: winter UTC+1, summer UTC+2.
    expect(zonedTimeToUtc(2026, 1, 9, 17, 0, BERLIN).toISOString()).toBe(
      '2026-01-09T16:00:00.000Z',
    );
    expect(zonedTimeToUtc(2026, 7, 10, 17, 0, BERLIN).toISOString()).toBe(
      '2026-07-10T15:00:00.000Z',
    );
  });

  it('runs Friday 17:00 to Monday 00:00 local; from now once the weekend has started', () => {
    // Thursday 19 Nov 2026, 18:45 IST.
    const thu = new Date('2026-11-19T13:15:00Z');
    expect(weekendWindow(thu, IST)).toEqual({
      from: new Date('2026-11-20T11:30:00Z'),
      to: new Date('2026-11-22T18:30:00Z'),
    });
    // Saturday afternoon: the rest of the weekend.
    const sat = new Date('2026-11-21T09:00:00Z');
    expect(weekendWindow(sat, IST)).toEqual({ from: sat, to: new Date('2026-11-22T18:30:00Z') });
    // Monday morning: this coming weekend.
    expect(weekendWindow(new Date('2026-11-16T04:00:00Z'), IST).from).toEqual(
      new Date('2026-11-20T11:30:00Z'),
    );
  });

  it('is due on Thursday between 18:30 and 20:30 in the city’s own zone only', () => {
    expect(weekendDigestDue(new Date('2026-11-19T13:00:00Z'), IST)).toBe(true); // 18:30 IST
    expect(weekendDigestDue(new Date('2026-11-19T12:59:00Z'), IST)).toBe(false); // 18:29 IST
    expect(weekendDigestDue(new Date('2026-11-19T15:00:00Z'), IST)).toBe(false); // 20:30 IST
    // The same instant is 17:00 in Dubai: not yet. Dubai's 18:30 is 14:30 UTC.
    expect(weekendDigestDue(new Date('2026-11-19T13:00:00Z'), DUBAI)).toBe(false);
    expect(weekendDigestDue(new Date('2026-11-19T14:30:00Z'), DUBAI)).toBe(true);
    // Wednesday at 18:30 IST.
    expect(weekendDigestDue(new Date('2026-11-18T13:00:00Z'), IST)).toBe(false);
  });

  it('claims with one stable uuid per ISO week', () => {
    const a = weekRefId('2026-W47');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(weekRefId('2026-W47')).toBe(a);
    expect(weekRefId('2026-W48')).not.toBe(a);
  });
});

describe('weekend picks: ranking and eligibility (D-211)', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 21, h));
  it('ranks interest matches first, then closeness, then the earlier plan; keeps the top three', () => {
    const ranked = rankWeekendPicks([
      { id: 'far-match', interestMatches: 2, distanceMeters: 20_000, startsAt: at(10) },
      { id: 'near-none', interestMatches: 0, distanceMeters: 100, startsAt: at(9) },
      { id: 'near-match', interestMatches: 2, distanceMeters: 500, startsAt: at(12) },
      { id: 'one-match', interestMatches: 1, distanceMeters: 1000, startsAt: at(8) },
      { id: 'tie-later', interestMatches: 0, distanceMeters: 100, startsAt: at(11) },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['near-match', 'far-match', 'one-match']);
  });

  it('ignores distance when the member’s area is unknown', () => {
    const ranked = rankWeekendPicks(
      [
        { id: 'b', interestMatches: 0, distanceMeters: null, startsAt: at(12) },
        { id: 'a', interestMatches: 0, distanceMeters: null, startsAt: at(9) },
      ],
      3,
    );
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b']);
  });

  const window = { from: new Date('2026-11-20T11:30:00Z'), to: new Date('2026-11-22T18:30:00Z') };
  const now = new Date('2026-11-19T13:00:00Z');
  const core = (over: Partial<EventCore> = {}): EventCore =>
    ({
      id: 'e1',
      status: 'published',
      held: false,
      mystery: false,
      mysteryRevealMinutesBefore: 60,
      visibility: 'public',
      startsAt: new Date('2026-11-21T12:00:00Z'),
      endsAt: new Date('2026-11-21T14:00:00Z'),
      capacity: 10,
      balancedMaxSharePct: null,
      ...over,
    }) as EventCore;
  const facts = (over: Partial<ViewerFacts> = {}): ViewerFacts => ({
    hostRole: null,
    invited: false,
    rsvp: null,
    relationshipToHosts: 'none',
    blockedWithHost: false,
    gender: 'man',
    verified: true,
    ...over,
  });

  it('takes an open plan in the window that the member has not joined', () => {
    expect(isWeekendPick(core(), facts(), 3, window, now)).toBe(true);
    expect(isWeekendPick(core(), facts({ rsvp: 'interested' }), 3, window, now)).toBe(true);
  });

  it.each([
    ['full', core(), facts(), 10],
    ['cancelled', core({ status: 'cancelled' }), facts(), 0],
    ['held for review', core({ held: true }), facts(), 0],
    ['a mystery', core({ mystery: true }), facts(), 0],
    ['before the window', core({ startsAt: new Date('2026-11-20T10:00:00Z') }), facts(), 0],
    ['after the window', core({ startsAt: new Date('2026-11-22T19:00:00Z') }), facts(), 0],
    ['women-only for a man', core({ visibility: 'women_only' }), facts(), 0],
    ['already going', core(), facts({ rsvp: 'going' }), 1],
    ['waitlisted', core(), facts({ rsvp: 'waitlisted' }), 1],
    ['their own plan', core(), facts({ hostRole: 'host' }), 0],
    ['blocked with the host', core(), facts({ blockedWithHost: true }), 0],
    ['invite-only', core({ visibility: 'invite_only' }), facts(), 0],
    ['private, needing approval', core({ visibility: 'approval' }), facts(), 0],
  ] as const)('leaves out a plan that is %s', (_, c, f, seats) => {
    expect(isWeekendPick(c, f, seats, window, now)).toBe(false);
  });
});

describe('weekend digest and starts-soon copy (D-211)', () => {
  it('reads "This weekend: 3 picks for you" in each language and opens the picks', () => {
    const r = renderNotification(
      'weekend_digest',
      { picks: picksLabel(3), titles: 'Frisbee, Quiz, Pottery', ids: 'a,b,c' },
      'en',
    );
    expect(r).toEqual({
      title: 'This weekend: 3 picks for you',
      body: 'Frisbee, Quiz, Pottery. Tap to see them.',
      path: 'weekend?ids=a,b,c',
    });
    expect(picksLabel(1).en).toBe('1 pick');
    expect(picksLabel(2).te).toContain('2');
    expect(
      renderNotification('weekend_digest', { picks: picksLabel(2), titles: 'x', ids: 'a' }, 'hi')
        .title,
    ).toContain('2');
  });

  const plan = { id: 'evt-1', title: 'Open mic' };
  const when = { at: '2026-11-21T13:30:00.000Z', tz: IST };

  it('names the place and the local time, and opens the plan with directions ready', () => {
    const copy = soonReminder(plan, when, 'Lamakaan');
    expect(copy.kind).toBe('reminder_soon_place');
    const r = renderNotification(copy.kind, copy.params, 'en');
    expect(r.title).toBe('Open mic starts soon');
    expect(r.body).toMatch(/^Starts at 7:00\s?pm at Lamakaan\. Tap for directions\.$/i);
    expect(r.path).toBe('events/evt-1?directions=1');
  });

  it('shows the time in the plan’s city zone', () => {
    const r = renderNotification(
      soonReminder(plan, { ...when, tz: DUBAI }, 'Alserkal').kind,
      soonReminder(plan, { ...when, tz: DUBAI }, 'Alserkal').params,
      'en',
    );
    expect(r.body).toMatch(/5:30\s?pm/i);
  });

  it('keeps the plain copy, with no place, while a mystery spot is hidden', () => {
    const copy = soonReminder(plan, when, null);
    expect(copy.kind).toBe('reminder_soon');
    const r = renderNotification(copy.kind, copy.params, 'en');
    expect(r.body).toMatch(/Check-in opens 30 minutes before\.$/);
    expect(r.path).toBe('events/evt-1');
    expect(JSON.stringify(copy.params)).not.toContain('place');
  });
});
