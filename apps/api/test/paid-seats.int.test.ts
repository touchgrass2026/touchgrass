import type {
  AcceptTransferResult,
  AdminDisputeList,
  AdminHeldPayoutList,
  CheckoutResult,
  EventDetail,
  PaymentDispute,
  PaymentView,
  PlusOneCheckout,
  PlusOneTicket,
  RefundQuote,
  TicketTransfer,
  TicketTransferList,
} from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FakePaymentsGateway,
  type SimulatedWebhook,
} from '../src/adapters/payments/fake.payments.js';
import { EventStore } from '../src/modules/events/event-store.service.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { CheckInSignals } from '../src/modules/payments/check-in-signals.js';
import { PaymentsHandlers } from '../src/modules/payments/payments.handlers.js';
import { PayoutsService } from '../src/modules/payments/payouts.service.js';
import { WebhooksService } from '../src/modules/payments/webhooks.service.js';
import { FeatureFlagsService } from '../src/modules/platform/feature-flags.service.js';
import { ReliabilityHandlers } from '../src/modules/reliability/reliability.handlers.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { DomainEventBus } from '../src/worker/domain-event-bus.js';
import { idem, plot, rsvp, shiftEvent, verifiedMember } from './event-helpers.js';
import {
  bearer,
  createHarness,
  fromIp,
  type Harness,
  member,
  type Member,
  onboard,
  signIn,
} from './harness.js';

/**
 * Paid seats after the sale (D-229): escrow payouts from check-ins, refund rules, disputes with check-in
 * evidence, ticket transfers, paid +1s and refundable deposits. Money moves only through the fake gateway's
 * signed webhooks, applied by the worker step.
 */
let h: Harness;
const gateway = new FakePaymentsGateway();
let admin: Member;
const PRICE = 50_000;
/** Plans with an open fake-headcount flag (the at-event door tools register the real source). */
const flagged = new Set<string>();

beforeAll(async () => {
  h = await createHarness({ payments: gateway });
  const s = await signIn(h);
  await onboard(h, s.accessToken);
  await h.app.get(UsersService).grantRole(s.user.id, 'admin', null);
  const refreshed = await request(h.http)
    .post('/v1/auth/refresh')
    .set(...fromIp())
    .send({ refreshToken: s.refreshToken })
    .expect(200);
  admin = { id: s.user.id, token: refreshed.body.accessToken as string, phone: s.phone };
  h.app.get(CheckInSignals).register({
    openFlags: (eventId) =>
      Promise.resolve(
        flagged.has(eventId)
          ? [{ id: `flag-${eventId}`, reason: 'More scans than people', raisedAt: new Date() }]
          : [],
      ),
  });
});
afterAll(async () => {
  await h.close();
});

// ---------- helpers ----------

const HANDLED = [
  'rsvp.cancelled',
  'rsvp.checked_in',
  'event.cancelled',
  'event.completed',
  'payment.captured',
  'payment.refund_requested',
  'payment.plus_one_claimed',
  'payment.dispute_resolved',
  'payments.host_cancelled_paid',
  'ticket.transfer_offered',
  'ticket.transferred',
  'ticket.transfer_declined',
];
const dispatched = new Set<string>();

/** Runs the worker's payments (and reliability) handlers over new outbox rows, as the relay would. */
async function drain(): Promise<void> {
  const bus = new DomainEventBus();
  h.app.get(PaymentsHandlers).registerOn(bus);
  h.app.get(ReliabilityHandlers).registerOn(bus);
  for (;;) {
    const { rows } = await h.pool.query<{
      id: string;
      aggregate_type: string;
      aggregate_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      created_at: Date;
    }>('SELECT * FROM outbox_events WHERE event_type = ANY($1) ORDER BY created_at', [HANDLED]);
    const fresh = rows.filter((r) => !dispatched.has(r.id));
    if (fresh.length === 0) return;
    for (const r of fresh) {
      dispatched.add(r.id);
      await bus.dispatch({
        eventId: r.id,
        aggregateType: r.aggregate_type,
        aggregateId: r.aggregate_id,
        type: r.event_type,
        payload: r.payload,
        occurredAt: r.created_at.toISOString(),
      });
    }
  }
}

async function deliver(w: SimulatedWebhook): Promise<void> {
  await request(h.http)
    .post('/v1/webhooks/payments')
    .set('content-type', 'application/json')
    .set('x-razorpay-signature', w.signature)
    .set('x-razorpay-event-id', w.eventId)
    .send(w.rawBody)
    .expect(200);
  await h.app.get(WebhooksService).process(w.eventId);
}

async function orderOf(paymentId: string): Promise<string> {
  const { rows } = await h.pool.query<{ provider_order_id: string }>(
    'SELECT provider_order_id FROM payments WHERE id = $1',
    [paymentId],
  );
  return rows[0]?.provider_order_id ?? '';
}

async function pay(paymentId: string): Promise<void> {
  await deliver(gateway.simulatePaymentCaptured(await orderOf(paymentId)));
}

async function approvedHost(): Promise<Member> {
  const m = await verifiedMember(h);
  const app = await request(h.http)
    .post('/v1/host/applications')
    .set(...bearer(m.token))
    .set(...idem())
    .send({
      about: 'I run small pottery workshops in Jubilee Hills.',
      experience: 'Hosted forty workshops for groups of six to twenty.',
      eventIdeas: 'Wheel nights with chai, materials included.',
    })
    .expect(201);
  await request(h.http)
    .post(`/v1/admin/host-applications/${app.body.id as string}/review`)
    .set(...bearer(admin.token))
    .send({ decision: 'approved' })
    .expect(201);
  return m;
}

/** An approved host with an activated payout account (KYC done). */
async function kycHost(): Promise<Member> {
  const host = await approvedHost();
  await request(h.http)
    .post('/v1/host/account')
    .set(...bearer(host.token))
    .set(...idem())
    .send({ legalBusinessName: 'Clay Co', contactName: 'Asha', email: 'asha@example.com' })
    .expect(201);
  const { rows } = await h.pool.query<{ provider_account_id: string }>(
    'SELECT provider_account_id FROM host_accounts WHERE user_id = $1',
    [host.id],
  );
  await deliver(gateway.simulateAccount('activated', rows[0]?.provider_account_id ?? ''));
  return host;
}

const paidPlan = (host: Member, overrides: Record<string, unknown> = {}): Promise<EventDetail> =>
  plot(h, host, { pricePaise: PRICE, ...overrides });

async function buy(m: Member, eventId: string): Promise<string> {
  const res = (
    await request(h.http)
      .post(`/v1/events/${eventId}/checkout`)
      .set(...bearer(m.token))
      .set(...idem())
      .send({})
      .expect(201)
  ).body as CheckoutResult;
  if (res.kind !== 'checkout') throw new Error('no checkout');
  await pay(res.session.paymentId);
  return res.session.paymentId;
}

async function checkInBySql(eventId: string, userId: string): Promise<void> {
  await h.pool.query(
    `UPDATE rsvps SET status = 'checked_in', checked_in_at = now(), check_in_method = 'qr'
     WHERE event_id = $1 AND user_id = $2`,
    [eventId, userId],
  );
}

async function complete(eventId: string): Promise<void> {
  await h.pool.query(
    `UPDATE events SET status = 'completed', completed_at = now(),
       starts_at = now() - interval '3 days', ends_at = now() - interval '2 days' WHERE id = $1`,
    [eventId],
  );
  await h.app.get(EventStore).invalidate(eventId);
}

const payment = async (m: Member, id: string): Promise<PaymentView> =>
  (
    await request(h.http)
      .get(`/v1/payments/${id}`)
      .set(...bearer(m.token))
      .expect(200)
  ).body as PaymentView;

async function rsvpStatus(eventId: string, userId: string): Promise<string | null> {
  const { rows } = await h.pool.query<{ status: string }>(
    'SELECT status FROM rsvps WHERE event_id = $1 AND user_id = $2',
    [eventId, userId],
  );
  return rows[0]?.status ?? null;
}

async function inbox(m: Member): Promise<{ kind: string; title: string; url: string }[]> {
  const res = await request(h.http)
    .get('/v1/notifications')
    .set(...bearer(m.token))
    .expect(200);
  return res.body.items as { kind: string; title: string; url: string }[];
}

async function payoutOf(eventId: string) {
  const { rows } = await h.pool.query<{
    id: string;
    status: string;
    hold_reason: string | null;
    net_paise: number;
    withheld_paise: number;
    paid_seats: number;
    checked_in_seats: number;
    max_net_paise: number;
  }>('SELECT * FROM payouts WHERE event_id = $1', [eventId]);
  return rows[0];
}

// ---------- escrow payouts ----------

describe('escrow payouts from check-ins (D-229)', () => {
  it('pays the host for checked-in paid seats only, minus the platform fee', async () => {
    const host = await kycHost();
    const plan = await paidPlan(host);
    const [a, b, c] = [await member(h), await member(h), await member(h)];
    for (const m of [a, b, c]) await buy(m, plan.id);
    await checkInBySql(plan.id, a.id);
    await checkInBySql(plan.id, b.id);
    await complete(plan.id);

    const payouts = h.app.get(PayoutsService);
    expect(await payouts.createFor(plan.id)).toBe(true);
    // Each seat: 50 000 - fee 5 000 - GST 900 = 44 100 to the host. c never showed up.
    expect(await payoutOf(plan.id)).toMatchObject({
      status: 'pending',
      hold_reason: null,
      paid_seats: 3,
      checked_in_seats: 2,
      net_paise: 88_200,
      withheld_paise: 44_100,
      max_net_paise: 132_300,
    });
    const { rows } = await h.pool.query<{ amount_paise: number }>(
      `SELECT t.amount_paise FROM payout_transfers t JOIN payouts p ON p.id = t.payout_id
       WHERE p.event_id = $1 ORDER BY t.amount_paise`,
      [plan.id],
    );
    expect(rows.map((r) => r.amount_paise)).toEqual([44_100, 44_100]);
  });

  it('holds a flagged plan for review; admins adjust and release it, with audit entries', async () => {
    const host = await kycHost();
    const plan = await paidPlan(host, { title: 'Flagged pottery night' });
    const [a, b] = [await member(h), await member(h)];
    await buy(a, plan.id);
    await buy(b, plan.id);
    await checkInBySql(plan.id, a.id);
    await complete(plan.id);
    flagged.add(plan.id);
    await h.app.get(PayoutsService).createFor(plan.id);
    expect(await payoutOf(plan.id)).toMatchObject({
      status: 'on_hold',
      hold_reason: 'HEADCOUNT_FLAG',
      net_paise: 44_100,
    });

    const held = (
      await request(h.http)
        .get('/v1/admin/payouts/held')
        .set(...bearer(admin.token))
        .expect(200)
    ).body as AdminHeldPayoutList;
    const item = held.items.find((p) => p.eventId === plan.id);
    expect(item).toMatchObject({
      holdReason: 'HEADCOUNT_FLAG',
      paidSeats: 2,
      checkedInSeats: 1,
      withheldPaise: 44_100,
      maxNetPaise: 88_200,
      flags: [expect.objectContaining({ reason: 'More scans than people' })],
    });
    const someone = await member(h);
    await request(h.http)
      .get('/v1/admin/payouts/held')
      .set(...bearer(someone.token))
      .expect(403);
    const id = item?.id ?? '';
    await request(h.http)
      .post(`/v1/admin/payouts/${id}/adjust`)
      .set(...bearer(admin.token))
      .send({ netPaise: 88_201, note: 'Too much' })
      .expect(409);
    await request(h.http)
      .post(`/v1/admin/payouts/${id}/adjust`)
      .set(...bearer(admin.token))
      .send({ netPaise: 60_000, note: 'Scanner failed for one guest' })
      .expect(204);
    await request(h.http)
      .post(`/v1/admin/payouts/${id}/release`)
      .set(...bearer(admin.token))
      .send({ note: 'Checked with the venue' })
      .expect(204);
    expect(await payoutOf(plan.id)).toMatchObject({ status: 'pending', net_paise: 60_000 });
    const { rows: transfers } = await h.pool.query<{ amount_paise: number }>(
      'SELECT amount_paise FROM payout_transfers WHERE payout_id = $1 ORDER BY amount_paise',
      [id],
    );
    expect(transfers.map((t) => t.amount_paise)).toEqual([15_900, 44_100]);
    const { rows: audit } = await h.pool.query<{ action: string }>(
      `SELECT action FROM admin_actions WHERE target_id = $1 ORDER BY created_at`,
      [id],
    );
    expect(audit.map((r) => r.action)).toEqual(['payout.adjust', 'payout.release']);
    // A second release is refused: it is no longer held.
    await request(h.http)
      .post(`/v1/admin/payouts/${id}/release`)
      .set(...bearer(admin.token))
      .send({ note: 'Again' })
      .expect(409);
    flagged.delete(plan.id);
  });

  it('a paid plan nobody checked in to waits for an admin, even with KYC done', async () => {
    const host = await kycHost();
    const plan = await paidPlan(host);
    await buy(await member(h), plan.id);
    await complete(plan.id);
    await h.app.get(PayoutsService).createFor(plan.id);
    expect(await payoutOf(plan.id)).toMatchObject({
      status: 'on_hold',
      hold_reason: 'NO_CHECK_INS',
      net_paise: 0,
      withheld_paise: 44_100,
    });
  });
});

// ---------- refund rules ----------

describe('refund rules (D-229)', () => {
  it('nothing comes back once checked in', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host);
    const a = await member(h);
    await buy(a, plan.id);
    await checkInBySql(plan.id, a.id);
    const quote = (
      await request(h.http)
        .get(`/v1/events/${plan.id}/refund-quote`)
        .set(...bearer(a.token))
        .expect(200)
    ).body as RefundQuote;
    expect(quote).toMatchObject({ refundPaise: 0, reason: 'CHECKED_IN' });
    await request(h.http)
      .delete(`/v1/events/${plan.id}/rsvp`)
      .set(...bearer(a.token))
      .expect(409);
  });

  it('a host calling off a paid plan refunds everyone in full and costs the host reliability', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host, { refundPolicy: { kind: 'none', cutoffHours: 0 } });
    const [a, b] = [await member(h), await member(h)];
    const pa = await buy(a, plan.id);
    await buy(b, plan.id);
    await request(h.http)
      .post(`/v1/events/${plan.id}/cancel`)
      .set(...bearer(host.token))
      .set(...idem())
      .send({ reason: 'Venue flooded' })
      .expect(200);
    await drain();
    expect((await payment(a, pa)).refunds).toEqual([
      expect.objectContaining({ amountPaise: PRICE, reason: 'HOST_CANCELLED' }),
    ]);
    const { rows } = await h.pool.query<{ kind: string }>(
      'SELECT kind FROM reliability_events WHERE user_id = $1 AND event_id = $2',
      [host.id, plan.id],
    );
    expect(rows.map((r) => r.kind)).toEqual(['host_cancel']);
  });

  it('a free plan called off costs nothing', async () => {
    const host = await verifiedMember(h);
    const plan = await plot(h, host);
    await rsvp(h, await member(h), plan.id).expect(200);
    await request(h.http)
      .post(`/v1/events/${plan.id}/cancel`)
      .set(...bearer(host.token))
      .set(...idem())
      .send({ reason: 'Rain' })
      .expect(200);
    await drain();
    const { rows } = await h.pool.query(
      `SELECT 1 FROM reliability_events WHERE user_id = $1 AND kind = 'host_cancel'`,
      [host.id],
    );
    expect(rows).toEqual([]);
  });
});

// ---------- disputes ----------

describe('payment disputes with check-in evidence (D-229)', () => {
  it('holds the payout; a no-show seat can be refunded, a checked-in one cannot', async () => {
    const host = await kycHost();
    const plan = await paidPlan(host, { title: 'Disputed wheel night' });
    const [came, missed] = [await member(h), await member(h)];
    const pCame = await buy(came, plan.id);
    const pMissed = await buy(missed, plan.id);
    await checkInBySql(plan.id, came.id);
    await complete(plan.id);
    await h.app.get(PayoutsService).createFor(plan.id);
    expect((await payoutOf(plan.id))?.status).toBe('pending');

    const opened = (
      await request(h.http)
        .post(`/v1/payments/${pMissed}/disputes`)
        .set(...bearer(missed.token))
        .set(...idem())
        .send({ reason: 'NOT_ADMITTED', note: 'The door was locked.' })
        .expect(201)
    ).body as PaymentDispute;
    expect(opened.status).toBe('open');
    await request(h.http)
      .post(`/v1/payments/${pMissed}/disputes`)
      .set(...bearer(missed.token))
      .set(...idem())
      .send({ reason: 'OTHER' })
      .expect(409);
    await request(h.http)
      .post(`/v1/payments/${pCame}/disputes`)
      .set(...bearer(came.token))
      .set(...idem())
      .send({ reason: 'NOT_AS_DESCRIBED' })
      .expect(201);
    expect(await payoutOf(plan.id)).toMatchObject({
      status: 'on_hold',
      hold_reason: 'DISPUTE_OPEN',
    });

    const list = (
      await request(h.http)
        .get('/v1/admin/payment-disputes')
        .set(...bearer(admin.token))
        .expect(200)
    ).body as AdminDisputeList;
    const forMissed = list.items.find((d) => d.paymentId === pMissed);
    const forCame = list.items.find((d) => d.paymentId === pCame);
    expect(forMissed).toMatchObject({
      refundAllowed: true,
      evidence: { checkedInAt: null, method: null },
    });
    expect(forCame).toMatchObject({ refundAllowed: false, evidence: { method: 'qr' } });
    expect(forCame?.evidence.checkedInAt).not.toBeNull();

    // Releasing waits for the answers.
    const payoutId = (await payoutOf(plan.id))?.id ?? '';
    await request(h.http)
      .post(`/v1/admin/payouts/${payoutId}/release`)
      .set(...bearer(admin.token))
      .send({ note: 'Too early' })
      .expect(409);
    await request(h.http)
      .post(`/v1/admin/payment-disputes/${forCame?.id ?? ''}/resolve`)
      .set(...bearer(admin.token))
      .send({ decision: 'refund', note: 'Trying' })
      .expect(403);
    await request(h.http)
      .post(`/v1/admin/payment-disputes/${forCame?.id ?? ''}/resolve`)
      .set(...bearer(admin.token))
      .send({ decision: 'reject', note: 'Checked in at the door' })
      .expect(204);
    await request(h.http)
      .post(`/v1/admin/payment-disputes/${forMissed?.id ?? ''}/resolve`)
      .set(...bearer(admin.token))
      .send({ decision: 'refund', note: 'Venue confirms the door was locked' })
      .expect(204);
    await drain();
    expect((await payment(missed, pMissed)).refunds).toEqual([
      expect.objectContaining({ amountPaise: PRICE, reason: 'DISPUTE' }),
    ]);
    expect((await inbox(missed)).map((n) => n.kind)).toContain('payment_dispute_resolved');
    // The payout was rebuilt without the refunded money and is held again only by... nothing open now.
    expect(await payoutOf(plan.id)).toMatchObject({
      status: 'pending',
      paid_seats: 1,
      checked_in_seats: 1,
      net_paise: 44_100,
      withheld_paise: 0,
    });
  });
});

// ---------- transfers ----------

describe('ticket transfers (D-229)', () => {
  it('a free transfer moves the seat and the ticket atomically, with notifications', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host);
    const [seller, buyer] = [await member(h), await member(h)];
    const paid = await buy(seller, plan.id);

    await request(h.http)
      .post(`/v1/events/${plan.id}/ticket-transfers`)
      .set(...bearer(seller.token))
      .set(...idem())
      .send({ toUserId: buyer.id, pricePaise: PRICE + 1 })
      .expect(409);
    const offer = (
      await request(h.http)
        .post(`/v1/events/${plan.id}/ticket-transfers`)
        .set(...bearer(seller.token))
        .set(...idem())
        .send({ toUserId: buyer.id })
        .expect(201)
    ).body as TicketTransfer;
    expect(offer).toMatchObject({ status: 'pending', pricePaise: 0, direction: 'outgoing' });
    const again = await request(h.http)
      .post(`/v1/events/${plan.id}/ticket-transfers`)
      .set(...bearer(seller.token))
      .set(...idem())
      .send({ toUserId: buyer.id })
      .expect(409);
    expect(again.body.error.details.reason).toBe('TRANSFER_PENDING');
    await drain();
    const offered = (await inbox(buyer)).find((n) => n.kind === 'ticket_transfer_offer');
    expect(offered?.url).toBe(`touchgrass://transfers/${offer.id}`);
    const incoming = (
      await request(h.http)
        .get('/v1/ticket-transfers')
        .set(...bearer(buyer.token))
        .expect(200)
    ).body as TicketTransferList;
    expect(incoming.items[0]).toMatchObject({ id: offer.id, direction: 'incoming' });

    const accepted = (
      await request(h.http)
        .post(`/v1/ticket-transfers/${offer.id}/accept`)
        .set(...bearer(buyer.token))
        .set(...idem())
        .expect(201)
    ).body as AcceptTransferResult;
    expect(accepted).toEqual({ kind: 'transferred', eventId: plan.id });
    expect(await rsvpStatus(plan.id, buyer.id)).toBe('going');
    expect(await rsvpStatus(plan.id, seller.id)).toBe('cancelled');
    const { rows } = await h.pool.query<{ holder_user_id: string }>(
      'SELECT holder_user_id FROM payments WHERE id = $1',
      [paid],
    );
    expect(rows[0]?.holder_user_id).toBe(buyer.id);
    // The holder's own QR ticket works; the seller's is gone, and no refund was made.
    await request(h.http)
      .get(`/v1/events/${plan.id}/ticket`)
      .set(...bearer(buyer.token))
      .expect(200);
    await drain();
    expect((await payment(seller, paid)).refunds).toEqual([]);
    expect((await inbox(seller)).map((n) => n.kind)).toContain('ticket_transfer_done');
    // The new holder's cancel refunds the original buyer's payment per the policy.
    const quote = (
      await request(h.http)
        .get(`/v1/events/${plan.id}/refund-quote`)
        .set(...bearer(buyer.token))
        .expect(200)
    ).body as RefundQuote;
    expect(quote.paidPaise).toBe(PRICE);
  });

  it('a resale moves the seat when the payment lands, and pays the seller back that much', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host);
    const [seller, buyer] = [await member(h), await member(h)];
    const original = await buy(seller, plan.id);
    const offer = (
      await request(h.http)
        .post(`/v1/events/${plan.id}/ticket-transfers`)
        .set(...bearer(seller.token))
        .set(...idem())
        .send({ toUserId: buyer.id, pricePaise: 30_000 })
        .expect(201)
    ).body as TicketTransfer;
    const res = (
      await request(h.http)
        .post(`/v1/ticket-transfers/${offer.id}/accept`)
        .set(...bearer(buyer.token))
        .set(...idem())
        .expect(201)
    ).body as AcceptTransferResult;
    if (res.kind !== 'checkout') throw new Error('expected a checkout');
    expect(res.session.amountPaise).toBe(30_000);
    // Nothing moves before the verified payment.
    expect(await rsvpStatus(plan.id, seller.id)).toBe('going');
    await pay(res.session.paymentId);
    expect(await rsvpStatus(plan.id, buyer.id)).toBe('going');
    expect(await rsvpStatus(plan.id, seller.id)).toBe('cancelled');
    expect((await payment(buyer, res.session.paymentId)).kind).toBe('resale');
    await drain();
    expect((await payment(seller, original)).refunds).toEqual([
      expect.objectContaining({ amountPaise: 30_000, reason: 'RESOLD' }),
    ]);
  });

  it('a resale paid after the seller dropped out is refunded to the buyer', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host);
    const [seller, buyer] = [await member(h), await member(h)];
    await buy(seller, plan.id);
    const offer = (
      await request(h.http)
        .post(`/v1/events/${plan.id}/ticket-transfers`)
        .set(...bearer(seller.token))
        .set(...idem())
        .send({ toUserId: buyer.id, pricePaise: 20_000 })
        .expect(201)
    ).body as TicketTransfer;
    const res = (
      await request(h.http)
        .post(`/v1/ticket-transfers/${offer.id}/accept`)
        .set(...bearer(buyer.token))
        .set(...idem())
        .expect(201)
    ).body as AcceptTransferResult;
    if (res.kind !== 'checkout') throw new Error('expected a checkout');
    await request(h.http)
      .delete(`/v1/events/${plan.id}/rsvp`)
      .set(...bearer(seller.token))
      .expect(204);
    await drain();
    await pay(res.session.paymentId);
    expect(await rsvpStatus(plan.id, buyer.id)).toBeNull();
    await drain();
    expect((await payment(buyer, res.session.paymentId)).refunds).toEqual([
      expect.objectContaining({ amountPaise: 20_000, reason: 'TRANSFER_VOID' }),
    ]);
  });

  it('closes when check-in opens, and a declined offer changes nothing', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host);
    const [seller, buyer] = [await member(h), await member(h)];
    await buy(seller, plan.id);
    const offer = (
      await request(h.http)
        .post(`/v1/events/${plan.id}/ticket-transfers`)
        .set(...bearer(seller.token))
        .set(...idem())
        .send({ toUserId: buyer.id })
        .expect(201)
    ).body as TicketTransfer;
    await request(h.http)
      .post(`/v1/ticket-transfers/${offer.id}/decline`)
      .set(...bearer(buyer.token))
      .expect(204);
    await drain();
    expect((await inbox(seller)).map((n) => n.kind)).toContain('ticket_transfer_declined');
    expect(await rsvpStatus(plan.id, seller.id)).toBe('going');
    await shiftEvent(h, plan.id, 10 * 60_000);
    const late = await request(h.http)
      .post(`/v1/events/${plan.id}/ticket-transfers`)
      .set(...bearer(seller.token))
      .set(...idem())
      .send({ toUserId: buyer.id })
      .expect(409);
    expect(late.body.error).toMatchObject({
      code: 'TRANSFER_UNAVAILABLE',
      details: { reason: 'CHECK_IN_OPEN' },
    });
  });
});

// ---------- paid +1 ----------

describe('paid +1 (D-229)', () => {
  it('buys a seat for a friend; the friend claims it and holds the ticket', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host, { capacity: 5 });
    const [buyer, friend] = [await member(h), await member(h)];
    await request(h.http)
      .post(`/v1/events/${plan.id}/plus-one-checkout`)
      .set(...bearer(buyer.token))
      .set(...idem())
      .send({})
      .expect(403);
    await buy(buyer, plan.id);
    const res = (
      await request(h.http)
        .post(`/v1/events/${plan.id}/plus-one-checkout`)
        .set(...bearer(buyer.token))
        .set(...idem())
        .send({})
        .expect(201)
    ).body as PlusOneCheckout;
    expect(res.session.amountPaise).toBe(PRICE);
    const token = res.claimUrl.split('/claim/')[1] ?? '';
    // Not claimable until the payment is verified.
    await request(h.http).get(`/v1/plus-ones/${token}`).expect(404);
    await pay(res.session.paymentId);
    await request(h.http).get(`/v1/plus-ones/${token}`).expect(200);
    const seats = await h.app.get(EventStore).seatCounts(plan.id);
    expect(seats.seats).toBe(3);
    const second = await request(h.http)
      .post(`/v1/events/${plan.id}/plus-one-checkout`)
      .set(...bearer(buyer.token))
      .set(...idem())
      .send({})
      .expect(403);
    expect(second.body.error.details.reason).toBe('ALREADY_HAS_PLUS_ONE');

    await request(h.http)
      .post('/v1/plus-ones/claim')
      .set(...bearer(friend.token))
      .set(...idem())
      .send({ token })
      .expect(200);
    expect(await rsvpStatus(plan.id, friend.id)).toBe('going');
    const ticket = (
      await request(h.http)
        .get(`/v1/events/${plan.id}/plus-one-ticket`)
        .set(...bearer(buyer.token))
        .expect(200)
    ).body as PlusOneTicket;
    expect(ticket).toMatchObject({ status: 'captured', holder: { id: friend.id } });
    await drain();
    expect((await inbox(buyer)).map((n) => n.kind)).toContain('plus_one_ticket_claimed');

    // The holder cancelling refunds the buyer's payment per the policy (full, well before the cut-off).
    await request(h.http)
      .delete(`/v1/events/${plan.id}/rsvp`)
      .set(...bearer(friend.token))
      .expect(204);
    await drain();
    expect((await payment(buyer, res.session.paymentId)).refunds).toEqual([
      expect.objectContaining({ amountPaise: PRICE, reason: 'BEFORE_CUTOFF' }),
    ]);
  });

  it('an unclaimed +1 is refunded when the buyer drops out; a new link replaces the old', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host);
    const buyer = await member(h);
    await buy(buyer, plan.id);
    const res = (
      await request(h.http)
        .post(`/v1/events/${plan.id}/plus-one-checkout`)
        .set(...bearer(buyer.token))
        .set(...idem())
        .send({})
        .expect(201)
    ).body as PlusOneCheckout;
    await pay(res.session.paymentId);
    const oldToken = res.claimUrl.split('/claim/')[1] ?? '';
    const link = await request(h.http)
      .post(`/v1/events/${plan.id}/plus-one-ticket/link`)
      .set(...bearer(buyer.token))
      .expect(201);
    const newToken = (link.body.claimUrl as string).split('/claim/')[1] ?? '';
    await request(h.http).get(`/v1/plus-ones/${oldToken}`).expect(404);
    await request(h.http).get(`/v1/plus-ones/${newToken}`).expect(200);
    await request(h.http)
      .delete(`/v1/events/${plan.id}/rsvp`)
      .set(...bearer(buyer.token))
      .expect(204);
    await drain();
    expect((await payment(buyer, res.session.paymentId)).refunds).toEqual([
      expect.objectContaining({ amountPaise: PRICE, reason: 'BEFORE_CUTOFF' }),
    ]);
    await request(h.http).get(`/v1/plus-ones/${newToken}`).expect(404);
  });
});

// ---------- deposits ----------

describe('refundable deposits on popular free plans (D-229)', () => {
  it('is off by default; with the flag on, popular plans take a deposit returned at check-in', async () => {
    const flags = h.app.get(FeatureFlagsService);
    const host = await verifiedMember(h);
    const plan = await plot(h, host, { capacity: 6 });
    await request(h.http)
      .put(`/v1/events/${plan.id}/deposit`)
      .set(...bearer(host.token))
      .send({ amountPaise: 10_000 })
      .expect(403);
    await flags.set('refundable_deposits', true);
    try {
      await request(h.http)
        .put(`/v1/events/${plan.id}/deposit`)
        .set(...bearer(host.token))
        .send({ amountPaise: 10_000 })
        .expect(200);
      const outsider = await member(h);
      await request(h.http)
        .put(`/v1/events/${plan.id}/deposit`)
        .set(...bearer(outsider.token))
        .send({ amountPaise: 10_000 })
        .expect(403);
      // Host + 3 free pull-ups leaves 2 of 6 spots: the plan is popular now.
      for (let i = 0; i < 3; i += 1) await rsvp(h, await member(h), plan.id).expect(200);
      const [comes, skips] = [await member(h), await member(h)];
      const asked = await rsvp(h, comes, plan.id).expect(403);
      expect(asked.body.error.details).toEqual({ reason: 'DEPOSIT_REQUIRED', amountPaise: 10_000 });

      const deposits: Record<string, string> = {};
      for (const m of [comes, skips]) {
        const res = (
          await request(h.http)
            .post(`/v1/events/${plan.id}/deposit-checkout`)
            .set(...bearer(m.token))
            .set(...idem())
            .send({})
            .expect(201)
        ).body as CheckoutResult;
        if (res.kind !== 'checkout') throw new Error('expected a checkout');
        expect(res.session.amountPaise).toBe(10_000);
        await pay(res.session.paymentId);
        deposits[m.id] = res.session.paymentId;
        expect(await rsvpStatus(plan.id, m.id)).toBe('going');
      }

      // Check-in at the door returns the deposit.
      await shiftEvent(h, plan.id, 10 * 60_000);
      const ticket = await request(h.http)
        .get(`/v1/events/${plan.id}/ticket`)
        .set(...bearer(comes.token))
        .expect(200);
      await request(h.http)
        .post(`/v1/events/${plan.id}/check-in`)
        .set(...bearer(host.token))
        .send({ qr: ticket.body.qr as string })
        .expect(200);
      await drain();
      expect((await payment(comes, deposits[comes.id] ?? '')).refunds).toEqual([
        expect.objectContaining({ amountPaise: 10_000, reason: 'DEPOSIT_RETURNED' }),
      ]);

      // The plan ends: the no-show's deposit is kept.
      await shiftEvent(h, plan.id, -3 * 3_600_000);
      await h.app.get(EventsService).completeEnded();
      await drain();
      expect((await payment(skips, deposits[skips.id] ?? '')).refunds).toEqual([]);
      const { rows } = await h.pool.query<{ deposit_outcome: string }>(
        'SELECT deposit_outcome FROM payments WHERE id = ANY($1) ORDER BY deposit_outcome',
        [[deposits[comes.id], deposits[skips.id]]],
      );
      expect(rows.map((r) => r.deposit_outcome)).toEqual(['forfeited', 'returned']);
      // Deposits are not tickets: no payout for a free plan.
      expect(await h.app.get(PayoutsService).createFor(plan.id)).toBe(true);
      expect(await payoutOf(plan.id)).toMatchObject({ paid_seats: 0, net_paise: 0 });
    } finally {
      await flags.set('refundable_deposits', false);
    }
  });

  it('a late cancel forfeits the deposit; an early one returns it', async () => {
    const flags = h.app.get(FeatureFlagsService);
    await flags.set('refundable_deposits', true);
    try {
      const host = await verifiedMember(h);
      const plan = await plot(h, host, { capacity: 6 });
      await request(h.http)
        .put(`/v1/events/${plan.id}/deposit`)
        .set(...bearer(host.token))
        .send({ amountPaise: 5_000 })
        .expect(200);
      for (let i = 0; i < 3; i += 1) await rsvp(h, await member(h), plan.id).expect(200);
      const [early, late] = [await member(h), await member(h)];
      const ids: string[] = [];
      for (const m of [early, late]) {
        const res = (
          await request(h.http)
            .post(`/v1/events/${plan.id}/deposit-checkout`)
            .set(...bearer(m.token))
            .set(...idem())
            .send({})
            .expect(201)
        ).body as CheckoutResult;
        if (res.kind !== 'checkout') throw new Error('expected a checkout');
        await pay(res.session.paymentId);
        ids.push(res.session.paymentId);
      }
      await request(h.http)
        .delete(`/v1/events/${plan.id}/rsvp`)
        .set(...bearer(early.token))
        .expect(204);
      await shiftEvent(h, plan.id, 60 * 60_000);
      await request(h.http)
        .delete(`/v1/events/${plan.id}/rsvp`)
        .set(...bearer(late.token))
        .expect(204);
      await drain();
      expect((await payment(early, ids[0] ?? '')).refunds).toEqual([
        expect.objectContaining({ amountPaise: 5_000, reason: 'DEPOSIT_RETURNED' }),
      ]);
      expect((await payment(late, ids[1] ?? '')).refunds).toEqual([]);
    } finally {
      await flags.set('refundable_deposits', false);
    }
  });
});
