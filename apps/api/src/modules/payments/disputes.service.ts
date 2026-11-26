import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminDispute,
  type AdminDisputeList,
  type CreateDisputeBody,
  type DisputeStatus,
  LIMITS,
  type PaymentDispute,
  type PersonCard,
  type ResolveDisputeBody,
  transferClosesAt,
} from '@touchgrass/shared';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { paymentDisputes, payments, refunds } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { EventStore } from '../events/event-store.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { CheckInSignals } from './check-in-signals.js';
import { disputeBlock, disputeRefundAllowed } from './payment.policy.js';
import { PayoutsService } from './payouts.service.js';
import { RefundsService } from './refunds.service.js';

export const DISPUTE_RESOLVED_EVENT = 'payment.dispute_resolved';

type DisputeRow = typeof paymentDisputes.$inferSelect;

const NOBODY: Omit<PersonCard, 'id'> = {
  displayName: '',
  photo: null,
  verified: false,
  mutualFriendCount: 0,
};

function toView(d: DisputeRow): PaymentDispute {
  return {
    id: d.id,
    paymentId: d.paymentId,
    eventId: d.eventId,
    status: d.status,
    reason: d.reason,
    note: d.note,
    resolutionNote: d.resolutionNote,
    createdAt: d.createdAt.toISOString(),
    resolvedAt: d.resolvedAt?.toISOString() ?? null,
  };
}

/**
 * Payment disputes (D-229). A buyer reports a problem; the plan's payout waits; an admin answers with the
 * check-in record: a seat that was checked in is never refunded, any other may be (in full or in part). The
 * decision is audited and the buyer is notified.
 */
@Injectable()
export class DisputesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly refunds: RefundsService,
    private readonly payouts: PayoutsService,
    private readonly store: EventStore,
    private readonly people: PeopleService,
    private readonly checkIns: CheckInSignals,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async open(
    userId: string,
    paymentId: string,
    body: CreateDisputeBody,
    now: Date = new Date(),
  ): Promise<PaymentDispute> {
    const [p] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.userId, userId)))
      .limit(1);
    if (!p) throw AppError.notFound('Payment');
    const core = await this.store.core(p.eventId);
    if (!core) throw AppError.notFound('Payment');
    const block = disputeBlock({
      kind: p.kind,
      status: p.status,
      endsAt: core.endsAt,
      now,
      windowMs: LIMITS.payments.disputeWindowMs,
    });
    if (block)
      throw new AppError('NOT_ELIGIBLE', 'This payment cannot be disputed', { reason: block });
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(paymentDisputes)
        .values({
          id,
          paymentId,
          eventId: p.eventId,
          userId,
          reason: body.reason,
          note: body.note,
          status: 'open',
        })
        .onConflictDoNothing()
        .returning({ id: paymentDisputes.id });
      if (inserted.length === 0)
        throw new AppError('CONFLICT', 'Already being looked into', { reason: 'DISPUTE_OPEN' });
      await this.payouts.holdForDispute(tx, p.eventId);
    });
    const [row] = await this.db.select().from(paymentDisputes).where(eq(paymentDisputes.id, id));
    if (!row) throw new AppError('INTERNAL', 'Dispute vanished');
    return toView(row);
  }

  /** The buyer's latest dispute on a payment, if any. */
  async latest(userId: string, paymentId: string): Promise<PaymentDispute | null> {
    const [row] = await this.db
      .select()
      .from(paymentDisputes)
      .where(and(eq(paymentDisputes.paymentId, paymentId), eq(paymentDisputes.userId, userId)))
      .orderBy(desc(paymentDisputes.createdAt))
      .limit(1);
    return row ? toView(row) : null;
  }

  /** Admin queue, oldest first, each with its check-in evidence. */
  async list(adminId: string, status: DisputeStatus): Promise<AdminDisputeList> {
    const rows = await this.db
      .select({ d: paymentDisputes, p: payments })
      .from(paymentDisputes)
      .innerJoin(payments, eq(payments.id, paymentDisputes.paymentId))
      .where(eq(paymentDisputes.status, status))
      .orderBy(asc(paymentDisputes.createdAt), asc(paymentDisputes.id))
      .limit(100);
    const cores = new Map(
      (await this.store.coresByIds([...new Set(rows.map((r) => r.d.eventId))])).map((c) => [
        c.id,
        c,
      ]),
    );
    const ids = rows.flatMap((r) => [r.p.userId, r.p.holderUserId]).filter((x): x is string => !!x);
    const cards = await this.people.cards(adminId, ids, { includeSelf: true });
    const card = (id: string | null): PersonCard =>
      (id ? cards.get(id) : undefined) ?? {
        id: id ?? '00000000-0000-7000-8000-000000000000',
        ...NOBODY,
      };
    const checkIns = new Map<string, Map<string, { at: Date; method: string | null }>>();
    const items: AdminDispute[] = [];
    for (const { d, p } of rows) {
      const core = cores.get(d.eventId);
      if (!core) continue;
      if (!checkIns.has(d.eventId))
        checkIns.set(d.eventId, await this.checkIns.checkIns(d.eventId));
      const seen = p.holderUserId ? checkIns.get(d.eventId)?.get(p.holderUserId) : undefined;
      items.push({
        ...toView(d),
        eventTitle: core.title,
        buyer: card(p.userId),
        amountPaise: p.amountPaise,
        refundedPaise: p.refundedPaise,
        evidence: {
          holder: p.holderUserId ? card(p.holderUserId) : null,
          checkedInAt: seen?.at.toISOString() ?? null,
          method: seen?.method ?? null,
          eventStartsAt: core.startsAt.toISOString(),
          eventEndsAt: core.endsAt.toISOString(),
          checkInOpenedAt: transferClosesAt(core.startsAt).toISOString(),
        },
        refundAllowed:
          d.status === 'open' &&
          disputeRefundAllowed({
            checkedIn: seen !== undefined,
            remainingPaise: p.amountPaise - p.refundedPaise,
          }),
      });
    }
    return { items };
  }

  async resolve(
    adminId: string,
    disputeId: string,
    body: ResolveDisputeBody,
    now: Date = new Date(),
  ): Promise<void> {
    const [d0] = await this.db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.id, disputeId));
    if (!d0) throw AppError.notFound('Dispute');
    const checkIns = await this.checkIns.checkIns(d0.eventId);
    const refunded = await this.db.transaction(async (tx) => {
      const [d] = await tx
        .select()
        .from(paymentDisputes)
        .where(eq(paymentDisputes.id, disputeId))
        .for('update');
      if (d?.status !== 'open') throw new AppError('CONFLICT', 'This dispute is already answered');
      const [p] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, d.paymentId))
        .for('update');
      if (!p) throw AppError.notFound('Payment');
      let refundId: string | null = null;
      if (body.decision === 'refund') {
        const [committed] = await tx
          .select({ n: sql<number>`coalesce(sum(${refunds.amountPaise}), 0)::int` })
          .from(refunds)
          .where(and(eq(refunds.paymentId, p.id), ne(refunds.status, 'failed')));
        const remaining = p.amountPaise - (committed?.n ?? 0);
        const checkedIn = p.holderUserId !== null && checkIns.has(p.holderUserId);
        if (!disputeRefundAllowed({ checkedIn, remainingPaise: remaining }))
          throw new AppError('NOT_ELIGIBLE', 'No refund after check-in', {
            reason: checkedIn ? 'CHECKED_IN' : 'NO_TICKET',
          });
        refundId = await this.refunds.request(
          tx,
          p,
          Math.min(body.amountPaise ?? remaining, remaining),
          'DISPUTE',
        );
      }
      await tx
        .update(paymentDisputes)
        .set({
          status: body.decision === 'refund' ? 'refunded' : 'rejected',
          resolutionNote: body.note,
          resolvedByUserId: adminId,
          resolvedAt: now,
          refundId,
        })
        .where(eq(paymentDisputes.id, d.id));
      await this.audit.record(
        {
          adminUserId: adminId,
          action: `dispute.${body.decision}`,
          targetType: 'payment_dispute',
          targetId: d.id,
          details: { paymentId: p.id, eventId: p.eventId, refundId, note: body.note },
        },
        tx,
      );
      await this.outbox.add(tx, {
        aggregateType: 'payment',
        aggregateId: p.id,
        type: DISPUTE_RESOLVED_EVENT,
        payload: {
          disputeId: d.id,
          paymentId: p.id,
          eventId: p.eventId,
          userId: d.userId,
          decision: body.decision,
        },
      });
      return refundId !== null;
    });
    // Money left the plan after its payout was frozen: recompute what is still unsent.
    if (refunded) await this.payouts.rebuild(d0.eventId);
  }

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.userId, userId));
    return { paymentDisputes: rows.map(toView) };
  }

  /** Kept with the payment for the accounts, without the person or what they wrote. */
  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx
      .update(paymentDisputes)
      .set({ userId: null, note: '' })
      .where(eq(paymentDisputes.userId, userId));
  }
}
