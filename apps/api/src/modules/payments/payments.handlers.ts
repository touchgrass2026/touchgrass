import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, isNull, and } from 'drizzle-orm';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { EmailSender } from '../../adapters/email/email.port.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { payments } from '../../infra/database/schema/index.js';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { RSVP_CHECKED_IN_EVENT } from '../events/check-in.service.js';
import { EventStore } from '../events/event-store.service.js';
import { EVENT_CANCELLED_EVENT, EVENT_COMPLETED_EVENT } from '../events/events.service.js';
import { RSVP_CANCELLED_EVENT } from '../events/rsvp.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { UsersService } from '../users/users.service.js';
import { DISPUTE_RESOLVED_EVENT } from './disputes.service.js';
import { PaidSeatsService, PLUS_ONE_CLAIMED_EVENT } from './paid-seats.service.js';
import {
  TRANSFER_DECLINED_EVENT,
  TRANSFER_DONE_EVENT,
  TRANSFER_OFFERED_EVENT,
  TransfersService,
} from './transfers.service.js';
import {
  PAYMENT_CAPTURED_EVENT,
  PaymentsService,
  REFUND_REQUESTED_EVENT,
} from './payments.service.js';
import { receiptEmail } from './receipt-email.js';
import { RefundsService } from './refunds.service.js';

/** Worker side of payments: refunds follow cancellations, receipts are emailed once, refunds are sent. */
@Injectable()
export class PaymentsHandlers {
  private readonly logger = new Logger(PaymentsHandlers.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly users: UsersService,
    private readonly email: EmailSender,
    @Inject(ENV) private readonly env: Env,
    private readonly transfers: TransfersService,
    private readonly paidSeats: PaidSeatsService,
    private readonly notifications: NotificationsService,
    private readonly profiles: ProfilesService,
    private readonly store: EventStore,
  ) {}

  private async names(...ids: unknown[]): Promise<Map<string, string>> {
    return this.profiles.displayNames(ids.filter((id): id is string => typeof id === 'string'));
  }

  private async title(eventId: string): Promise<string> {
    return (await this.store.core(eventId))?.title ?? '';
  }

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(RSVP_CANCELLED_EVENT, 'payments.attendee-cancelled', async (e) => {
      const userId = String(e.payload.userId);
      if (e.payload.wasHeld === true) {
        const open = await this.db
          .select()
          .from(payments)
          .where(and(eq(payments.eventId, e.aggregateId), eq(payments.userId, userId)));
        for (const p of open)
          if (p.status === 'created' || p.status === 'failed')
            await this.payments.release(p, 'expired', new Date());
      }
      // A transferred seat (D-229) was paid for by the transfer itself: no refund, nothing to close.
      if (e.payload.hadSeat === true && e.payload.transferred !== true) {
        const at =
          typeof e.payload.cancelledAt === 'string' ? new Date(e.payload.cancelledAt) : new Date();
        await this.refunds.onAttendeeCancelled(e.aggregateId, userId, at, e.payload.late === true);
        await this.transfers.closeFor(e.aggregateId, userId);
      }
    });
    bus.subscribe(EVENT_CANCELLED_EVENT, 'payments.event-cancelled', async (e) => {
      const by = typeof e.payload.byUserId === 'string' ? e.payload.byUserId : null;
      await this.refunds.onEventCancelled(e.aggregateId, new Date(), by);
      await this.transfers.closeFor(e.aggregateId, null);
    });
    bus.subscribe(RSVP_CHECKED_IN_EVENT, 'payments.deposit-returned', async (e) => {
      await this.paidSeats.onCheckedIn(e.aggregateId, String(e.payload.userId));
    });
    bus.subscribe(EVENT_COMPLETED_EVENT, 'payments.deposits-settled', async (e) => {
      await this.paidSeats.onCompleted(e.aggregateId);
    });
    bus.subscribe(TRANSFER_OFFERED_EVENT, 'payments.notify-transfer-offer', async (e) => {
      const p = e.payload;
      const names = await this.names(p.fromUserId);
      await this.notifications.notify(
        [String(p.toUserId)],
        'ticket_transfer_offer',
        {
          name: names.get(String(p.fromUserId)) ?? '',
          title: await this.title(String(p.eventId)),
          transferId: String(p.transferId),
        },
        { collapseKey: `transfer:${String(p.transferId)}` },
      );
    });
    bus.subscribe(TRANSFER_DONE_EVENT, 'payments.notify-transfer-done', async (e) => {
      const p = e.payload;
      const names = await this.names(p.toUserId);
      await this.notifications.notify(
        [String(p.fromUserId)],
        'ticket_transfer_done',
        {
          name: names.get(String(p.toUserId)) ?? '',
          title: await this.title(String(p.eventId)),
          eventId: String(p.eventId),
        },
        { collapseKey: `transfer:${String(p.transferId)}` },
      );
    });
    bus.subscribe(TRANSFER_DECLINED_EVENT, 'payments.notify-transfer-declined', async (e) => {
      const p = e.payload;
      const names = await this.names(p.toUserId);
      await this.notifications.notify(
        [String(p.fromUserId)],
        'ticket_transfer_declined',
        {
          name: names.get(String(p.toUserId)) ?? '',
          title: await this.title(String(p.eventId)),
          eventId: String(p.eventId),
        },
        { collapseKey: `transfer:${String(p.transferId)}` },
      );
    });
    bus.subscribe(PLUS_ONE_CLAIMED_EVENT, 'payments.notify-plus-one-claimed', async (e) => {
      const p = e.payload;
      const names = await this.names(p.holderId);
      await this.notifications.notify(
        [String(p.buyerId)],
        'plus_one_ticket_claimed',
        {
          name: names.get(String(p.holderId)) ?? '',
          title: await this.title(String(p.eventId)),
          eventId: String(p.eventId),
        },
        { collapseKey: `plus-one:${String(p.paymentId)}` },
      );
    });
    bus.subscribe(DISPUTE_RESOLVED_EVENT, 'payments.notify-dispute-resolved', async (e) => {
      const p = e.payload;
      if (typeof p.userId !== 'string') return;
      await this.notifications.notify(
        [p.userId],
        'payment_dispute_resolved',
        {
          title: await this.title(String(p.eventId)),
          outcome: {
            t:
              p.decision === 'refund'
                ? 'tickets.disputeOutcome.refunded'
                : 'tickets.disputeOutcome.rejected',
          },
          paymentId: String(p.paymentId),
        },
        { collapseKey: `dispute:${String(p.disputeId)}` },
      );
    });
    bus.subscribe(REFUND_REQUESTED_EVENT, 'payments.send-refund', async (e) => {
      await this.refunds.execute(String(e.payload.refundId));
    });
    bus.subscribe(PAYMENT_CAPTURED_EVENT, 'payments.email-receipt', async (e) => {
      await this.emailReceipt(String(e.payload.paymentId));
    });
  }

  /** At most once per payment: the row is claimed before sending. */
  async emailReceipt(paymentId: string): Promise<boolean> {
    const [p] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    if (!p?.userId || p.receiptEmailedAt) return false;
    const user = await this.users.findById(p.userId);
    if (!user?.receiptEmail) return false;
    const receipt = await this.payments.buildReceipt(p);
    const [claimed] = await this.db
      .update(payments)
      .set({ receiptEmailedAt: new Date() })
      .where(and(eq(payments.id, p.id), isNull(payments.receiptEmailedAt)))
      .returning({ id: payments.id });
    if (!claimed) return false;
    try {
      await this.email.send(
        receiptEmail(user.receiptEmail, receipt, user.language, this.env.WEB_PUBLIC_URL),
      );
      return true;
    } catch (err) {
      // Release the claim so the outbox retry sends it.
      await this.db.update(payments).set({ receiptEmailedAt: null }).where(eq(payments.id, p.id));
      this.logger.warn(`Receipt email for ${p.id} failed: ${String(err)}`);
      throw err;
    }
  }
}
