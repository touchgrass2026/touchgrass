import {
  type AdminEventDetail,
  type AdminEventPage,
  type CheckoutResult,
  type DoorList,
  type EventDetail,
  type Feed,
  haversineMeters,
  type MapResponse,
  type Ticket,
} from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FakePaymentsGateway,
  type SimulatedWebhook,
} from '../src/adapters/payments/fake.payments.js';
import { CheckInReader } from '../src/modules/events/check-in-reader.js';
import { CheckInService } from '../src/modules/events/check-in.service.js';
import { WebhooksService } from '../src/modules/payments/webhooks.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import {
  ADDRESS,
  detail,
  idem,
  outboxFor,
  PLACE,
  plot,
  rsvp,
  shiftEvent,
  SPOT,
  verifiedMember,
} from './event-helpers.js';
import {
  bearer,
  cityAndHood,
  createHarness,
  fromIp,
  type Harness,
  member,
  type Member,
  onboard,
  signIn,
} from './harness.js';

/** Check-in integrity (D-227): hidden spots, rotating tickets, the venue door list and fake-headcount flags. */
let h: Harness;
const gateway = new FakePaymentsGateway();
let admin: Member;
const PRICE = 50_000;

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
});
afterAll(async () => {
  await h.close();
});

// ---------- helpers ----------

const leaks = (body: unknown): boolean => {
  const s = body === undefined ? '' : JSON.stringify(body);
  return (
    s.includes(ADDRESS) ||
    s.includes(PLACE) ||
    s.includes(String(SPOT.lat)) ||
    s.includes(String(SPOT.lng))
  );
};

async function approvedHost(): Promise<Member> {
  const m = await verifiedMember(h);
  const app = await request(h.http)
    .post('/v1/host/applications')
    .set(...bearer(m.token))
    .set(...idem())
    .send({
      about: 'I run a weekend cycling group in Gachibowli.',
      experience: 'Hosted thirty rides for groups of ten to forty.',
      eventIdeas: 'Sunrise rides ending at a partner cafe.',
    })
    .expect(201);
  await request(h.http)
    .post(`/v1/admin/host-applications/${app.body.id as string}/review`)
    .set(...bearer(admin.token))
    .send({ decision: 'approved' })
    .expect(201);
  return m;
}

async function deliver(w: SimulatedWebhook): Promise<void> {
  await request(h.http)
    .post('/v1/webhooks/razorpay')
    .set('content-type', 'application/json')
    .set('x-razorpay-signature', w.signature)
    .set('x-razorpay-event-id', w.eventId)
    .send(w.rawBody)
    .expect(200);
  await h.app.get(WebhooksService).process(w.eventId);
}

const checkout = (m: Member, eventId: string) =>
  request(h.http)
    .post(`/v1/events/${eventId}/checkout`)
    .set(...bearer(m.token))
    .set(...idem())
    .send({});

async function orderOf(paymentId: string): Promise<string> {
  const { rows } = await h.pool.query<{ provider_order_id: string }>(
    'SELECT provider_order_id FROM payments WHERE id = $1',
    [paymentId],
  );
  return rows[0]?.provider_order_id ?? '';
}

/** Starts a checkout (the seat is held) and returns a function that completes the payment. */
async function startCheckout(m: Member, eventId: string): Promise<() => Promise<void>> {
  const res = (await checkout(m, eventId).expect(201)).body as CheckoutResult;
  if (res.kind !== 'checkout') throw new Error('no checkout');
  const order = await orderOf(res.session.paymentId);
  return () => deliver(gateway.simulatePaymentCaptured(order));
}

async function partnerVenue(pin: string): Promise<string> {
  const { cityId } = await cityAndHood(h);
  const { rows } = await h.pool.query<{ id: string }>(
    `INSERT INTO venues (city_id, name, address, location) VALUES ($1, $2, 'Road 36, Jubilee Hills',
      ST_GeogFromText('POINT(78.4075 17.4300)')) RETURNING id`,
    [cityId, `Door Cafe ${String(Date.now())}`],
  );
  const id = rows[0]?.id ?? '';
  await request(h.http)
    .put(`/v1/admin/venues/${id}/partner`)
    .set(...bearer(admin.token))
    .send({ isPartner: true, description: 'Coffee', staffPin: pin })
    .expect(204);
  return id;
}

/** This plan's card in the viewer's feed, paging through (other suites' plans share the area). */
async function feedItem(m: Member, eventId: string): Promise<Feed['items'][number] | undefined> {
  let cursor: string | null = null;
  for (let page = 0; page < 30; page += 1) {
    const body = (
      await request(h.http)
        .get('/v1/discover/feed')
        .query({
          lat: SPOT.lat,
          lng: SPOT.lng,
          radiusKm: 5,
          limit: 30,
          ...(cursor ? { cursor } : {}),
        })
        .set(...bearer(m.token))
        .expect(200)
    ).body as Feed;
    const found = body.items.find((i) => i.id === eventId);
    if (found || !body.nextCursor) return found;
    cursor = body.nextCursor;
  }
  return undefined;
}

const mapPins = async (m: Member): Promise<MapResponse> =>
  (
    await request(h.http)
      .get('/v1/discover/map')
      .query({
        bbox: `${String(SPOT.lng - 0.05)},${String(SPOT.lat - 0.05)},${String(SPOT.lng + 0.05)},${String(SPOT.lat + 0.05)}`,
        zoom: 17,
      })
      .set(...bearer(m.token))
      .expect(200)
  ).body as MapResponse;

const ticketOf = async (m: Member, eventId: string, query: Record<string, number> = {}) =>
  (
    await request(h.http)
      .get(`/v1/events/${eventId}/ticket`)
      .query(query)
      .set(...bearer(m.token))
      .expect(200)
  ).body as Ticket;

const hostCheckIn = (host: Member, eventId: string, body: Record<string, unknown>) =>
  request(h.http)
    .post(`/v1/events/${eventId}/check-in`)
    .set(...bearer(host.token))
    .send(body);

// ---------- 1. hidden spots ----------

describe('paid plans hide the exact spot until you have paid (D-227)', () => {
  it('every surface shows only the area; a held checkout is not enough; paying reveals it', async () => {
    const host = await approvedHost();
    const [buyer, outsider] = [await member(h), await member(h)];
    const e = await plot(h, host, { pricePaise: PRICE });
    expect(e.location.kind).toBe('exact'); // hosts always know
    expect(e.spotForAttendees).toBe(false);

    const outside = (await detail(h, outsider, e.id).expect(200)).body as EventDetail;
    expect(outside.location).toMatchObject({
      kind: 'approximate',
      hiddenBy: 'paid',
      radiusMeters: 2000,
      neighbourhoodName: 'Gachibowli',
    });
    const center = outside.location.kind === 'approximate' ? outside.location.center : SPOT;
    expect(haversineMeters(center, SPOT)).toBeGreaterThanOrEqual(1000);
    expect(haversineMeters(center, SPOT)).toBeLessThanOrEqual(2000);
    // The category (venue type) still shows.
    expect(outside.category).not.toBeNull();

    const item = await feedItem(outsider, e.id);
    expect(item?.location).toMatchObject({ kind: 'approximate', hiddenBy: 'paid' });
    const pin = (await mapPins(outsider)).pins.find((p) => p.id === e.id);
    expect(pin).toMatchObject({ radiusMeters: 2000, hiddenBy: 'paid', center });

    const share = (await request(h.http).get(`/v1/public/events/${e.slug}`).expect(200)).body;
    expect(share).toMatchObject({ access: 'full', spotHidden: 'paid', areaName: 'Gachibowli' });

    const pay = await startCheckout(buyer, e.id);
    const holding = (await detail(h, buyer, e.id).expect(200)).body as EventDetail;
    expect(holding.viewer.rsvp).toBe('held');
    expect(holding.location).toMatchObject({ kind: 'approximate', hiddenBy: 'paid' });

    const surfaces = [
      outside,
      holding,
      share,
      // Seeded plans share the feed and map; only this plan's card and pin are checked.
      await feedItem(outsider, e.id),
      (await mapPins(outsider)).pins.find((p) => p.id === e.id),
      (await mapPins(buyer)).pins.find((p) => p.id === e.id),
      (
        await request(h.http)
          .get(`/v1/events/by-slug/${e.slug}`)
          .set(...bearer(outsider.token))
      ).body,
      (
        await request(h.http)
          .get('/v1/events/mine')
          .set(...bearer(buyer.token))
      ).body,
    ];
    for (const [i, s] of surfaces.entries()) expect([i, leaks(s)]).toEqual([i, false]);

    await pay();
    const paid = (await detail(h, buyer, e.id).expect(200)).body as EventDetail;
    expect(paid.viewer.rsvp).toBe('going');
    expect(paid.location).toMatchObject({ kind: 'exact', address: ADDRESS, placeName: PLACE });
    // Still hidden from everyone else, and the map never moves to the spot.
    expect(leaks((await detail(h, outsider, e.id)).body)).toBe(false);
    expect(leaks((await mapPins(buyer)).pins.find((p) => p.id === e.id))).toBe(false);
  });

  it('turning a free plan paid fuzzes its public centre', async () => {
    const host = await approvedHost();
    const outsider = await member(h);
    const e = await plot(h, host);
    expect(((await detail(h, outsider, e.id)).body as EventDetail).location.kind).toBe('exact');
    await request(h.http)
      .patch(`/v1/events/${e.id}`)
      .set(...bearer(host.token))
      .send({ pricePaise: PRICE })
      .expect(200);
    const after = (await detail(h, outsider, e.id)).body as EventDetail;
    expect(after.location).toMatchObject({ kind: 'approximate', hiddenBy: 'paid' });
    expect(leaks(after)).toBe(false);
    expect(leaks((await mapPins(outsider)).pins.find((p) => p.id === e.id))).toBe(false);
  });
});

describe('attendees-only spots (D-227)', () => {
  it('hosts can keep a free plan’s spot for people pulling up, and switch it back', async () => {
    const host = await verifiedMember(h);
    const [going, outsider] = [await member(h), await member(h)];
    const e = await plot(h, host, { spotForAttendees: true });
    expect(e.spotForAttendees).toBe(true);
    const before = (await detail(h, going, e.id)).body as EventDetail;
    expect(before.location).toMatchObject({ kind: 'approximate', hiddenBy: 'attendees' });
    expect(leaks(before)).toBe(false);
    expect((await request(h.http).get(`/v1/public/events/${e.slug}`)).body).toMatchObject({
      spotHidden: 'attendees',
    });
    await rsvp(h, going, e.id).expect(200);
    expect(((await detail(h, going, e.id)).body as EventDetail).location).toMatchObject({
      kind: 'exact',
      address: ADDRESS,
    });
    expect(leaks((await detail(h, outsider, e.id)).body)).toBe(false);
    await request(h.http)
      .patch(`/v1/events/${e.id}`)
      .set(...bearer(host.token))
      .send({ spotForAttendees: false })
      .expect(200);
    expect(((await detail(h, outsider, e.id)).body as EventDetail).location).toMatchObject({
      kind: 'exact',
      address: ADDRESS,
    });
  });

  it('women-only and invite-only plans keep the spot for attendees by default', async () => {
    const host = await verifiedMember(h); // the default test persona is a verified woman
    const woman = await verifiedMember(h);
    const wo = await plot(h, host, { visibility: 'women_only' });
    expect(wo.spotForAttendees).toBe(true);
    expect(((await detail(h, woman, wo.id)).body as EventDetail).location).toMatchObject({
      kind: 'approximate',
      hiddenBy: 'attendees',
    });
    const open = await plot(h, host, { visibility: 'women_only', spotForAttendees: false });
    expect(((await detail(h, woman, open.id)).body as EventDetail).location.kind).toBe('exact');
    const secret = await plot(h, host, { visibility: 'invite_only' });
    expect(secret.spotForAttendees).toBe(true);
  });
});

// ---------- 2. rotating tickets ----------

describe('rotating, account-bound check-in tickets (D-227)', () => {
  it('scans the current code once; refuses expired, static, forged and foreign tickets', async () => {
    const host = await verifiedMember(h);
    const [a, b, c] = [await member(h), await member(h), await member(h)];
    const e = await plot(h, host);
    const other = await plot(h, host);
    for (const m of [a, b, c]) await rsvp(h, m, e.id).expect(200);
    await rsvp(h, a, other.id).expect(200);
    await shiftEvent(h, e.id, -5 * 60_000);
    await shiftEvent(h, other.id, -5 * 60_000);

    const ticket = await ticketOf(a, e.id);
    expect(ticket.qr.startsWith('tg2.')).toBe(true);
    expect(ticket.code).toMatch(/^\d{6}$/);
    expect(ticket.rotateEveryMs).toBe(30_000);
    const rotates = new Date(ticket.rotatesAt).getTime() - Date.now();
    expect(rotates).toBeGreaterThan(0);
    expect(rotates).toBeLessThanOrEqual(30_000);

    const svc = h.app.get(CheckInService);
    const old = svc.ticketAt(e.id, a.id, new Date(Date.now() - 90_000));
    const expired = await hostCheckIn(host, e.id, { qr: old.qr }).expect(409);
    expect(expired.body.error).toMatchObject({
      code: 'TICKET_EXPIRED',
      details: { reason: 'TICKET_EXPIRED' },
    });
    const staticTicket = `tg1.${e.id}.${a.id}.${'a'.repeat(32)}`;
    expect((await hostCheckIn(host, e.id, { qr: staticTicket }).expect(409)).body.error.code).toBe(
      'TICKET_EXPIRED',
    );
    const forged = ticket.qr.replace(a.id, b.id);
    expect((await hostCheckIn(host, e.id, { qr: forged }).expect(409)).body.error.details).toEqual({
      reason: 'INVALID_TICKET',
    });
    const foreign = await ticketOf(a, other.id);
    expect(
      (await hostCheckIn(host, e.id, { qr: foreign.qr }).expect(409)).body.error.details,
    ).toEqual({ reason: 'WRONG_EVENT' });
    // Only hosts scan.
    await hostCheckIn(b, e.id, { qr: ticket.qr }).expect(403);

    const ok = await hostCheckIn(host, e.id, { qr: ticket.qr }).expect(200);
    expect(ok.body).toMatchObject({ userId: a.id, method: 'qr' });
    const again = await hostCheckIn(host, e.id, { qr: ticket.qr }).expect(200);
    expect(again.body.checkedInAt).toBe(ok.body.checkedInAt);

    // The short code works the same way, and only for someone holding a seat here.
    const code = svc.ticketAt(e.id, b.id, new Date()).code;
    expect((await hostCheckIn(host, e.id, { code }).expect(200)).body).toMatchObject({
      userId: b.id,
      method: 'code',
    });
    const outsider = await member(h);
    const strangerCode = svc.ticketAt(e.id, outsider.id, new Date()).code;
    const cCode = svc.ticketAt(e.id, c.id, new Date()).code;
    if (strangerCode !== cCode)
      expect(
        (await hostCheckIn(host, e.id, { code: strangerCode }).expect(409)).body.error.details,
      ).toEqual({ reason: 'CODE_UNKNOWN' });

    expect(await outboxFor(h, e.id, 'rsvp.checked_in')).toEqual([
      { eventId: e.id, userId: a.id, method: 'qr', onTime: true },
      { eventId: e.id, userId: b.id, method: 'code', onTime: true },
    ]);
    const { rows } = await h.pool.query<{ actor: string; actor_user_id: string }>(
      'SELECT actor, actor_user_id FROM check_in_log WHERE event_id = $1',
      [e.id],
    );
    expect(rows).toEqual([
      { actor: 'host', actor_user_id: host.id },
      { actor: 'host', actor_user_id: host.id },
    ]);
  });

  it('tickets need a seat, and codes only scan inside the check-in window', async () => {
    const host = await verifiedMember(h);
    const a = await member(h);
    const e = await plot(h, host);
    await request(h.http)
      .get(`/v1/events/${e.id}/ticket`)
      .set(...bearer(a.token))
      .expect(403);
    await rsvp(h, a, e.id).expect(200);
    const t = await ticketOf(a, e.id);
    expect(
      (await hostCheckIn(host, e.id, { code: t.code }).expect(409)).body.error.details,
    ).toEqual({ reason: 'WINDOW_CLOSED' });
  });
});

// ---------- 3. the venue door list ----------

describe('venue door list (D-227)', () => {
  it('staff sign in with the PIN, see today’s confirmed people and check them in', async () => {
    const venueId = await partnerVenue('2468');
    const otherVenue = await partnerVenue('1357');
    const host = await approvedHost();
    const [a, b, buyer] = [await member(h), await member(h), await member(h)];
    const free = await plot(h, host, { where: { venueId }, title: 'Board games night' });
    const paid = await plot(h, host, {
      where: { venueId },
      title: 'Coffee tasting',
      pricePaise: PRICE,
    });
    const elsewhere = await plot(h, host, { where: { venueId: otherVenue } });
    await rsvp(h, a, free.id).expect(200);
    await rsvp(h, b, free.id).expect(200);
    await rsvp(h, a, elsewhere.id).expect(200);
    await (
      await startCheckout(buyer, paid.id)
    )();
    for (const id of [free.id, paid.id, elsewhere.id]) await shiftEvent(h, id, -5 * 60_000);

    const signIn = (pin: string, id = venueId) =>
      request(h.http)
        .post('/v1/door/sessions')
        .set(...fromIp())
        .send({ venueId: id, pin });
    expect((await signIn('0000').expect(403)).body.error.details).toEqual({ reason: 'WRONG_PIN' });
    const session = (await signIn('2468').expect(201)).body as { token: string; venueName: string };
    expect(session.venueName).toMatch(/^Door Cafe/);

    await request(h.http)
      .get('/v1/door/list')
      .set(...fromIp())
      .expect(401);
    await request(h.http)
      .get('/v1/door/list')
      .set(...fromIp())
      .set(
        'x-door-token',
        `${session.token.slice(0, -1)}${session.token.endsWith('0') ? '1' : '0'}`,
      )
      .expect(401);
    const list = async (): Promise<DoorList> =>
      (
        await request(h.http)
          .get('/v1/door/list')
          .set(...fromIp())
          .set('x-door-token', session.token)
          .expect(200)
      ).body as DoorList;
    const first = await list();
    const freePlan = first.plans.find((p) => p.eventId === free.id);
    const paidPlan = first.plans.find((p) => p.eventId === paid.id);
    expect(first.plans.find((p) => p.eventId === elsewhere.id)).toBeUndefined();
    // The host holds a seat at their own plan, so three people are confirmed.
    expect(freePlan).toMatchObject({ paid: false, confirmed: 3, checkedIn: 0, checkInOpen: true });
    expect(paidPlan).toMatchObject({ paid: true, confirmed: 2, checkedIn: 0 });
    for (const p of freePlan?.people ?? []) {
      expect(p.firstName).not.toContain(' ');
      expect(Object.keys(p).sort()).toEqual([
        'checkedIn',
        'checkedInAt',
        'firstName',
        'photoUrl',
        'userId',
      ]);
    }
    // Staff never see phone numbers.
    const raw = JSON.stringify(first);
    for (const m of [a, b, buyer, host]) expect(raw).not.toContain(m.phone.slice(-8));

    const svc = h.app.get(CheckInService);
    const checkIn = (ticket: string, token = session.token) =>
      request(h.http)
        .post('/v1/door/check-in')
        .set(...fromIp())
        .set('x-door-token', token)
        .send({ ticket });
    const byCode = await checkIn(svc.ticketAt(free.id, a.id, new Date()).code).expect(200);
    expect(byCode.body).toMatchObject({ eventId: free.id, userId: a.id, already: false });
    const byQr = await checkIn(svc.ticketAt(paid.id, buyer.id, new Date()).qr).expect(200);
    expect(byQr.body).toMatchObject({ eventId: paid.id, userId: buyer.id, already: false });
    expect(
      (await checkIn(svc.ticketAt(free.id, a.id, new Date()).qr).expect(200)).body.already,
    ).toBe(true);
    // A ticket for a plan at another venue is not this door's to check.
    expect(
      (await checkIn(svc.ticketAt(elsewhere.id, a.id, new Date()).qr).expect(409)).body.error
        .details,
    ).toEqual({ reason: 'WRONG_EVENT' });
    // A screenshot from a minute ago has expired.
    const stale = svc.ticketAt(free.id, b.id, new Date(Date.now() - 90_000)).qr;
    expect((await checkIn(stale).expect(409)).body.error.code).toBe('TICKET_EXPIRED');
    // The other venue's staff cannot check anyone in here.
    const otherSession = (await signIn('1357', otherVenue).expect(201)).body as { token: string };
    expect(
      (await checkIn(svc.ticketAt(free.id, b.id, new Date()).qr, otherSession.token).expect(409))
        .body.error.details,
    ).toEqual({ reason: 'WRONG_EVENT' });

    const after = await list();
    expect(after.plans.find((p) => p.eventId === free.id)).toMatchObject({ checkedIn: 1 });
    expect(after.plans.find((p) => p.eventId === paid.id)).toMatchObject({ checkedIn: 1 });
    const person = after.plans
      .find((p) => p.eventId === free.id)
      ?.people.find((p) => p.userId === a.id);
    expect(person).toMatchObject({ checkedIn: true });
    expect(person?.checkedInAt).not.toBeNull();

    // Staff check-ins are on the audit trail with the venue.
    const { rows } = await h.pool.query<{ actor: string; venue_id: string; method: string }>(
      'SELECT actor, venue_id, method FROM check_in_log WHERE event_id = ANY($1) ORDER BY created_at',
      [[free.id, paid.id]],
    );
    expect(rows).toEqual([
      { actor: 'venue_staff', venue_id: venueId, method: 'code' },
      { actor: 'venue_staff', venue_id: venueId, method: 'qr' },
    ]);
  });
});

// ---------- 4. fake-headcount flags ----------

describe('fake-headcount flags (D-227)', () => {
  it('flags shared phones and far-away check-ins for admin review; payouts can read them', async () => {
    const host = await verifiedMember(h);
    const people = await Promise.all([1, 2, 3, 4, 5].map(() => member(h)));
    const e = await plot(h, host);
    for (const m of people) await rsvp(h, m, e.id).expect(200);
    await shiftEvent(h, e.id, -5 * 60_000);
    const [p1, p2, p3, p4, p5] = people as [Member, Member, Member, Member, Member];

    // Three accounts used from one phone.
    await h.pool.query(`UPDATE user_sessions SET device_id = 'one-phone' WHERE user_id = ANY($1)`, [
      [p1.id, p2.id, p3.id],
    ]);
    for (const m of [p1, p2, p3]) {
      const t = await ticketOf(m, e.id, { lat: SPOT.lat, lng: SPOT.lng });
      await hostCheckIn(host, e.id, { qr: t.qr }).expect(200);
    }
    const reader = h.app.get(CheckInReader);
    expect(await reader.flags(e.id)).toEqual([
      expect.objectContaining({ kind: 'shared_device', count: 3, reviewedAt: null }),
    ]);

    // Two codes scanned from far away.
    for (const m of [p4, p5]) {
      const t = await ticketOf(m, e.id, { lat: SPOT.lat + 0.05, lng: SPOT.lng });
      await hostCheckIn(host, e.id, { qr: t.qr }).expect(200);
    }
    expect((await reader.flags(e.id)).map((f) => [f.kind, f.count])).toEqual([
      ['far_from_spot', 2],
      ['shared_device', 3],
    ]);
    expect(await reader.checkedInCount(e.id)).toBe(5);
    expect(await reader.hasOpenFlags(e.id)).toBe(true);
    // Only coarse locations are stored.
    const { rows: coarse } = await h.pool.query<{ lat: number }>(
      'SELECT ST_Y(coarse_location::geometry) AS lat FROM check_in_log WHERE event_id = $1 AND user_id = $2',
      [e.id, p1.id],
    );
    expect(coarse[0]?.lat).toBe(Math.round(SPOT.lat * 1000) / 1000);

    // Admins see and review the flags.
    const flagged = (
      await request(h.http)
        .get('/v1/admin/events')
        .query({ flagged: 'true', limit: 50 })
        .set(...bearer(admin.token))
        .expect(200)
    ).body as AdminEventPage;
    expect(flagged.items.find((i) => i.id === e.id)?.checkInFlags).toEqual([
      'far_from_spot',
      'shared_device',
    ]);
    expect(flagged.items.every((i) => i.checkInFlags.length > 0)).toBe(true);
    const someone = await member(h);
    await request(h.http)
      .post(`/v1/admin/events/${e.id}/check-in-flags/review`)
      .set(...bearer(someone.token))
      .expect(403);
    const reviewed = (
      await request(h.http)
        .post(`/v1/admin/events/${e.id}/check-in-flags/review`)
        .set(...bearer(admin.token))
        .expect(200)
    ).body as AdminEventDetail;
    expect(reviewed.checkedIn).toBe(5);
    expect(reviewed.flags.every((f) => f.reviewedAt !== null)).toBe(true);
    expect(await reader.hasOpenFlags(e.id)).toBe(false);
    const { rows: audit } = await h.pool.query<{ action: string }>(
      `SELECT action FROM admin_actions WHERE target_id = $1 AND action = 'events.check_in_flags.review'`,
      [e.id],
    );
    expect(audit).toHaveLength(1);
    const unflagged = (
      await request(h.http)
        .get('/v1/admin/events')
        .query({ flagged: 'true', limit: 50 })
        .set(...bearer(admin.token))
        .expect(200)
    ).body as AdminEventPage;
    expect(unflagged.items.find((i) => i.id === e.id)).toBeUndefined();

    // Check-ins are personal data: exported with the account.
    const exported = await request(h.http)
      .get('/v1/me/export')
      .set(...bearer(p1.token))
      .expect(200);
    expect(JSON.stringify(exported.body)).toContain(`"checkIns":[{"eventId":"${e.id}"`);
  });
});
