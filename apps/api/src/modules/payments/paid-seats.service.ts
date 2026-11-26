import { Inject, Injectable } from '@nestjs/common';
import {
  type CheckoutBody,
  type CheckoutResult,
  type DepositSettings,
  isPopularPlan,
  LIMITS,
  type PlusOneCheckout,
  type PlusOneLink,
  type PlusOneTicket,
} from '@touchgrass/shared';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { randomToken } from '../../common/auth/hashing.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { eventDeposits, payments } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { EventAccessService } from '../events/event-access.service.js';
import { EventStore } from '../events/event-store.service.js';
import { PlusOneClaimService } from '../events/plus-one/plus-one-claim.service.js';
import { RsvpService } from '../events/rsvp.service.js';
import { AppSettingsService } from '../platform/app-settings.service.js';
import { FeatureFlagsService } from '../platform/feature-flags.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { UsersService } from '../users/users.service.js';
import { CheckInSignals } from './check-in-signals.js';
import { depositOutcome, depositRequired, plusOneBlock } from './payment.policy.js';
import { PaymentsService } from './payments.service.js';
import { RefundsService } from './refunds.service.js';

export const PLUS_ONE_CLAIMED_EVENT = 'payment.plus_one_claimed';

/**
 * Paid +1s and refundable deposits (D-229). A paid +1 is one more seat on the buyer's RSVP at the plan's price;
 * once paid it gets a claim link like a guest +1, and whoever claims it (a member, or someone who joins through
 * the link) holds the ticket. A deposit holds a seat on a popular free plan and comes back at check-in.
 */
@Injectable()
export class PaidSeatsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly rsvp: RsvpService,
    private readonly store: EventStore,
    private readonly access: EventAccessService,
    private readonly people: PeopleService,
    private readonly users: UsersService,
    private readonly plusOnes: PlusOneClaimService,
    private readonly flags: FeatureFlagsService,
    private readonly settings: AppSettingsService,
    private readonly outbox: OutboxService,
    private readonly checkIns: CheckInSignals,
  ) {}

  // ---------- paid +1 ----------

  async plusOneCheckout(
    userId: string,
    eventId: string,
    receiptEmail: string | null = null,
    now: Date = new Date(),
  ): Promise<PlusOneCheckout> {
    const { core, facts } = await this.access.visibleOrThrow(userId, eventId);
    const block = plusOneBlock({
      planPricePaise: core.pricePaise,
      planOpen: core.status === 'published',
      startsAt: core.startsAt,
      now,
      rsvp: facts.rsvp,
      isHost: facts.hostRole !== null,
      // Checked again under the lock; here only to answer early.
      hasPlusOne: await this.rsvp.hasGuestSeat(eventId, userId),
    });
    if (block) throw new AppError('NOT_ELIGIBLE', 'You cannot buy a +1 here', { reason: block });
    if (receiptEmail) await this.users.setReceiptEmail(userId, receiptEmail);
    const token = randomToken();
    const claimToken = randomToken();
    const claimTokenHash = this.plusOnes.hash(claimToken);
    const claimUrl = this.plusOnes.claimUrl(claimToken);
    const refreshed = await this.payments.refreshOpen(userId, eventId, 'plus_one', token, now, {
      claimTokenHash,
    });
    if (refreshed) return { session: refreshed, claimUrl };
    const feeBps = await this.settings.get('platform_fee_bps');
    const paymentId = uuidv7();
    await this.rsvp.holdGuestSeat(
      userId,
      eventId,
      async (tx, locked) => {
        await this.payments.supersedeOpen(tx, eventId, userId, 'plus_one');
        await tx.insert(payments).values({
          id: paymentId,
          eventId,
          userId,
          holderUserId: null,
          kind: 'plus_one',
          status: 'created',
          amountPaise: locked.pricePaise,
          feeBps,
          claimTokenHash,
          checkoutTokenHash: this.payments.hashToken(token),
          holdExpiresAt: new Date(now.getTime() + LIMITS.payments.holdMs),
        });
      },
      now,
    );
    const p = await this.payments.attachOrder(paymentId, now);
    return { session: this.payments.session(p, token), claimUrl };
  }

  /** The buyer's latest +1 seat on a plan, and who holds it. */
  async plusOneTicket(userId: string, eventId: string): Promise<PlusOneTicket> {
    const [p] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.eventId, eventId),
          eq(payments.userId, userId),
          eq(payments.kind, 'plus_one'),
          ne(payments.status, 'expired'),
        ),
      )
      .orderBy(desc(payments.createdAt))
      .limit(1);
    if (!p) throw AppError.notFound('Plus one');
    const holder = p.holderUserId
      ? ((await this.people.cards(userId, [p.holderUserId])).get(p.holderUserId) ?? null)
      : null;
    return { paymentId: p.id, status: p.status, amountPaise: p.amountPaise, holder };
  }

  /** A fresh claim link for a paid, unclaimed +1 seat; the old link stops working. */
  async newPlusOneLink(userId: string, eventId: string): Promise<PlusOneLink> {
    const [p] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.eventId, eventId),
          eq(payments.userId, userId),
          eq(payments.kind, 'plus_one'),
          eq(payments.status, 'captured'),
          isNull(payments.holderUserId),
          isNull(payments.ticketReleasedAt),
        ),
      )
      .limit(1);
    if (!p?.claimTokenHash) throw AppError.notFound('Plus one');
    const oldHash = p.claimTokenHash;
    const claimToken = randomToken();
    const newHash = this.plusOnes.hash(claimToken);
    await this.db.transaction(async (tx) => {
      const moved = await this.rsvp.replaceGuestClaim(eventId, userId, oldHash, newHash, tx);
      if (!moved) throw new AppError('CONFLICT', 'That +1 seat was already claimed');
      await tx
        .update(payments)
        .set({ claimTokenHash: newHash })
        .where(and(eq(payments.id, p.id), eq(payments.claimTokenHash, oldHash)));
    });
    return { claimUrl: this.plusOnes.claimUrl(claimToken) };
  }

  /** Inside the claim transaction: the friend who claimed a paid +1 seat now holds its ticket. */
  async onPlusOneClaimed(
    tx: Tx,
    claim: { eventId: string; inviterUserId: string; claimHash: string; userId: string },
  ): Promise<void> {
    const [p] = await tx
      .update(payments)
      .set({ holderUserId: claim.userId })
      .where(
        and(
          eq(payments.eventId, claim.eventId),
          eq(payments.userId, claim.inviterUserId),
          eq(payments.kind, 'plus_one'),
          eq(payments.claimTokenHash, claim.claimHash),
          isNull(payments.holderUserId),
          inArray(payments.status, ['captured', 'partially_refunded']),
        ),
      )
      .returning({ id: payments.id });
    if (!p) return;
    await this.outbox.add(tx, {
      aggregateType: 'payment',
      aggregateId: p.id,
      type: PLUS_ONE_CLAIMED_EVENT,
      payload: {
        paymentId: p.id,
        eventId: claim.eventId,
        buyerId: claim.inviterUserId,
        holderId: claim.userId,
      },
    });
  }

  // ---------- refundable deposits ----------

  async deposit(hostId: string, eventId: string): Promise<DepositSettings> {
    await this.access.requireHost(hostId, eventId);
    const [row] = await this.db
      .select({ amountPaise: eventDeposits.amountPaise })
      .from(eventDeposits)
      .where(eq(eventDeposits.eventId, eventId));
    return { amountPaise: row?.amountPaise ?? null };
  }

  async setDeposit(
    hostId: string,
    eventId: string,
    body: DepositSettings,
  ): Promise<DepositSettings> {
    if (!(await this.flags.isEnabled('refundable_deposits')))
      throw new AppError('FEATURE_DISABLED', 'Deposits are switched off', {
        reason: 'DEPOSITS_OFF',
      });
    const core = await this.access.requireHost(hostId, eventId);
    if (core.pricePaise > 0)
      throw new AppError('CONFLICT', 'Paid plans take tickets, not deposits', {
        reason: 'PRICE_LOCKED',
      });
    if (body.amountPaise === null)
      await this.db.delete(eventDeposits).where(eq(eventDeposits.eventId, eventId));
    else
      await this.db
        .insert(eventDeposits)
        .values({ eventId, amountPaise: body.amountPaise, setByUserId: hostId })
        .onConflictDoUpdate({
          target: eventDeposits.eventId,
          set: { amountPaise: body.amountPaise, setByUserId: hostId },
        });
    return { amountPaise: body.amountPaise };
  }

  /** Event hook: the deposit pulling up needs right now (flag on, set by the host, plan popular), or null. */
  async depositRequired(eventId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ amountPaise: eventDeposits.amountPaise })
      .from(eventDeposits)
      .where(eq(eventDeposits.eventId, eventId));
    if (!row) return null;
    const core = await this.store.core(eventId);
    if (!core) return null;
    const counts = await this.store.seatCounts(eventId);
    return depositRequired({
      flagOn: await this.flags.isEnabled('refundable_deposits'),
      planPricePaise: core.pricePaise,
      depositPaise: row.amountPaise,
      popular: isPopularPlan(core.capacity, counts.seats, counts.waitlisted),
    });
  }

  async depositCheckout(
    userId: string,
    eventId: string,
    body: Pick<CheckoutBody, 'receiptEmail' | 'fromOffer'>,
    now: Date = new Date(),
  ): Promise<CheckoutResult> {
    const amount = await this.depositRequired(eventId);
    if (amount === null)
      throw new AppError('CONFLICT', 'No deposit needed: just pull up', { reason: 'FREE' });
    if (body.receiptEmail) await this.users.setReceiptEmail(userId, body.receiptEmail);
    return this.payments.seatCheckout(
      userId,
      eventId,
      { kind: 'deposit', fromOffer: body.fromOffer, depositPaise: amount },
      now,
    );
  }

  /** Worker, on check-in: the deposit comes back in full. */
  async onCheckedIn(eventId: string, userId: string, now: Date = new Date()): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const deposit = await this.refunds.openDeposit(tx, eventId, userId);
      if (!deposit) return false;
      await this.refunds.settleDeposit(tx, deposit, depositOutcome('checked_in'), now);
      return true;
    });
  }

  /** Worker, when the plan completes: deposits of people who never checked in are forfeited (D-229). */
  async onCompleted(eventId: string, now: Date = new Date()): Promise<number> {
    const open = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.eventId, eventId),
          eq(payments.kind, 'deposit'),
          eq(payments.status, 'captured'),
          isNull(payments.depositOutcome),
        ),
      );
    if (open.length === 0) return 0;
    const checkedIn = await this.checkIns.checkIns(eventId);
    let forfeited = 0;
    for (const p of open)
      await this.db.transaction(async (tx) => {
        const holder = p.holderUserId ?? '';
        const deposit = await this.refunds.openDeposit(tx, eventId, holder);
        if (deposit?.id !== p.id) return;
        const outcome = depositOutcome(checkedIn.has(holder) ? 'checked_in' : 'no_show');
        if (outcome === 'forfeit') forfeited += 1;
        await this.refunds.settleDeposit(tx, deposit, outcome, now);
      });
    return forfeited;
  }
}
