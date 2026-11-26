import { LIMITS, type RefundPolicy } from '@touchgrass/shared';
import { describe, expect, it } from 'vitest';
import {
  adjustBlock,
  allocateTransfers,
  depositOutcome,
  depositRequired,
  disputeBlock,
  disputeRefundAllowed,
  escrowLedger,
  hostCancelCountsAgainstHost,
  hostCancelRefund,
  memberCancelRefund,
  payoutHold,
  plusOneBlock,
  releaseBlock,
  transferBlock,
  transferOpen,
} from './payment.policy.js';

const H = 3_600_000;
const START = new Date('2026-12-05T13:30:00.000Z');
const FULL: RefundPolicy = { kind: 'full', cutoffHours: 24, partialPct: null };

describe('member cancellation refunds (D-229)', () => {
  const base = {
    policy: FULL,
    remainingPaise: 50_000,
    startsAt: START,
    now: new Date(START.getTime() - 48 * H),
    checkedIn: false,
    method: 'upi' as string | null,
  };

  it('refunds per the window before the cut-off', () => {
    expect(memberCancelRefund(base)).toEqual({ refundPaise: 50_000, reason: 'BEFORE_CUTOFF' });
  });

  it('refunds nothing after the cut-off', () => {
    expect(memberCancelRefund({ ...base, now: new Date(START.getTime() - H) })).toEqual({
      refundPaise: 0,
      reason: 'AFTER_CUTOFF',
    });
  });

  it('refunds nothing once the seat was checked in, whatever the window', () => {
    expect(memberCancelRefund({ ...base, checkedIn: true })).toEqual({
      refundPaise: 0,
      reason: 'CHECKED_IN',
    });
  });

  it('returns a free entry whole or not at all', () => {
    const partial: RefundPolicy = { kind: 'partial', cutoffHours: 24, partialPct: 50 };
    expect(memberCancelRefund({ ...base, policy: partial, method: 'credit' }).refundPaise).toBe(0);
    expect(memberCancelRefund({ ...base, method: 'credit' }).refundPaise).toBe(50_000);
  });
});

describe('host cancellation (D-229)', () => {
  it('refunds everything left on the payment', () => {
    expect(hostCancelRefund(42_000)).toEqual({ refundPaise: 42_000, reason: 'HOST_CANCELLED' });
    expect(hostCancelRefund(-5).refundPaise).toBe(0);
  });

  it('counts against the host only when they cancelled a plan people paid for', () => {
    const host = 'h';
    expect(
      hostCancelCountsAgainstHost({ cancelledBy: host, primaryHostId: host, refundedTickets: 2 }),
    ).toBe(true);
    expect(
      hostCancelCountsAgainstHost({
        cancelledBy: 'admin',
        primaryHostId: host,
        refundedTickets: 2,
      }),
    ).toBe(false);
    expect(
      hostCancelCountsAgainstHost({ cancelledBy: null, primaryHostId: host, refundedTickets: 2 }),
    ).toBe(false);
    expect(
      hostCancelCountsAgainstHost({ cancelledBy: host, primaryHostId: host, refundedTickets: 0 }),
    ).toBe(false);
  });
});

describe('disputes (D-229)', () => {
  const base = {
    kind: 'seat',
    status: 'captured',
    endsAt: START,
    now: new Date(START.getTime() + H),
    windowMs: LIMITS.payments.disputeWindowMs,
  };

  it('opens on a paid ticket inside the window', () => {
    expect(disputeBlock(base)).toBeNull();
  });

  it('closes after the window', () => {
    expect(disputeBlock({ ...base, now: new Date(START.getTime() + base.windowMs + 1) })).toBe(
      'DISPUTE_WINDOW_CLOSED',
    );
  });

  it('needs a ticket that is still paid, and never a deposit', () => {
    expect(disputeBlock({ ...base, status: 'refunded' })).toBe('NO_TICKET');
    expect(disputeBlock({ ...base, kind: 'deposit' })).toBe('NOT_PAID_PLAN');
  });

  it('never refunds a checked-in seat', () => {
    expect(disputeRefundAllowed({ checkedIn: true, remainingPaise: 100 })).toBe(false);
    expect(disputeRefundAllowed({ checkedIn: false, remainingPaise: 100 })).toBe(true);
    expect(disputeRefundAllowed({ checkedIn: false, remainingPaise: 0 })).toBe(false);
  });
});

describe('ticket transfers (D-229)', () => {
  const ok = {
    pricePaise: 0,
    planPricePaise: 50_000,
    planOpen: true,
    startsAt: START,
    now: new Date(START.getTime() - 2 * H),
    holderStatus: 'going' as string | null,
    holdsPaidSeat: true,
    originalPaise: 50_000,
    holderIsPayer: true,
    fromUserId: 'a',
    toUserId: 'b',
    isHost: false,
    hasUnclaimedPlusOne: false,
  };

  it('allows a free transfer and a resale up to the original price', () => {
    expect(transferBlock(ok)).toBeNull();
    expect(transferBlock({ ...ok, pricePaise: 50_000 })).toBeNull();
  });

  it('caps a resale at the original price', () => {
    expect(transferBlock({ ...ok, pricePaise: 50_001 })).toBe('PRICE_ABOVE_ORIGINAL');
  });

  it('closes when check-in opens', () => {
    const opens = START.getTime() - LIMITS.checkIn.windowBeforeMs;
    expect(transferBlock({ ...ok, now: new Date(opens) })).toBe('CHECK_IN_OPEN');
    expect(transferBlock({ ...ok, now: new Date(opens - 1) })).toBeNull();
    expect(transferBlock({ ...ok, planOpen: false })).toBe('CHECK_IN_OPEN');
  });

  it('needs a paid seat the sender still holds (not checked in)', () => {
    expect(transferBlock({ ...ok, holdsPaidSeat: false })).toBe('NO_TICKET');
    expect(transferBlock({ ...ok, holderStatus: 'checked_in' })).toBe('NO_TICKET');
    expect(transferBlock({ ...ok, planPricePaise: 0 })).toBe('NOT_PAID_PLAN');
  });

  it('a seat someone bought for you is given away, never sold', () => {
    expect(transferBlock({ ...ok, holderIsPayer: false })).toBeNull();
    expect(transferBlock({ ...ok, holderIsPayer: false, pricePaise: 100 })).toBe(
      'RESALE_NOT_PAYER',
    );
  });

  it('refuses self, hosts and an unclaimed +1 riding on the seat', () => {
    expect(transferBlock({ ...ok, toUserId: 'a' })).toBe('SELF');
    expect(transferBlock({ ...ok, isHost: true })).toBe('HOST');
    expect(transferBlock({ ...ok, hasUnclaimedPlusOne: true })).toBe('UNCLAIMED_PLUS_ONE');
  });

  it('an offer stays open only while pending and before check-in', () => {
    const closesAt = new Date(START.getTime() - LIMITS.checkIn.windowBeforeMs);
    expect(
      transferOpen({ status: 'pending', closesAt, now: new Date(closesAt.getTime() - 1) }),
    ).toBe(true);
    expect(transferOpen({ status: 'pending', closesAt, now: closesAt })).toBe(false);
    expect(transferOpen({ status: 'declined', closesAt, now: START })).toBe(false);
  });
});

describe('paid +1 (D-229)', () => {
  const ok = {
    planPricePaise: 50_000,
    planOpen: true,
    startsAt: START,
    now: new Date(START.getTime() - 3 * H),
    rsvp: 'going' as string | null,
    isHost: false,
    hasPlusOne: false,
  };

  it('a member going to a paid plan may buy one more seat', () => {
    expect(plusOneBlock(ok)).toBeNull();
  });

  it('only on paid plans, only for people going, one each, before check-in', () => {
    expect(plusOneBlock({ ...ok, planPricePaise: 0 })).toBe('NOT_PAID_PLAN');
    expect(plusOneBlock({ ...ok, rsvp: 'waitlisted' })).toBe('NOT_GOING');
    expect(plusOneBlock({ ...ok, hasPlusOne: true })).toBe('ALREADY_HAS_PLUS_ONE');
    expect(plusOneBlock({ ...ok, now: START })).toBe('CHECK_IN_OPEN');
    expect(plusOneBlock({ ...ok, isHost: true })).toBe('HOST');
  });
});

describe('refundable deposits (D-229)', () => {
  const ok = { flagOn: true, planPricePaise: 0, depositPaise: 10_000, popular: true };

  it('is asked on popular free plans when the host set one and the flag is on', () => {
    expect(depositRequired(ok)).toBe(10_000);
    expect(depositRequired({ ...ok, flagOn: false })).toBeNull();
    expect(depositRequired({ ...ok, popular: false })).toBeNull();
    expect(depositRequired({ ...ok, depositPaise: null })).toBeNull();
    expect(depositRequired({ ...ok, planPricePaise: 100 })).toBeNull();
  });

  it('comes back at check-in, on an early cancel or a host cancel; a no-show or late cancel loses it', () => {
    expect(depositOutcome('checked_in')).toBe('return');
    expect(depositOutcome('cancelled_early')).toBe('return');
    expect(depositOutcome('host_cancelled')).toBe('return');
    expect(depositOutcome('cancelled_late')).toBe('forfeit');
    expect(depositOutcome('no_show')).toBe('forfeit');
  });
});

describe('escrow payouts (D-229)', () => {
  const seat = (id: string, checkedIn: boolean, refundedPaise = 0) => ({
    paymentId: id,
    amountPaise: 50_000,
    refundedPaise,
    feeBps: 1000,
    checkedIn,
  });

  it('pays only checked-in paid seats, minus the fee and GST on it', () => {
    const l = escrowLedger([seat('a', true), seat('b', true, 10_000), seat('c', false)]);
    // a: 50 000 → fee 5 000, GST 900, host 44 100. b: 40 000 → 4 000, 720, 35 280. c: withheld 44 100.
    expect(l).toMatchObject({
      gross: 150_000,
      refunds: 10_000,
      fee: 9_000,
      gst: 1_620,
      net: 79_380,
      withheld: 44_100,
      maxNet: 123_480,
      paidSeats: 3,
      checkedInSeats: 2,
    });
  });

  it('a fully refunded seat is not a paid seat', () => {
    const l = escrowLedger([seat('a', false, 50_000)]);
    expect(l).toMatchObject({ paidSeats: 0, net: 0, withheld: 0, refunds: 50_000 });
  });

  it('splits a payout across payments, checked-in seats first, never above a share', () => {
    const shares = [
      { paymentId: 'x', hostPaise: 100, checkedIn: false },
      { paymentId: 'a', hostPaise: 100, checkedIn: true },
      { paymentId: 'b', hostPaise: 100, checkedIn: true },
    ];
    expect(allocateTransfers(shares, 150)).toEqual([
      { paymentId: 'a', amountPaise: 100 },
      { paymentId: 'b', amountPaise: 50 },
    ]);
    expect(allocateTransfers(shares, 250)).toEqual([
      { paymentId: 'a', amountPaise: 100 },
      { paymentId: 'b', amountPaise: 100 },
      { paymentId: 'x', amountPaise: 50 },
    ]);
    expect(allocateTransfers(shares, 0)).toEqual([]);
  });

  it('holds for headcount flags, then disputes, then no check-ins at all, then KYC', () => {
    const ok = {
      openFlags: 0,
      openDisputes: 0,
      paidSeats: 3,
      checkedInSeats: 2,
      accountActive: true,
      netPaise: 100,
    };
    expect(payoutHold(ok)).toBeNull();
    expect(payoutHold({ ...ok, openFlags: 1, openDisputes: 1 })).toBe('HEADCOUNT_FLAG');
    expect(payoutHold({ ...ok, openDisputes: 1 })).toBe('DISPUTE_OPEN');
    expect(payoutHold({ ...ok, checkedInSeats: 0, netPaise: 0 })).toBe('NO_CHECK_INS');
    expect(payoutHold({ ...ok, accountActive: false })).toBe('KYC_REQUIRED');
    expect(payoutHold({ ...ok, paidSeats: 0, checkedInSeats: 0, netPaise: 0 })).toBeNull();
  });

  it('an admin releases only review holds, and only once disputes are answered', () => {
    expect(
      releaseBlock({ status: 'on_hold', holdReason: 'HEADCOUNT_FLAG', openDisputes: 0 }),
    ).toBeNull();
    expect(releaseBlock({ status: 'on_hold', holdReason: 'KYC_REQUIRED', openDisputes: 0 })).toBe(
      'NOT_HELD',
    );
    expect(releaseBlock({ status: 'pending', holdReason: null, openDisputes: 0 })).toBe('NOT_HELD');
    expect(releaseBlock({ status: 'on_hold', holdReason: 'DISPUTE_OPEN', openDisputes: 1 })).toBe(
      'DISPUTE_OPEN',
    );
  });

  it('an admin adjusts an unsent payout up to every paid seat', () => {
    const ok = { status: 'on_hold', netPaise: 500, maxNetPaise: 500, transfersSent: 0 };
    expect(adjustBlock(ok)).toBeNull();
    expect(adjustBlock({ ...ok, netPaise: 501 })).toBe('ABOVE_MAX');
    expect(adjustBlock({ ...ok, status: 'paid' })).toBe('ALREADY_SENT');
    expect(adjustBlock({ ...ok, transfersSent: 1 })).toBe('ALREADY_SENT');
  });
});
