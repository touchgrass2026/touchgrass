import {
  feeBreakdown,
  type RefundPolicy,
  type RefundQuote,
  refundFor,
  resalePriceAllowed,
  transferClosesAt,
} from '@touchgrass/shared';

/**
 * Money rules for paid seats (F-PAY-02/03, D-229). Pure: the services load the facts, these decide. Each rule
 * is unit-tested on its own.
 */

// ---------- refunds ----------

export type RefundQuoteReason = RefundQuote['reason'];

/**
 * A member cancelling (or quoting a cancel): nothing comes back once the seat was checked in; otherwise the
 * plan's refund window applies. A free entry (credit) comes back whole or not at all.
 */
export function memberCancelRefund(i: {
  policy: RefundPolicy;
  remainingPaise: number;
  startsAt: Date;
  now: Date;
  checkedIn: boolean;
  method: string | null;
}): { refundPaise: number; reason: RefundQuoteReason } {
  if (i.checkedIn) return { refundPaise: 0, reason: 'CHECKED_IN' };
  const quote = refundFor(i.policy, i.remainingPaise, i.startsAt, i.now);
  if (i.method === 'credit' && quote.refundPaise < i.remainingPaise)
    return { refundPaise: 0, reason: quote.reason };
  return quote;
}

/** The host called the plan off: everyone gets back everything still on the payment, whatever the policy. */
export function hostCancelRefund(remainingPaise: number): {
  refundPaise: number;
  reason: 'HOST_CANCELLED';
} {
  return { refundPaise: Math.max(0, remainingPaise), reason: 'HOST_CANCELLED' };
}

/**
 * Only a plan's own host cancelling costs reliability; staff taking a plan down, or an account deletion, does
 * not. Only plans people had paid for count.
 */
export function hostCancelCountsAgainstHost(i: {
  cancelledBy: string | null;
  primaryHostId: string | null;
  refundedTickets: number;
}): boolean {
  return i.cancelledBy !== null && i.cancelledBy === i.primaryHostId && i.refundedTickets > 0;
}

// ---------- disputes ----------

export type DisputeBlock = 'DISPUTE_WINDOW_CLOSED' | 'NOT_PAID_PLAN' | 'NO_TICKET';

/** A buyer may report a problem from capture until the dispute window after the plan ends. */
export function disputeBlock(i: {
  kind: string;
  status: string;
  endsAt: Date;
  now: Date;
  windowMs: number;
}): DisputeBlock | null {
  if (i.kind === 'deposit') return 'NOT_PAID_PLAN';
  if (!['captured', 'partially_refunded'].includes(i.status)) return 'NO_TICKET';
  if (i.now.getTime() > i.endsAt.getTime() + i.windowMs) return 'DISPUTE_WINDOW_CLOSED';
  return null;
}

/** Disputes are answered with the check-in record: a seat that was checked in is never refunded. */
export function disputeRefundAllowed(i: { checkedIn: boolean; remainingPaise: number }): boolean {
  return !i.checkedIn && i.remainingPaise > 0;
}

// ---------- transfers ----------

export type TransferBlock =
  | 'NOT_PAID_PLAN'
  | 'NO_TICKET'
  | 'CHECK_IN_OPEN'
  | 'PRICE_ABOVE_ORIGINAL'
  | 'RESALE_NOT_PAYER'
  | 'SELF'
  | 'UNCLAIMED_PLUS_ONE'
  | 'HOST';

/** Whether a seat holder may offer their paid seat to another member, at this price, now. */
export function transferBlock(i: {
  pricePaise: number;
  planPricePaise: number;
  planOpen: boolean;
  startsAt: Date;
  now: Date;
  holderStatus: string | null;
  holdsPaidSeat: boolean;
  originalPaise: number;
  holderIsPayer: boolean;
  fromUserId: string;
  toUserId: string;
  isHost: boolean;
  hasUnclaimedPlusOne: boolean;
}): TransferBlock | null {
  if (i.planPricePaise === 0) return 'NOT_PAID_PLAN';
  if (i.isHost) return 'HOST';
  if (!i.planOpen || i.now.getTime() >= transferClosesAt(i.startsAt).getTime())
    return 'CHECK_IN_OPEN';
  if (!i.holdsPaidSeat || i.holderStatus !== 'going') return 'NO_TICKET';
  if (i.fromUserId === i.toUserId) return 'SELF';
  if (!resalePriceAllowed(i.pricePaise, i.originalPaise)) return 'PRICE_ABOVE_ORIGINAL';
  if (i.pricePaise > 0 && !i.holderIsPayer) return 'RESALE_NOT_PAYER';
  if (i.hasUnclaimedPlusOne) return 'UNCLAIMED_PLUS_ONE';
  return null;
}

/** An open offer lapses when check-in opens (the door list is final from then on). */
export function transferOpen(i: { status: string; closesAt: Date; now: Date }): boolean {
  return i.status === 'pending' && i.now.getTime() < i.closesAt.getTime();
}

// ---------- paid +1 ----------

export type PlusOneBlock =
  'NOT_PAID_PLAN' | 'NOT_GOING' | 'ALREADY_HAS_PLUS_ONE' | 'CHECK_IN_OPEN' | 'HOST';

/** A member going to a paid plan may buy one more seat for a friend, at the same price, until check-in. */
export function plusOneBlock(i: {
  planPricePaise: number;
  planOpen: boolean;
  startsAt: Date;
  now: Date;
  rsvp: string | null;
  isHost: boolean;
  hasPlusOne: boolean;
}): PlusOneBlock | null {
  if (i.planPricePaise === 0) return 'NOT_PAID_PLAN';
  if (i.isHost) return 'HOST';
  if (!i.planOpen || i.now.getTime() >= transferClosesAt(i.startsAt).getTime())
    return 'CHECK_IN_OPEN';
  if (i.rsvp !== 'going') return 'NOT_GOING';
  if (i.hasPlusOne) return 'ALREADY_HAS_PLUS_ONE';
  return null;
}

// ---------- refundable deposits ----------

/**
 * A deposit is asked only on free plans, only while the flag is on and the host set one, and only once the plan
 * is popular (few spots left or a waitlist). Returns the amount, or null.
 */
export function depositRequired(i: {
  flagOn: boolean;
  planPricePaise: number;
  depositPaise: number | null;
  popular: boolean;
}): number | null {
  if (!i.flagOn || i.planPricePaise > 0 || i.depositPaise === null || !i.popular) return null;
  return i.depositPaise;
}

export type DepositTrigger =
  'checked_in' | 'cancelled_early' | 'cancelled_late' | 'host_cancelled' | 'no_show';

/** Returned at check-in, on an early cancel or when the host calls it off; forfeited otherwise (D-229). */
export function depositOutcome(trigger: DepositTrigger): 'return' | 'forfeit' {
  return trigger === 'cancelled_late' || trigger === 'no_show' ? 'forfeit' : 'return';
}

// ---------- escrow payouts ----------

export interface EscrowShare {
  paymentId: string;
  amountPaise: number;
  /** Refunded plus refunds still on their way. */
  refundedPaise: number;
  feeBps: number;
  /** Whether whoever holds the seat this payment backs checked in. */
  checkedIn: boolean;
}

export interface EscrowLedger {
  gross: number;
  refunds: number;
  fee: number;
  gst: number;
  /** Host share of checked-in seats: what the payout sends. */
  net: number;
  /** Host share of paid seats nobody checked in to: kept back. */
  withheld: number;
  /** Host share of every paid seat: the most an admin adjustment may pay. */
  maxNet: number;
  paidSeats: number;
  checkedInSeats: number;
  /** Per payment: host share if paid in full (the transfer cap). */
  shares: { paymentId: string; hostPaise: number; checkedIn: boolean }[];
}

/**
 * Escrow (D-229): money kept from each payment is split into fee, GST on the fee and the host share; only seats
 * whose holder checked in are paid out. Fee and GST are reported on the money that is paid out.
 */
export function escrowLedger(shares: EscrowShare[]): EscrowLedger {
  const out: EscrowLedger = {
    gross: 0,
    refunds: 0,
    fee: 0,
    gst: 0,
    net: 0,
    withheld: 0,
    maxNet: 0,
    paidSeats: 0,
    checkedInSeats: 0,
    shares: [],
  };
  for (const s of shares) {
    const kept = Math.max(0, s.amountPaise - Math.min(s.amountPaise, s.refundedPaise));
    const b = feeBreakdown(kept, s.feeBps);
    out.gross += s.amountPaise;
    out.refunds += s.amountPaise - kept;
    out.maxNet += b.hostNetPaise;
    if (kept > 0) out.paidSeats += 1;
    if (s.checkedIn) {
      out.fee += b.platformFeePaise;
      out.gst += b.gstPaise;
      out.net += b.hostNetPaise;
      if (kept > 0) out.checkedInSeats += 1;
    } else out.withheld += b.hostNetPaise;
    out.shares.push({ paymentId: s.paymentId, hostPaise: b.hostNetPaise, checkedIn: s.checkedIn });
  }
  return out;
}

/**
 * Splits a payout across payments' transfers, never more than each payment's host share: checked-in seats
 * first, then the rest (an admin adjustment above the checked-in total pays for no-show seats too).
 */
export function allocateTransfers(
  shares: { paymentId: string; hostPaise: number; checkedIn: boolean }[],
  netPaise: number,
): { paymentId: string; amountPaise: number }[] {
  const ordered = [...shares.filter((s) => s.checkedIn), ...shares.filter((s) => !s.checkedIn)];
  let left = Math.max(0, netPaise);
  const out: { paymentId: string; amountPaise: number }[] = [];
  for (const s of ordered) {
    if (left <= 0) break;
    const amount = Math.min(left, s.hostPaise);
    if (amount > 0) out.push({ paymentId: s.paymentId, amountPaise: amount });
    left -= amount;
  }
  return out;
}

export type PayoutHold = 'HEADCOUNT_FLAG' | 'DISPUTE_OPEN' | 'NO_CHECK_INS' | 'KYC_REQUIRED';

/**
 * Why a payout waits: open headcount flags or disputes need an admin, and so do paid seats with no check-ins at
 * all (a broken door scanner looks the same as a plan that never happened); a payout account needs KYC.
 */
export function payoutHold(i: {
  openFlags: number;
  openDisputes: number;
  paidSeats: number;
  checkedInSeats: number;
  accountActive: boolean;
  netPaise: number;
}): PayoutHold | null {
  if (i.openFlags > 0) return 'HEADCOUNT_FLAG';
  if (i.openDisputes > 0) return 'DISPUTE_OPEN';
  if (i.paidSeats > 0 && i.checkedInSeats === 0) return 'NO_CHECK_INS';
  if (i.netPaise > 0 && !i.accountActive) return 'KYC_REQUIRED';
  return null;
}

/** Holds an admin clears (KYC clears itself on activation). */
export const REVIEW_HOLDS: readonly string[] = ['HEADCOUNT_FLAG', 'DISPUTE_OPEN', 'NO_CHECK_INS'];

export type PayoutReviewBlock = 'NOT_HELD' | 'DISPUTE_OPEN' | 'ABOVE_MAX' | 'ALREADY_SENT';

/** Releasing: only a review hold, and only once its disputes are answered. */
export function releaseBlock(i: {
  status: string;
  holdReason: string | null;
  openDisputes: number;
}): PayoutReviewBlock | null {
  if (i.status !== 'on_hold' || !REVIEW_HOLDS.includes(i.holdReason ?? '')) return 'NOT_HELD';
  if (i.openDisputes > 0) return 'DISPUTE_OPEN';
  return null;
}

/** Adjusting: any payout not yet sent, up to the host share of every paid seat. */
export function adjustBlock(i: {
  status: string;
  netPaise: number;
  maxNetPaise: number;
  transfersSent: number;
}): PayoutReviewBlock | null {
  if (!['on_hold', 'pending', 'failed'].includes(i.status) || i.transfersSent > 0)
    return 'ALREADY_SENT';
  if (i.netPaise > i.maxNetPaise) return 'ABOVE_MAX';
  return null;
}
