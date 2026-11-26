import { LIMITS } from '@touchgrass/shared';
import { describe, expect, it } from 'vitest';
import {
  acceptedSteps,
  coarsen,
  headcountFlags,
  matchShortCode,
  stepEndsAt,
  ticketShortCode,
  ticketStep,
  ticketToken,
  verifyTicket,
} from './check-in-integrity.js';

const SECRET = 'ticket-secret-ticket-secret-ticket-secret';
const EV = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';
const OTHER_EV = '0192f3a4-5b6c-7d8e-9f01-23456789abcf';
const USER = '0192f3a4-5b6c-7d8e-9f01-23456789abce';
const USER2 = '0192f3a4-5b6c-7d8e-9f01-23456789abc0';
const NOW = new Date('2026-11-23T12:00:10Z');
const STEP = ticketStep(NOW);
const C = LIMITS.checkIn;

describe('rotating tickets (D-227)', () => {
  it('steps are 30 seconds long and rotate at the step boundary', () => {
    expect(ticketStep(new Date(NOW.getTime() + C.ticketStepMs))).toBe(STEP + 1);
    expect(stepEndsAt(STEP).getTime() - NOW.getTime()).toBeLessThanOrEqual(C.ticketStepMs);
    expect(stepEndsAt(STEP).getTime()).toBe((STEP + 1) * C.ticketStepMs);
  });

  it('a current ticket verifies and names its person and plan', () => {
    expect(verifyTicket(SECRET, ticketToken(SECRET, EV, USER, STEP), STEP)).toEqual({
      ok: true,
      eventId: EV,
      userId: USER,
      step: STEP,
    });
  });

  it('the ticket from the step just before still scans (the code rotated while being shown)', () => {
    expect(verifyTicket(SECRET, ticketToken(SECRET, EV, USER, STEP - 1), STEP).ok).toBe(true);
  });

  it('older tickets (a screenshot) have expired', () => {
    expect(verifyTicket(SECRET, ticketToken(SECRET, EV, USER, STEP - 2), STEP)).toEqual({
      ok: false,
      reason: 'TICKET_EXPIRED',
    });
    expect(verifyTicket(SECRET, ticketToken(SECRET, EV, USER, STEP + 5), STEP)).toEqual({
      ok: false,
      reason: 'TICKET_EXPIRED',
    });
  });

  it('static tickets from before rotation are refused as expired', () => {
    expect(verifyTicket(SECRET, `tg1.${EV}.${USER}.${'a'.repeat(32)}`, STEP)).toEqual({
      ok: false,
      reason: 'TICKET_EXPIRED',
    });
  });

  it('a ticket is bound to its person, plan and step: changing any of them breaks the signature', () => {
    const t = ticketToken(SECRET, EV, USER, STEP);
    for (const forged of [
      t.replace(USER, USER2),
      t.replace(EV, OTHER_EV),
      t.replace(`.${STEP}.`, `.${STEP - 1}.`),
      `${t.slice(0, -1)}${t.endsWith('0') ? '1' : '0'}`,
      ticketToken('another-secret-another-secret-another', EV, USER, STEP),
      'nonsense',
    ])
      expect(verifyTicket(SECRET, forged, STEP)).toEqual({ ok: false, reason: 'INVALID_TICKET' });
  });

  it('short codes are six digits, differ per person and step, and match only the seat holder', () => {
    const code = ticketShortCode(SECRET, EV, USER, STEP);
    expect(code).toMatch(/^\d{6}$/);
    expect(ticketShortCode(SECRET, EV, USER, STEP + 1)).not.toBe(code);
    const candidates = [{ eventId: EV, userIds: [USER2, USER] }];
    expect(matchShortCode(SECRET, code, candidates, STEP)).toEqual({
      ok: true,
      eventId: EV,
      userId: USER,
    });
    expect(matchShortCode(SECRET, code, candidates, STEP + 1).ok).toBe(true);
    expect(matchShortCode(SECRET, code, candidates, STEP + 2)).toEqual({
      ok: false,
      reason: 'CODE_UNKNOWN',
    });
    expect(matchShortCode(SECRET, code, [{ eventId: EV, userIds: [USER2] }], STEP).ok).toBe(false);
    expect(matchShortCode(SECRET, code, [{ eventId: OTHER_EV, userIds: [USER] }], STEP).ok).toBe(
      false,
    );
  });

  it('accepts exactly the current step and the grace steps before it', () => {
    expect(acceptedSteps(STEP)).toEqual([STEP, STEP - 1]);
  });
});

describe('coarse locations (D-227)', () => {
  it('rounds to three decimal places (about 110 m)', () => {
    expect(coarsen({ lat: 17.443612, lng: 78.351987 })).toEqual({ lat: 17.444, lng: 78.352 });
  });
});

describe('fake-headcount flags (D-227)', () => {
  const s = (userId: string, deviceHash: string | null, distanceM: number | null = null) => ({
    userId,
    deviceHash,
    distanceM,
  });
  it('no flags for ordinary check-ins', () => {
    expect(headcountFlags([s('a', 'd1', 20), s('b', 'd2', 40), s('c', null)])).toEqual([]);
  });
  it('two people on one phone (a couple) is not enough to flag', () => {
    expect(headcountFlags([s('a', 'd1'), s('b', 'd1')])).toEqual([]);
  });
  it('three or more different people checked in from one phone flags the plan', () => {
    expect(headcountFlags([s('a', 'd1'), s('b', 'd1'), s('c', 'd1'), s('d', 'd2')])).toEqual([
      { kind: 'shared_device', count: 3 },
    ]);
  });
  it('the same person counted twice on one phone is still one person', () => {
    expect(headcountFlags([s('a', 'd1'), s('a', 'd1'), s('b', 'd1')])).toEqual([]);
  });
  it('one check-in far from the spot is noise; two flag the plan', () => {
    expect(headcountFlags([s('a', null, 5000)])).toEqual([]);
    expect(headcountFlags([s('a', null, 5000), s('b', null, 1200), s('c', null, 900)])).toEqual([
      { kind: 'far_from_spot', count: 2 },
    ]);
  });
  it('both flags can apply at once', () => {
    expect(
      headcountFlags([s('a', 'd', 3000), s('b', 'd', 3000), s('c', 'd', 10)]).map((f) => f.kind),
    ).toEqual(['shared_device', 'far_from_spot']);
  });
});
