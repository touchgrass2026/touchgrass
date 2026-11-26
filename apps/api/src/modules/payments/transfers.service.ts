import { Inject, Injectable } from '@nestjs/common';
import {
  type AcceptTransferResult,
  type CreateTicketTransferBody,
  LIMITS,
  LOCALE_DEFAULTS,
  type PersonCard,
  type TicketTransfer,
  type TicketTransferList,
  transferClosesAt,
} from '@touchgrass/shared';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { randomToken } from '../../common/auth/hashing.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { payments, ticketTransfers } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { CitiesService } from '../cities/cities.service.js';
import { EventAccessService } from '../events/event-access.service.js';
import { EventStore } from '../events/event-store.service.js';
import { RsvpService } from '../events/rsvp.service.js';
import { AppSettingsService } from '../platform/app-settings.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { UsersService } from '../users/users.service.js';
import { transferBlock, transferOpen } from './payment.policy.js';
import { type PaymentRow, PaymentsService, TICKET_KINDS } from './payments.service.js';
import { RefundsService } from './refunds.service.js';

export const TRANSFER_OFFERED_EVENT = 'ticket.transfer_offered';
export const TRANSFER_DONE_EVENT = 'ticket.transferred';
export const TRANSFER_DECLINED_EVENT = 'ticket.transfer_declined';

type TransferRow = typeof ticketTransfers.$inferSelect;

const NOBODY: Omit<PersonCard, 'id'> = {
  displayName: '',
  photo: null,
  verified: false,
  mutualFriendCount: 0,
};

/** The transfer was answered (or the seat moved) while the money side was settling: roll the swap back. */
class TransferRaced extends Error {}

function unavailable(reason: string): AppError {
  return new AppError('TRANSFER_UNAVAILABLE', 'This ticket cannot change hands', { reason });
}

/**
 * In-app ticket transfers (D-229). A seat holder offers their paid seat to another member, free or for at most
 * what it cost. A free transfer moves the seat when the recipient accepts; a resale moves it when the
 * recipient's payment is verified (webhook, worker), and the seller gets that much back from their own payment.
 * The seat itself always changes hands under the event lock, in one transaction with the money side.
 */
@Injectable()
export class TransfersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly rsvp: RsvpService,
    private readonly store: EventStore,
    private readonly access: EventAccessService,
    private readonly people: PeopleService,
    private readonly users: UsersService,
    private readonly cities: CitiesService,
    private readonly settings: AppSettingsService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------- offering ----------

  async offer(
    fromId: string,
    eventId: string,
    body: CreateTicketTransferBody,
    now: Date = new Date(),
  ): Promise<TicketTransfer> {
    const { core, ctx, facts } = await this.access.visibleOrThrow(fromId, eventId);
    const paid = await this.payments.capturedFor(fromId, eventId);
    const block = transferBlock({
      pricePaise: body.pricePaise,
      planPricePaise: core.pricePaise,
      planOpen: core.status === 'published',
      startsAt: core.startsAt,
      now,
      holderStatus: facts.rsvp,
      holdsPaidSeat: paid !== null,
      originalPaise: paid?.amountPaise ?? 0,
      holderIsPayer: paid?.userId === fromId,
      fromUserId: fromId,
      toUserId: body.toUserId,
      isHost: facts.hostRole !== null,
      hasUnclaimedPlusOne: await this.rsvp.hasGuestSeat(eventId, fromId),
    });
    if (block) throw unavailable(block);
    if (!paid) throw unavailable('NO_TICKET');
    const recipient = await this.users.findById(body.toUserId);
    if (recipient?.status !== 'active' || ctx.blocked.has(body.toUserId))
      throw unavailable('RECIPIENT_INELIGIBLE');
    const can = await this.rsvp.canReceiveSeat(eventId, body.toUserId);
    if (can !== 'ok') throw unavailable(can);
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(ticketTransfers)
        .values({
          id,
          eventId,
          paymentId: paid.id,
          fromUserId: fromId,
          toUserId: body.toUserId,
          pricePaise: body.pricePaise,
          originalPaise: paid.amountPaise,
          status: 'pending',
          closesAt: transferClosesAt(core.startsAt),
        })
        .onConflictDoNothing()
        .returning({ id: ticketTransfers.id });
      if (inserted.length === 0) throw unavailable('TRANSFER_PENDING');
      await this.outbox.add(tx, {
        aggregateType: 'ticket_transfer',
        aggregateId: id,
        type: TRANSFER_OFFERED_EVENT,
        payload: {
          transferId: id,
          eventId,
          fromUserId: fromId,
          toUserId: body.toUserId,
          pricePaise: body.pricePaise,
        },
      });
    });
    return this.get(fromId, id, now);
  }

  // ---------- reading ----------

  async list(userId: string, now: Date = new Date()): Promise<TicketTransferList> {
    const rows = await this.db
      .select()
      .from(ticketTransfers)
      .where(or(eq(ticketTransfers.fromUserId, userId), eq(ticketTransfers.toUserId, userId)))
      .orderBy(desc(ticketTransfers.createdAt), desc(ticketTransfers.id))
      .limit(50);
    return { items: await this.views(userId, rows, now) };
  }

  async get(userId: string, id: string, now: Date = new Date()): Promise<TicketTransfer> {
    const t = await this.mine(userId, id);
    const [view] = await this.views(userId, [t], now);
    if (!view) throw AppError.notFound('Transfer');
    return view;
  }

  private async mine(userId: string, id: string): Promise<TransferRow> {
    const [t] = await this.db
      .select()
      .from(ticketTransfers)
      .where(
        and(
          eq(ticketTransfers.id, id),
          or(eq(ticketTransfers.fromUserId, userId), eq(ticketTransfers.toUserId, userId)),
        ),
      )
      .limit(1);
    if (!t) throw AppError.notFound('Transfer');
    return t;
  }

  private async views(viewerId: string, rows: TransferRow[], now: Date): Promise<TicketTransfer[]> {
    if (rows.length === 0) return [];
    const cores = await this.store.coresByIds([...new Set(rows.map((r) => r.eventId))]);
    const byId = new Map(cores.map((c) => [c.id, c]));
    const zones = await this.cities.timezones([...new Set(cores.map((c) => c.cityId))]);
    const ids = rows.flatMap((r) => [r.fromUserId, r.toUserId]).filter((x): x is string => !!x);
    const cards = await this.people.cards(viewerId, ids, { includeSelf: true });
    const card = (id: string | null): PersonCard =>
      (id ? cards.get(id) : undefined) ?? {
        id: id ?? '00000000-0000-7000-8000-000000000000',
        ...NOBODY,
      };
    return rows.map((r) => {
      const core = byId.get(r.eventId);
      // An unanswered offer lapses when check-in opens; shown as such before the sweep records it.
      const lapsed = r.status === 'pending' && !transferOpen({ ...r, now });
      return {
        id: r.id,
        eventId: r.eventId,
        eventTitle: core?.title ?? '',
        eventStartsAt: (core?.startsAt ?? r.closesAt).toISOString(),
        eventTimezone: (core && zones.get(core.cityId)) ?? LOCALE_DEFAULTS.timezone,
        status: lapsed ? 'expired' : r.status,
        pricePaise: r.pricePaise,
        originalPaise: r.originalPaise,
        direction: r.toUserId === viewerId ? 'incoming' : 'outgoing',
        from: card(r.fromUserId),
        to: card(r.toUserId),
        closesAt: r.closesAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        respondedAt: r.respondedAt?.toISOString() ?? null,
      };
    });
  }

  // ---------- answering ----------

  async accept(toId: string, id: string, now: Date = new Date()): Promise<AcceptTransferResult> {
    const t = await this.mine(toId, id);
    if (t.toUserId !== toId || !t.fromUserId) throw AppError.notFound('Transfer');
    if (!transferOpen({ ...t, now })) {
      await this.expire(t, now);
      throw unavailable('TRANSFER_CLOSED');
    }
    const fromId = t.fromUserId;
    if (t.pricePaise === 0) {
      let swapped = false;
      try {
        swapped = await this.rsvp.transferSeat(
          t.eventId,
          fromId,
          toId,
          async (tx, ok) => {
            if (ok) await this.finish(tx, t, now, null);
          },
          now,
        );
      } catch (err) {
        if (err instanceof TransferRaced) throw unavailable('TRANSFER_CLOSED');
        throw err;
      }
      if (!swapped) throw unavailable('TRANSFER_CLOSED');
      await this.store.invalidate(t.eventId);
      return { kind: 'transferred', eventId: t.eventId };
    }
    // Resale: the recipient pays first; the seat moves when the payment is verified.
    const can = await this.rsvp.canReceiveSeat(t.eventId, toId);
    if (can !== 'ok') throw unavailable(can);
    const token = randomToken();
    const open = await this.payments.openFor(toId, t.eventId, 'resale', now);
    if (open?.transferId === t.id) {
      const session = await this.payments.refreshOpen(toId, t.eventId, 'resale', token, now);
      if (session) return { kind: 'checkout', session };
    }
    const paymentId = uuidv7();
    const feeBps = await this.settings.get('platform_fee_bps');
    await this.db.transaction(async (tx) => {
      await this.payments.supersedeOpen(tx, t.eventId, toId, 'resale');
      await tx.insert(payments).values({
        id: paymentId,
        eventId: t.eventId,
        userId: toId,
        holderUserId: toId,
        kind: 'resale',
        transferId: t.id,
        status: 'created',
        amountPaise: t.pricePaise,
        feeBps,
        checkoutTokenHash: this.payments.hashToken(token),
        holdExpiresAt: new Date(now.getTime() + LIMITS.payments.holdMs),
      });
    });
    const p = await this.payments.attachOrder(paymentId, now);
    return { kind: 'checkout', session: this.payments.session(p, token) };
  }

  /**
   * Worker: the recipient's resale payment was verified. Under the event lock the seat moves, the payment is
   * recorded, and the seller gets the price back from their own payment. If the offer is gone (cancelled,
   * lapsed, the seller dropped out) the buyer's money goes straight back instead. Idempotent.
   */
  async completeResale(
    p: PaymentRow,
    capture: (tx: Tx) => Promise<PaymentRow | null>,
    now: Date = new Date(),
  ): Promise<void> {
    const [t] = p.transferId
      ? await this.db.select().from(ticketTransfers).where(eq(ticketTransfers.id, p.transferId))
      : [];
    const voidIt = () =>
      this.db.transaction(async (tx) => {
        const captured = await capture(tx);
        if (captured)
          await this.refunds.request(tx, captured, captured.amountPaise, 'TRANSFER_VOID');
      });
    if (!t?.fromUserId || !t.toUserId || t.toUserId !== p.userId || !transferOpen({ ...t, now })) {
      await voidIt();
      return;
    }
    try {
      await this.rsvp.transferSeat(
        t.eventId,
        t.fromUserId,
        t.toUserId,
        async (tx, ok) => {
          const captured = await capture(tx);
          if (!captured) return;
          if (!ok) {
            await this.refunds.request(tx, captured, captured.amountPaise, 'TRANSFER_VOID');
            return;
          }
          await this.finish(tx, t, now, captured);
        },
        now,
      );
    } catch (err) {
      if (!(err instanceof TransferRaced)) throw err;
      await voidIt();
    }
    await this.store.invalidate(t.eventId);
  }

  /** Inside the seat swap: the offer is accepted, the seat's payments follow it, the seller is paid back. */
  private async finish(
    tx: Tx,
    t: TransferRow,
    now: Date,
    resale: PaymentRow | null,
  ): Promise<void> {
    const accepted = await tx
      .update(ticketTransfers)
      .set({ status: 'accepted', respondedAt: now })
      .where(and(eq(ticketTransfers.id, t.id), eq(ticketTransfers.status, 'pending')))
      .returning({ id: ticketTransfers.id });
    if (accepted.length === 0 || !t.fromUserId || !t.toUserId) throw new TransferRaced();
    // Every ticket payment behind the seat now backs the new holder's seat (escrow counts their check-in).
    await tx
      .update(payments)
      .set({ holderUserId: t.toUserId })
      .where(
        and(
          eq(payments.eventId, t.eventId),
          eq(payments.holderUserId, t.fromUserId),
          inArray(payments.kind, [...TICKET_KINDS]),
        ),
      );
    if (resale) {
      const [original] = await tx
        .update(payments)
        .set({ ticketReleasedAt: now })
        .where(eq(payments.id, t.paymentId))
        .returning();
      if (original) await this.refunds.request(tx, original, t.pricePaise, 'RESOLD');
    }
    await this.outbox.add(tx, {
      aggregateType: 'ticket_transfer',
      aggregateId: t.id,
      type: TRANSFER_DONE_EVENT,
      payload: {
        transferId: t.id,
        eventId: t.eventId,
        fromUserId: t.fromUserId,
        toUserId: t.toUserId,
        pricePaise: t.pricePaise,
      },
    });
  }

  async decline(toId: string, id: string, now: Date = new Date()): Promise<void> {
    const t = await this.mine(toId, id);
    if (t.toUserId !== toId) throw AppError.notFound('Transfer');
    await this.db.transaction(async (tx) => {
      const done = await tx
        .update(ticketTransfers)
        .set({ status: 'declined', respondedAt: now })
        .where(and(eq(ticketTransfers.id, id), eq(ticketTransfers.status, 'pending')))
        .returning({ id: ticketTransfers.id });
      if (done.length === 0) return;
      await this.outbox.add(tx, {
        aggregateType: 'ticket_transfer',
        aggregateId: id,
        type: TRANSFER_DECLINED_EVENT,
        payload: { transferId: id, eventId: t.eventId, fromUserId: t.fromUserId, toUserId: toId },
      });
    });
    await this.closeOpenResale(t, now);
  }

  async cancel(fromId: string, id: string, now: Date = new Date()): Promise<void> {
    const t = await this.mine(fromId, id);
    if (t.fromUserId !== fromId) throw AppError.notFound('Transfer');
    await this.db
      .update(ticketTransfers)
      .set({ status: 'cancelled', respondedAt: now })
      .where(and(eq(ticketTransfers.id, id), eq(ticketTransfers.status, 'pending')));
    await this.closeOpenResale(t, now);
  }

  /** The seller lost their seat (cancelled) or the plan was called off: open offers on it close. */
  async closeFor(eventId: string, fromId: string | null, now: Date = new Date()): Promise<number> {
    const rows = await this.db
      .update(ticketTransfers)
      .set({ status: 'cancelled', respondedAt: now })
      .where(
        and(
          eq(ticketTransfers.eventId, eventId),
          eq(ticketTransfers.status, 'pending'),
          fromId ? eq(ticketTransfers.fromUserId, fromId) : undefined,
        ),
      )
      .returning();
    for (const t of rows) await this.closeOpenResale(t, now);
    return rows.length;
  }

  private async expire(t: TransferRow, now: Date): Promise<void> {
    await this.db
      .update(ticketTransfers)
      .set({ status: 'expired' })
      .where(and(eq(ticketTransfers.id, t.id), eq(ticketTransfers.status, 'pending')));
    await this.closeOpenResale(t, now);
  }

  /** A checkout started for an offer that closed gives nothing back to hold; it just stops. */
  private async closeOpenResale(t: TransferRow, now: Date): Promise<void> {
    const open = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.transferId, t.id),
          eq(payments.kind, 'resale'),
          inArray(payments.status, ['created', 'failed']),
        ),
      );
    for (const p of open) await this.payments.release(p, 'expired', now);
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    return { ticketTransfers: (await this.list(userId)).items };
  }

  /** Transfers are kept with the payments they moved, detached from the person. */
  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx
      .update(ticketTransfers)
      .set({ fromUserId: null })
      .where(eq(ticketTransfers.fromUserId, userId));
    await tx
      .update(ticketTransfers)
      .set({ toUserId: null })
      .where(eq(ticketTransfers.toUserId, userId));
  }
}
