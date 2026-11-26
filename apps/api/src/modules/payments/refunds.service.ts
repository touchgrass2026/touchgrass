import { Inject, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_REFUND_POLICY } from '@touchgrass/shared';
import { and, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { PaymentsGateway } from '../../adapters/payments/payments.port.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { payments, refunds } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { PaymentCredits } from './payment-credits.js';
import { EventStore } from '../events/event-store.service.js';
import {
  depositOutcome,
  hostCancelCountsAgainstHost,
  hostCancelRefund,
  memberCancelRefund,
} from './payment.policy.js';
import {
  type PaymentRow,
  PaymentsService,
  REFUND_REQUESTED_EVENT,
  type RefundRow,
  TICKET_KINDS,
} from './payments.service.js';
import { HOST_CANCELLED_PAID_EVENT } from './payment-events.js';

export const MAX_REFUND_ATTEMPTS = 5;
const RETRY_AFTER_MS = 60_000;

type RefundReason = RefundRow['reason'];

/**
 * Refunds (F-PAY-02). A refund row is written in the same transaction as the decision (cancel, duplicate,
 * lapsed hold), then sent to the gateway by the worker; only the `refund.processed` webhook marks money as
 * returned. Failed sends are retried with backoff and show up in the admin overview.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly gateway: PaymentsGateway,
    private readonly payments: PaymentsService,
    private readonly store: EventStore,
    private readonly outbox: OutboxService,
    private readonly credits: PaymentCredits,
  ) {}

  /** Money already refunded or on its way back for a payment. */
  private async committed(paymentId: string, db: Database | Tx): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`coalesce(sum(${refunds.amountPaise}), 0)::int` })
      .from(refunds)
      .where(and(eq(refunds.paymentId, paymentId), ne(refunds.status, 'failed')));
    return row?.n ?? 0;
  }

  /** Records a refund of up to `amountPaise` (never more than what is left) and schedules sending it. */
  async request(
    tx: Tx,
    payment: PaymentRow,
    amountPaise: number,
    reason: RefundReason,
  ): Promise<string | null> {
    // Serialise concurrent decisions about the same payment.
    await tx.execute(sql`SELECT id FROM payments WHERE id = ${payment.id} FOR UPDATE`);
    const left = payment.amountPaise - (await this.committed(payment.id, tx));
    const amount = Math.min(amountPaise, left);
    if (amount <= 0) return null;
    const id = uuidv7();
    await tx
      .insert(refunds)
      .values({ id, paymentId: payment.id, amountPaise: amount, reason, status: 'pending' });
    await this.outbox.add(tx, {
      aggregateType: 'payment',
      aggregateId: payment.id,
      type: REFUND_REQUESTED_EVENT,
      payload: { refundId: id, paymentId: payment.id, amountPaise: amount, reason },
    });
    return id;
  }

  /**
   * Someone dropped out (F-PAY-02, D-229). Their ticket is refunded per the plan's policy at the time they
   * cancelled, and so is a +1 seat they bought that nobody claimed (cancelling released it). A deposit comes back
   * on an early cancel and is forfeited on a late one. Returns the refunds requested.
   */
  async onAttendeeCancelled(
    eventId: string,
    userId: string,
    cancelledAt: Date,
    late: boolean = false,
  ): Promise<string[]> {
    const core = await this.store.core(eventId);
    if (!core) return [];
    return this.db.transaction(async (tx) => {
      const out: string[] = [];
      const paid = await this.payments.capturedFor(userId, eventId, tx);
      const unclaimed = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.eventId, eventId),
            eq(payments.userId, userId),
            eq(payments.kind, 'plus_one'),
            isNull(payments.holderUserId),
            isNull(payments.ticketReleasedAt),
            inArray(payments.status, ['captured', 'partially_refunded']),
          ),
        );
      for (const p of [...(paid ? [paid] : []), ...unclaimed]) {
        // The ticket is gone whatever the refund: this payment never backs a seat again.
        await tx
          .update(payments)
          .set({ ticketReleasedAt: cancelledAt })
          .where(eq(payments.id, p.id));
        const left = p.amountPaise - (await this.committed(p.id, tx));
        const quote = memberCancelRefund({
          policy: core.refundPolicy ?? DEFAULT_REFUND_POLICY,
          remainingPaise: left,
          startsAt: core.startsAt,
          now: cancelledAt,
          checkedIn: false,
          method: p.method,
        });
        const id =
          quote.refundPaise > 0
            ? await this.request(tx, p, quote.refundPaise, 'BEFORE_CUTOFF')
            : null;
        if (id) out.push(id);
      }
      const deposit = await this.openDeposit(tx, eventId, userId);
      if (deposit) {
        const id = await this.settleDeposit(
          tx,
          deposit,
          depositOutcome(late ? 'cancelled_late' : 'cancelled_early'),
          cancelledAt,
        );
        if (id) out.push(id);
      }
      return out;
    });
  }

  /** A captured deposit on this plan not yet returned or forfeited. */
  async openDeposit(tx: Tx, eventId: string, userId: string): Promise<PaymentRow | null> {
    const [p] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.eventId, eventId),
          eq(payments.holderUserId, userId),
          eq(payments.kind, 'deposit'),
          eq(payments.status, 'captured'),
          isNull(payments.depositOutcome),
        ),
      )
      .for('update')
      .limit(1);
    return p ?? null;
  }

  /** Returns a deposit in full (a refund) or keeps it (D-229). Once per deposit. */
  async settleDeposit(
    tx: Tx,
    deposit: PaymentRow,
    outcome: 'return' | 'forfeit',
    now: Date,
  ): Promise<string | null> {
    const [claimed] = await tx
      .update(payments)
      .set({
        depositOutcome: outcome === 'return' ? 'returned' : 'forfeited',
        depositSettledAt: now,
      })
      .where(and(eq(payments.id, deposit.id), isNull(payments.depositOutcome)))
      .returning({ id: payments.id });
    if (!claimed || outcome === 'forfeit') return null;
    return this.request(tx, deposit, deposit.amountPaise, 'DEPOSIT_RETURNED');
  }

  /**
   * The plan was called off: every ticket and deposit is refunded in full whatever the policy, and open checkouts
   * are closed (F-PAY-02). When its own host called off a plan people had paid for, a domain event lets the
   * reliability module count it against them (D-229).
   */
  async onEventCancelled(
    eventId: string,
    now: Date = new Date(),
    cancelledBy: string | null = null,
  ): Promise<number> {
    const rows = await this.db.select().from(payments).where(eq(payments.eventId, eventId));
    let refunded = 0;
    // Tickets people still held when the plan was called off (counted the same on a retry).
    const refundedTickets = rows.filter(
      (p) =>
        (TICKET_KINDS as readonly string[]).includes(p.kind) &&
        p.ticketReleasedAt === null &&
        ['captured', 'partially_refunded', 'refunded'].includes(p.status),
    ).length;
    for (const p of rows) {
      if (p.status === 'captured' || p.status === 'partially_refunded') {
        const id = await this.db.transaction(async (tx) => {
          if (p.kind === 'deposit') {
            const open = await this.openDeposit(tx, eventId, p.holderUserId ?? '');
            return open?.id === p.id ? this.settleDeposit(tx, open, 'return', now) : null;
          }
          const left = p.amountPaise - (await this.committed(p.id, tx));
          return this.request(tx, p, hostCancelRefund(left).refundPaise, 'HOST_CANCELLED');
        });
        if (id) refunded += 1;
      } else if (p.status === 'created' || p.status === 'failed') {
        await this.payments.release(p, 'expired', now);
      }
    }
    const hosts = await this.store.hosts(eventId);
    const primaryHostId = hosts.find((h) => h.role === 'host')?.userId ?? null;
    if (hostCancelCountsAgainstHost({ cancelledBy, primaryHostId, refundedTickets }))
      await this.db.transaction((tx) =>
        this.outbox.add(tx, {
          aggregateType: 'event',
          aggregateId: eventId,
          type: HOST_CANCELLED_PAID_EVENT,
          payload: {
            eventId,
            hostUserId: primaryHostId,
            refundedTickets,
            cancelledAt: now.toISOString(),
          },
        }),
      );
    return refunded;
  }

  /** Sends one refund to the gateway. Safe to call repeatedly: only pending/failed rows are claimed. */
  async execute(refundId: string): Promise<void> {
    const claimed = await this.db.transaction(async (tx) => {
      const [r] = await tx
        .update(refunds)
        .set({ status: 'processing', attempts: sql`${refunds.attempts} + 1` })
        .where(
          and(
            eq(refunds.id, refundId),
            inArray(refunds.status, ['pending', 'failed']),
            lt(refunds.attempts, MAX_REFUND_ATTEMPTS),
          ),
        )
        .returning();
      if (!r) return null;
      const [p] = await tx.select().from(payments).where(eq(payments.id, r.paymentId));
      return p ? { refund: r, payment: p } : null;
    });
    if (!claimed) return;
    const { refund, payment } = claimed;
    if (payment.method === 'credit') {
      // Credit-paid tickets refund as the credit itself; no money moves.
      const ref = `credit_${refund.id}`;
      await this.db.transaction(async (tx) => {
        await this.credits.restore(tx, payment.id);
        await tx
          .update(refunds)
          .set({ providerRefundId: ref, lastError: null })
          .where(eq(refunds.id, refund.id));
      });
      await this.settle(ref, 'processed');
      return;
    }
    if (!payment.providerPaymentId) {
      await this.fail(refund.id, 'Payment has no provider id');
      return;
    }
    try {
      const res = await this.gateway.refund({
        providerPaymentId: payment.providerPaymentId,
        amountPaise: refund.amountPaise,
        notes: { refundId: refund.id, reason: refund.reason },
      });
      await this.db
        .update(refunds)
        .set({ providerRefundId: res.providerRefundId, lastError: null })
        .where(eq(refunds.id, refund.id));
    } catch (err) {
      this.logger.warn(`Refund ${refund.id} failed to send: ${String(err)}`);
      await this.fail(refund.id, String(err));
    }
  }

  private async fail(refundId: string, error: string): Promise<void> {
    await this.db
      .update(refunds)
      .set({ status: 'failed', lastError: error.slice(0, 500) })
      .where(eq(refunds.id, refundId));
  }

  /** Every few minutes: resend refunds that never left or failed (bounded attempts). */
  async retryDue(now: Date = new Date()): Promise<number> {
    const due = await this.db
      .select({ id: refunds.id })
      .from(refunds)
      .where(
        and(
          inArray(refunds.status, ['pending', 'failed']),
          lt(refunds.attempts, MAX_REFUND_ATTEMPTS),
          lt(refunds.updatedAt, new Date(now.getTime() - RETRY_AFTER_MS)),
        ),
      )
      .limit(200);
    for (const r of due) await this.execute(r.id);
    return due.length;
  }

  /** Admin "retry": a refund that ran out of attempts gets a fresh budget. */
  async adminRetry(refundId: string): Promise<void> {
    const [r] = await this.db
      .update(refunds)
      .set({ status: 'failed', attempts: 0 })
      .where(and(eq(refunds.id, refundId), eq(refunds.status, 'failed')))
      .returning({ id: refunds.id });
    if (!r) throw new AppError('CONFLICT', 'Only failed refunds can be retried');
    await this.execute(refundId);
  }

  /** `refund.processed` / `refund.failed` webhooks. */
  async settle(
    providerRefundId: string,
    outcome: 'processed' | 'failed',
    now: Date = new Date(),
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(refunds)
        .where(eq(refunds.providerRefundId, providerRefundId))
        .for('update');
      if (!r || r.status === 'processed') return false;
      if (outcome === 'failed') {
        await tx
          .update(refunds)
          .set({ status: 'failed', lastError: 'Gateway reported failure' })
          .where(eq(refunds.id, r.id));
        return true;
      }
      await tx
        .update(refunds)
        .set({ status: 'processed', processedAt: now })
        .where(eq(refunds.id, r.id));
      const [p] = await tx
        .update(payments)
        .set({
          refundedPaise: sql`least(${payments.amountPaise}, ${payments.refundedPaise} + ${r.amountPaise})`,
        })
        .where(eq(payments.id, r.paymentId))
        .returning();
      if (p)
        await tx
          .update(payments)
          .set({ status: p.refundedPaise >= p.amountPaise ? 'refunded' : 'partially_refunded' })
          .where(eq(payments.id, p.id));
      return true;
    });
  }
}
