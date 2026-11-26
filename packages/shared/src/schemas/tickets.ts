import { z } from 'zod';
import { LIMITS, LOCALE_DEFAULTS } from '../constants';
import { CheckoutSession, PayoutView } from './payments';
import { PersonCard } from './social';

/**
 * Paid seats after the sale (D-229): ticket transfers between members, paid +1s, refundable deposits on popular
 * free plans, payment disputes, and the escrow review of host payouts.
 */
const Paise = z.number().int().min(0);
const P = LIMITS.payments;

// ---------- shared rules (the API enforces them; the app uses them to explain) ----------

/** Transfers close when check-in opens: from then on the door list is final. */
export function transferClosesAt(startsAt: Date): Date {
  return new Date(startsAt.getTime() - LIMITS.checkIn.windowBeforeMs);
}

/** A resale never makes money: the price is capped at what the seat cost. */
export function resalePriceAllowed(pricePaise: number, originalPaise: number): boolean {
  return Number.isInteger(pricePaise) && pricePaise >= 0 && pricePaise <= originalPaise;
}

// ---------- ticket transfers ----------

export const TicketTransferStatus = z.enum([
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
]);
export type TicketTransferStatus = z.infer<typeof TicketTransferStatus>;

export const CreateTicketTransferBody = z.object({
  toUserId: z.uuid(),
  /** 0 hands the seat over for free; anything else is a resale, capped at the original price. */
  pricePaise: Paise.default(0),
});
export type CreateTicketTransferBody = z.infer<typeof CreateTicketTransferBody>;

export const TicketTransfer = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  eventTitle: z.string(),
  eventStartsAt: z.iso.datetime(),
  eventTimezone: z.string().default(LOCALE_DEFAULTS.timezone),
  status: TicketTransferStatus,
  pricePaise: Paise,
  originalPaise: Paise,
  direction: z.enum(['incoming', 'outgoing']),
  from: PersonCard,
  to: PersonCard,
  /** Check-in opens then; an unanswered offer lapses. */
  closesAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  respondedAt: z.iso.datetime().nullable(),
});
export type TicketTransfer = z.infer<typeof TicketTransfer>;
export const TicketTransferList = z.object({ items: z.array(TicketTransfer) });
export type TicketTransferList = z.infer<typeof TicketTransferList>;

export const AcceptTransferResult = z.discriminatedUnion('kind', [
  /** Free transfer: the seat is yours now. */
  z.object({ kind: z.literal('transferred'), eventId: z.uuid() }),
  /** Resale: pay on the checkout page; the seat moves when the payment is confirmed. */
  z.object({ kind: z.literal('checkout'), session: CheckoutSession }),
]);
export type AcceptTransferResult = z.infer<typeof AcceptTransferResult>;

// ---------- paid +1 ----------

export const PlusOneCheckout = z.object({
  session: CheckoutSession,
  /** Works once the payment is confirmed; the friend signs in (or joins) to claim the seat. */
  claimUrl: z.url(),
});
export type PlusOneCheckout = z.infer<typeof PlusOneCheckout>;

export const PlusOneTicket = z.object({
  paymentId: z.uuid(),
  status: z.enum(['created', 'captured', 'failed', 'expired', 'refunded', 'partially_refunded']),
  amountPaise: Paise,
  /** The friend who claimed it: their name is on the ticket. */
  holder: PersonCard.nullable(),
});
export type PlusOneTicket = z.infer<typeof PlusOneTicket>;
export const PlusOneLink = z.object({ claimUrl: z.url() });
export type PlusOneLink = z.infer<typeof PlusOneLink>;

// ---------- refundable deposits ----------

export const DepositSettings = z.object({
  /** null: no deposit. Asked only once the plan is popular, and only while the flag is on. */
  amountPaise: z.number().int().min(P.depositMinPaise).max(P.depositMaxPaise).nullable(),
});
export type DepositSettings = z.infer<typeof DepositSettings>;

// ---------- disputes ----------

export const DisputeReason = z.enum([
  'NOT_ADMITTED',
  'PLAN_DID_NOT_HAPPEN',
  'NOT_AS_DESCRIBED',
  'CHARGED_TWICE',
  'OTHER',
]);
export type DisputeReason = z.infer<typeof DisputeReason>;
export const DisputeStatus = z.enum(['open', 'refunded', 'rejected']);
export type DisputeStatus = z.infer<typeof DisputeStatus>;

export const CreateDisputeBody = z.object({
  reason: DisputeReason,
  note: z.string().trim().max(500).default(''),
});
export type CreateDisputeBody = z.infer<typeof CreateDisputeBody>;

export const PaymentDispute = z.object({
  id: z.uuid(),
  paymentId: z.uuid(),
  eventId: z.uuid(),
  status: DisputeStatus,
  reason: DisputeReason,
  note: z.string(),
  resolutionNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type PaymentDispute = z.infer<typeof PaymentDispute>;
export const PaymentDisputeState = z.object({ dispute: PaymentDispute.nullable() });
export type PaymentDisputeState = z.infer<typeof PaymentDisputeState>;

// ---------- admin: escrow review (F-WEB-03) ----------

/** Check-in evidence for a seat: when (and how) its holder got in, against the plan's times. */
export const CheckInEvidence = z.object({
  holder: PersonCard.nullable(),
  checkedInAt: z.iso.datetime().nullable(),
  method: z.string().nullable(),
  eventStartsAt: z.iso.datetime(),
  eventEndsAt: z.iso.datetime(),
  checkInOpenedAt: z.iso.datetime(),
});
export type CheckInEvidence = z.infer<typeof CheckInEvidence>;

export const AdminDispute = PaymentDispute.extend({
  eventTitle: z.string(),
  buyer: PersonCard,
  amountPaise: Paise,
  refundedPaise: Paise,
  evidence: CheckInEvidence,
  /** False once the seat was checked in: no refunds after check-in (D-229). */
  refundAllowed: z.boolean(),
});
export type AdminDispute = z.infer<typeof AdminDispute>;
export const AdminDisputeList = z.object({ items: z.array(AdminDispute) });
export type AdminDisputeList = z.infer<typeof AdminDisputeList>;
export const AdminDisputeQuery = z.object({ status: DisputeStatus.default('open') });
export type AdminDisputeQuery = z.infer<typeof AdminDisputeQuery>;

export const ResolveDisputeBody = z.object({
  decision: z.enum(['refund', 'reject']),
  /** Refund amount; defaults to everything left on the payment. */
  amountPaise: z.number().int().min(1).optional(),
  note: z.string().trim().min(3).max(500),
});
export type ResolveDisputeBody = z.infer<typeof ResolveDisputeBody>;

export const HeadcountFlagView = z.object({
  id: z.string(),
  reason: z.string(),
  raisedAt: z.iso.datetime(),
});
export type HeadcountFlagView = z.infer<typeof HeadcountFlagView>;

export const AdminHeldPayout = PayoutView.extend({
  host: PersonCard,
  paidSeats: z.number().int(),
  checkedInSeats: z.number().int(),
  /** Host share of paid seats nobody checked in to: kept back unless an admin adjusts. */
  withheldPaise: Paise,
  /** Most an adjustment may pay: the host share of every paid seat. */
  maxNetPaise: Paise,
  adjustmentNote: z.string().nullable(),
  flags: z.array(HeadcountFlagView),
  openDisputes: z.number().int(),
});
export type AdminHeldPayout = z.infer<typeof AdminHeldPayout>;
export const AdminHeldPayoutList = z.object({ items: z.array(AdminHeldPayout) });
export type AdminHeldPayoutList = z.infer<typeof AdminHeldPayoutList>;

export const ReleasePayoutBody = z.object({ note: z.string().trim().min(3).max(500) });
export type ReleasePayoutBody = z.infer<typeof ReleasePayoutBody>;
export const AdjustPayoutBody = z.object({
  netPaise: Paise,
  note: z.string().trim().min(3).max(500),
});
export type AdjustPayoutBody = z.infer<typeof AdjustPayoutBody>;
