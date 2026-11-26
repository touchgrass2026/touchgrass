import type {
  ConversationSummary,
  EventDetail,
  HostConduct,
  HostStatus,
  Message,
  MessagePage,
  MyReferrals,
} from '@touchgrass/shared';
import QRCode from 'qrcode';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountService } from '../src/modules/account/account.service.js';
import { HostingHandlers } from '../src/modules/hosting/hosting.handlers.js';
import { AppSettingsService } from '../src/modules/platform/app-settings.service.js';
import { ReferralsHandlers } from '../src/modules/referrals/referrals.handlers.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { MediaProcessor } from '../src/modules/media/media.processor.js';
import { DomainEventBus } from '../src/worker/domain-event-bus.js';
import { detail, idem, planBody, plot, rsvp, shiftEvent, verifiedMember } from './event-helpers.js';
import {
  befriend,
  bearer,
  createHarness,
  fromIp,
  type Harness,
  member,
  type Member,
  onboard,
  signIn,
} from './harness.js';

/** Keeping money on TouchGrass (D-228): payment holds, "asked to pay" strikes, referral timing, one account per phone. */
let h: Harness;
let moderator: Member;
const H = 3_600_000;

beforeAll(async () => {
  h = await createHarness();
  const s = await signIn(h);
  await onboard(h, s.accessToken);
  await h.app.get(UsersService).grantRole(s.user.id, 'moderator', null);
  const refreshed = await request(h.http)
    .post('/v1/auth/refresh')
    .set(...fromIp())
    .send({ refreshToken: s.refreshToken })
    .expect(200);
  moderator = { id: s.user.id, token: refreshed.body.accessToken as string, phone: s.phone };
});
afterAll(async () => {
  await h.close();
});

const get = (m: Member, path: string) =>
  request(h.http)
    .get(path)
    .set(...bearer(m.token));
const post = (m: Member, path: string, body: object = {}) =>
  request(h.http)
    .post(path)
    .set(...bearer(m.token))
    .set(...idem())
    .send(body);
let seq = 0;
const send = (m: Member, conversationId: string, body: string) =>
  request(h.http)
    .post(`/v1/chats/${conversationId}/messages`)
    .set(...bearer(m.token))
    .send({ clientId: `pay${String(Date.now())}${String((seq += 1))}`, body });

async function openItem(
  targetType: string,
  targetId: string,
): Promise<{
  id: string;
  details: Record<string, unknown>;
}> {
  const { rows } = await h.pool.query<{ id: string; details: Record<string, unknown> }>(
    `SELECT id, details FROM moderation_items WHERE target_type = $1 AND target_id = $2 AND status = 'open'
     ORDER BY created_at DESC LIMIT 1`,
    [targetType, targetId],
  );
  const row = rows[0];
  if (!row) throw new Error(`no open item for ${targetType} ${targetId}`);
  return row;
}

/** Replays outbox rows of these types for an aggregate through the worker handlers. */
async function drain(types: string[], aggregateId: string): Promise<void> {
  const bus = new DomainEventBus();
  h.app.get(HostingHandlers).registerOn(bus);
  h.app.get(ReferralsHandlers).registerOn(bus);
  const { rows } = await h.pool.query<{
    id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    'SELECT * FROM outbox_events WHERE aggregate_id = $1 AND event_type = ANY($2) ORDER BY created_at',
    [aggregateId, types],
  );
  for (const r of rows)
    await bus.dispatch({
      eventId: r.id,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      type: r.event_type,
      payload: r.payload,
      occurredAt: r.created_at.toISOString(),
    });
}

async function planChat(
  host: Member,
  guests: Member[],
): Promise<{ plan: EventDetail; chat: string }> {
  const plan = await plot(h, host);
  for (const g of guests) await rsvp(h, g, plan.id).expect(200);
  await shiftEvent(h, plan.id, 5 * H);
  const conv = (await get(host, `/v1/events/${plan.id}/chat`).expect(200))
    .body as ConversationSummary;
  return { plan, chat: conv.id };
}

describe('off-platform payment holds (D-228)', () => {
  it('a plan asking for UPI is held with the reason; the author sees why, nobody else sees it', async () => {
    const host = await verifiedMember(h);
    const other = await member(h);
    const res = await post(
      host,
      '/v1/events',
      await planBody(h, { description: 'Entry 100, GPay rahul.k@okaxis before Sunday' }),
    ).expect(201);
    const plan = res.body as EventDetail;
    expect(plan).toMatchObject({ held: true, heldReason: 'payment' });
    await detail(h, other, plan.id).expect(404);
    const item = await openItem('event', plan.id);
    expect(item.details.reasons).toEqual(['payment']);
    expect(item.details.matches).toEqual(expect.arrayContaining(['rahul.k@okaxis']));

    // Phone numbers in plan details are held too, with their own reason.
    const call = await post(
      host,
      '/v1/events',
      await planBody(h, { description: 'Lost? Call 98765 43210' }),
    ).expect(201);
    expect(call.body).toMatchObject({ held: true, heldReason: 'contact' });

    // A clean plan is not held; an edit that adds a cash ask is.
    const clean = await plot(h, host, { description: 'Bring water. ₹0, all free.' });
    expect(clean).toMatchObject({ held: false, heldReason: null });
    await request(h.http)
      .patch(`/v1/events/${clean.id}`)
      .set(...bearer(host.token))
      .send({ description: 'Small change: cash at the door, 200 each' })
      .expect(200);
    expect((await detail(h, host, clean.id).expect(200)).body).toMatchObject({
      held: true,
      heldReason: 'payment',
    });
    await detail(h, other, clean.id).expect(404);
  });

  it('plan group chats hold payment asks, allow phone numbers; direct messages are never held for it', async () => {
    const host = await verifiedMember(h);
    const guest = await member(h);
    const { chat } = await planChat(host, [guest]);

    const ask = (await send(host, chat, 'gpay kar do 200, priya@ybl').expect(201)).body as Message;
    expect(ask).toMatchObject({ held: true, heldReason: 'payment' });
    const phone = (await send(host, chat, 'Lost? call me on 9876543210').expect(201))
      .body as Message;
    expect(phone).toMatchObject({ held: false, heldReason: null });
    const theirs = (await get(guest, `/v1/chats/${chat}/messages`).expect(200)).body as MessagePage;
    expect(theirs.items.map((m) => m.id)).toEqual(expect.arrayContaining([phone.id]));
    expect(theirs.items.map((m) => m.id)).not.toContain(ask.id);
    const mine = (await get(host, `/v1/chats/${chat}/messages`).expect(200)).body as MessagePage;
    expect(mine.items.find((m) => m.id === ask.id)).toMatchObject({
      held: true,
      heldReason: 'payment',
    });
    expect((await openItem('message', ask.id)).details.reasons).toEqual(['payment']);

    // Friends settle up however they like in direct messages.
    await befriend(h, host, guest);
    const dm = (
      await request(h.http)
        .post('/v1/chats/direct')
        .set(...bearer(host.token))
        .send({ userId: guest.id })
    ).body as ConversationSummary;
    const settle = (await send(host, dm.id, 'gpay me 200 for the cab, priya@ybl').expect(201))
      .body as Message;
    expect(settle).toMatchObject({ held: false, heldReason: null });
  });
});

/** A photo with a QR code in the middle (what a host would screenshot from their payment app). */
async function qrPhoto(payload: string): Promise<Buffer> {
  const qr = await QRCode.toBuffer(payload, { type: 'png', width: 500, margin: 4 });
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: '#e8e2d0' } })
    .composite([{ input: qr, gravity: 'center' }])
    .jpeg()
    .toBuffer();
}

async function upload(m: Member, purpose: 'chat' | 'event_cover', bytes: Buffer): Promise<string> {
  const created = await post(m, '/v1/media/uploads', {
    purpose,
    contentType: 'image/jpeg',
    sizeBytes: bytes.length,
  }).expect(201);
  const assetId = created.body.assetId as string;
  h.storage.simulateUpload(created.body.upload.fields.key as string, bytes, 'image/jpeg');
  await post(m, `/v1/media/${assetId}/complete`).expect(200);
  expect(await h.app.get(MediaProcessor).process(assetId)).toBe('ready');
  return assetId;
}

describe('payment QR codes (D-228)', () => {
  it('a UPI QR as a plan cover or in a plan chat is held; other QR codes and friends’ chats are not', async () => {
    const host = await verifiedMember(h);
    const guest = await member(h);
    const upi = await qrPhoto('upi://pay?pa=rahul.k@okaxis&pn=Rahul&am=300&cu=INR');

    const cover = await upload(host, 'event_cover', upi);
    const held = await post(host, '/v1/events', await planBody(h, { coverMediaId: cover })).expect(
      201,
    );
    expect(held.body).toMatchObject({ held: true, heldReason: 'payment' });
    expect((await openItem('event', held.body.id as string)).details.reasons).toEqual(['payment']);

    const site = await upload(host, 'event_cover', await qrPhoto('https://example.org/menu'));
    expect(
      (await post(host, '/v1/events', await planBody(h, { coverMediaId: site })).expect(201)).body,
    ).toMatchObject({ held: false });

    const { chat } = await planChat(host, [guest]);
    const photo = await upload(host, 'chat', upi);
    const msg = (
      await request(h.http)
        .post(`/v1/chats/${chat}/messages`)
        .set(...bearer(host.token))
        .send({ clientId: `qr${String(Date.now())}`, kind: 'image', mediaId: photo })
        .expect(201)
    ).body as Message;
    expect(msg).toMatchObject({ held: true, heldReason: 'payment' });

    await befriend(h, host, guest);
    const dm = (
      await request(h.http)
        .post('/v1/chats/direct')
        .set(...bearer(host.token))
        .send({ userId: guest.id })
    ).body as ConversationSummary;
    const again = await upload(host, 'chat', upi);
    const friendly = (
      await request(h.http)
        .post(`/v1/chats/${dm.id}/messages`)
        .set(...bearer(host.token))
        .send({ clientId: `qrdm${String(Date.now())}`, kind: 'image', mediaId: again })
        .expect(201)
    ).body as Message;
    expect(friendly).toMatchObject({ held: false, heldReason: null });
  });
});

describe('"Asked me to pay" reports and strikes (D-228)', () => {
  it('confirmed reports are strikes; two remove hosting until an admin gives it back', async () => {
    const host = await verifiedMember(h);
    const reporter = await member(h);
    const conduct = async (): Promise<HostConduct> =>
      (await get(host, '/v1/host/conduct').expect(200)).body as HostConduct;
    expect(await conduct()).toMatchObject({ strikes: 0, strikeLimit: 2, hostingRevoked: false });

    const strike = async (): Promise<void> => {
      const plan = await plot(h, host);
      await rsvp(h, reporter, plan.id).expect(200);
      await post(reporter, '/v1/reports', {
        targetType: 'event',
        targetId: plan.id,
        category: 'asked_to_pay',
        details: 'Host asked for 300 on GPay at the gate',
      }).expect(201);
      const item = await openItem('event', plan.id);
      expect(item.details.lastCategory).toBe('asked_to_pay');
      await post(moderator, `/v1/admin/moderation/items/${item.id}/resolve`, {
        outcome: 'remove',
      }).expect(200);
      await drain(['moderation.payment_strike'], host.id);
    };

    await strike();
    expect(await conduct()).toMatchObject({ strikes: 1, hostingRevoked: false });
    const { rows: sanctions } = await h.pool.query<{ kind: string; code: string }>(
      'SELECT kind, code FROM user_sanctions WHERE user_id = $1',
      [host.id],
    );
    expect(sanctions).toEqual([{ kind: 'warn', code: 'off_platform_payment' }]);
    const { rows: pushes } = await h.pool.query<{ kind: string }>(
      'SELECT kind FROM notifications WHERE user_id = $1 ORDER BY created_at',
      [host.id],
    );
    expect(pushes.map((p) => p.kind)).toContain('payment_strike');

    // A dismissed report is not a strike.
    const fine = await plot(h, host);
    await rsvp(h, reporter, fine.id).expect(200);
    await post(reporter, '/v1/reports', {
      targetType: 'event',
      targetId: fine.id,
      category: 'asked_to_pay',
    }).expect(201);
    await post(
      moderator,
      `/v1/admin/moderation/items/${(await openItem('event', fine.id)).id}/resolve`,
      { outcome: 'dismiss' },
    ).expect(200);
    expect((await conduct()).strikes).toBe(1);

    await strike();
    expect(await conduct()).toMatchObject({ strikes: 2, hostingRevoked: true });
    const blocked = await post(host, '/v1/events', await planBody(h)).expect(403);
    expect(blocked.body.error).toMatchObject({
      code: 'HOSTING_REVOKED',
      details: { reason: 'PAYMENT_STRIKES' },
    });
    expect(((await get(host, '/v1/host/status').expect(200)).body as HostStatus).canHostFree).toBe(
      false,
    );

    // Only staff can give it back, and only once.
    await post(reporter, `/v1/admin/hosting/${host.id}/reinstate`, { note: 'Appeal' }).expect(403);
    expect(
      (
        await post(moderator, `/v1/admin/hosting/${host.id}/reinstate`, {
          note: 'Appeal accepted',
        }).expect(201)
      ).body,
    ).toMatchObject({ hostingRevoked: false, strikes: 2 });
    await post(moderator, `/v1/admin/hosting/${host.id}/reinstate`, { note: 'Again' }).expect(409);
    await plot(h, host);
  });

  it('money reasons fit plans and people, not stories', async () => {
    const host = await verifiedMember(h);
    const reporter = await member(h);
    const plan = await plot(h, host);
    await rsvp(h, reporter, plan.id).expect(200);
    await post(reporter, '/v1/reports', {
      targetType: 'user',
      targetId: host.id,
      category: 'asked_to_pay_outside',
    }).expect(201);
    const bad = await post(reporter, '/v1/reports', {
      targetType: 'story',
      targetId: plan.id,
      category: 'asked_to_pay',
    }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('hosts agree to "No payments outside TouchGrass" once', async () => {
    const host = await verifiedMember(h);
    expect(
      ((await get(host, '/v1/host/conduct').expect(200)).body as HostConduct).rulesAcknowledged,
    ).toBe(false);
    const first = (
      await post(host, '/v1/host/rules/ack', { rule: 'no_off_platform_payments' }).expect(201)
    ).body as HostConduct;
    expect(first.rulesAcknowledged).toBe(true);
    const again = (
      await post(host, '/v1/host/rules/ack', { rule: 'no_off_platform_payments' }).expect(201)
    ).body as HostConduct;
    expect(again.acknowledgedAt).toBe(first.acknowledgedAt);
    await post(host, '/v1/host/rules/ack', { rule: 'anything' }).expect(400);
  });
});

/** Marks someone checked in and runs the worker side, as the check-in service would. */
async function checkIn(m: Member, eventId: string): Promise<void> {
  await rsvp(h, m, eventId).expect(200);
  await h.pool.query(
    "UPDATE rsvps SET status = 'checked_in', checked_in_at = now(), check_in_method = 'qr' WHERE event_id = $1 AND user_id = $2",
    [eventId, m.id],
  );
  await h.pool.query(
    `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload)
     VALUES (uuid_v7(), 'event', $1, 'rsvp.checked_in', $2::jsonb)`,
    [eventId, JSON.stringify({ eventId, userId: m.id, method: 'qr', onTime: true })],
  );
  await drain(['rsvp.checked_in'], eventId);
}

const referralsOf = async (m: Member): Promise<MyReferrals> =>
  (await get(m, '/v1/me/referrals').expect(200)).body as MyReferrals;

async function purge(m: Member): Promise<void> {
  await post(m, '/v1/me/deletion', { confirm: 'DELETE' }).expect(202);
  await h.pool.query(
    "UPDATE users SET deletion_requested_at = now() - interval '30 days' WHERE id = $1",
    [m.id],
  );
  await h.app.get(AccountService).purgeDue();
}

describe('referral rewards only for real attendance (D-228)', () => {
  it('nothing at sign-up or at the referrer’s own plan; the reward comes at the first independent plan', async () => {
    const referrer = await verifiedMember(h);
    const { code } = await referralsOf(referrer);
    const s = await signIn(h, undefined, { inviteCode: code });
    await onboard(h, s.accessToken);
    const friend: Member = { id: s.user.id, token: s.accessToken, phone: s.phone };
    const signedUp = await referralsOf(referrer);
    expect(signedUp.items[0]).toMatchObject({ status: 'pending', person: { id: friend.id } });
    expect(signedUp.balance).toMatchObject({ priorityPasses: 0, credits: 0 });

    // Checking a friend in at your own plan earns nothing (and doesn't use up the referral).
    await checkIn(friend, (await plot(h, referrer)).id);
    expect((await referralsOf(referrer)).items[0]?.status).toBe('pending');

    const host = await verifiedMember(h);
    await checkIn(friend, (await plot(h, host)).id);
    const after = await referralsOf(referrer);
    expect(after.items[0]?.status).toBe('rewarded');
    expect(after.balance).toMatchObject({ priorityPasses: 2, credits: 1 });
    const { rows } = await h.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM referral_rewards WHERE user_id = $1',
      [referrer.id],
    );
    expect(rows[0]?.n).toBe(2);
  });

  it('the referral limit follows the phone number, so a fresh account does not reset it', async () => {
    const settings = h.app.get(AppSettingsService);
    const limitWas = await settings.get('referral_max_rewarded');
    await settings.set('referral_max_rewarded', 1);
    try {
      const host = await verifiedMember(h);
      const referrer = await member(h);
      const first = await signIn(h, undefined, { inviteCode: (await referralsOf(referrer)).code });
      await onboard(h, first.accessToken);
      await checkIn(
        { id: first.user.id, token: first.accessToken, phone: first.phone },
        (await plot(h, host)).id,
      );
      expect((await referralsOf(referrer)).items[0]?.status).toBe('rewarded');

      // Delete the account, come back on the same number with a new code, refer someone new.
      await purge(referrer);
      const back = await signIn(h, referrer.phone);
      await onboard(h, back.accessToken);
      const again: Member = { id: back.user.id, token: back.accessToken, phone: back.phone };
      expect(again.id).not.toBe(referrer.id);
      const second = await signIn(h, undefined, { inviteCode: (await referralsOf(again)).code });
      await onboard(h, second.accessToken);
      await checkIn(
        { id: second.user.id, token: second.accessToken, phone: second.phone },
        (await plot(h, host)).id,
      );
      const farmed = await referralsOf(again);
      expect(farmed.items[0]).toMatchObject({ status: 'rejected', reason: 'LIMIT_REACHED' });
      expect(farmed.balance).toMatchObject({ priorityPasses: 0, credits: 0 });
    } finally {
      await settings.set('referral_max_rewarded', limitWas);
    }
  });
});

describe('one account per phone (D-228)', () => {
  it('signing in again on the same number reaches the same account, and the database refuses a second', async () => {
    const first = await signIn(h);
    expect(first.isNewUser).toBe(true);
    const second = await signIn(h, first.phone);
    expect(second).toMatchObject({ isNewUser: false, user: { id: first.user.id } });
    const { rows } = await h.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM users WHERE phone_e164 = $1',
      [first.phone],
    );
    expect(rows[0]?.n).toBe(1);
    await expect(
      h.pool.query(
        `INSERT INTO users (id, phone_e164, phone_hash, status)
         SELECT uuid_v7(), phone_e164, phone_hash, 'active' FROM users WHERE id = $1`,
        [first.user.id],
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});
