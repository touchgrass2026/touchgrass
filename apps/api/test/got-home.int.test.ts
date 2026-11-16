import type { GotHomeStatus, SafetySettings } from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventStore } from '../src/modules/events/event-store.service.js';
import { GotHomeService } from '../src/modules/safety/got-home.service.js';
import { idem, plot, rsvp, verifiedMember } from './event-helpers.js';
import { bearer, createHarness, type Harness, member, type Member } from './harness.js';

let h: Harness;
const MIN = 60_000;
const H = 60 * MIN;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

const api = (m: Member) => ({
  get: (path: string) =>
    request(h.http)
      .get(path)
      .set(...bearer(m.token)),
  post: (path: string, body?: object) =>
    request(h.http)
      .post(path)
      .set(...bearer(m.token))
      .set(...idem())
      .send(body ?? {}),
  patch: (path: string, body: object) =>
    request(h.http)
      .patch(path)
      .set(...bearer(m.token))
      .send(body),
});

/** Puts a plan at an exact end time (two hours long). */
async function endAt(eventId: string, endsAt: Date): Promise<void> {
  await h.pool.query('UPDATE events SET starts_at = $2, ends_at = $3 WHERE id = $1', [
    eventId,
    new Date(endsAt.getTime() - 2 * H),
    endsAt,
  ]);
  await h.app.get(EventStore).invalidate(eventId);
}

async function checkIn(eventId: string, m: Member): Promise<void> {
  await h.pool.query(
    `UPDATE rsvps SET status = 'checked_in', checked_in_at = now(), check_in_method = 'qr'
     WHERE event_id = $1 AND user_id = $2`,
    [eventId, m.id],
  );
}

async function asks(m: Member, eventId: string): Promise<number> {
  const { rows } = await h.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM notifications
     WHERE user_id = $1 AND kind = 'got_home_ask' AND params->>'eventId' = $2`,
    [m.id, eventId],
  );
  return rows[0]?.n ?? 0;
}

/** The most recent instant at hh:mm UTC that is at least a day back, so the plan is safely over. */
function pastUtc(hour: number, minute: number): Date {
  const d = new Date(Date.now() - 24 * H);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

/** A plan with guests who pulled up; `checkedIn` of them checked in. */
async function planWith(guests: Member[], checkedIn: Member[]): Promise<string> {
  const host = await verifiedMember(h);
  const plan = await plot(h, host);
  for (const g of guests) await rsvp(h, g, plan.id).expect(200);
  for (const g of checkedIn) await checkIn(plan.id, g);
  return plan.id;
}

describe('"Got home safe?" (D-212)', () => {
  it('safety settings default to asking and can be switched off', async () => {
    const m = await member(h);
    expect((await api(m).get('/v1/safety/settings').expect(200)).body).toEqual({
      gotHomeCheck: true,
    } satisfies SafetySettings);
    await api(m).patch('/v1/safety/settings', {}).expect(400);
    expect(
      (await api(m).patch('/v1/safety/settings', { gotHomeCheck: false }).expect(200)).body,
    ).toEqual({ gotHomeCheck: false });
    expect((await api(m).get('/v1/safety/settings').expect(200)).body.gotHomeCheck).toBe(false);
  });

  it('after a late plan the job asks checked-in members once, skipping those who switched it off', async () => {
    const [on, off, noShow] = [await member(h), await member(h), await member(h)];
    await api(off).patch('/v1/safety/settings', { gotHomeCheck: false }).expect(200);
    const id = await planWith([on, off, noShow], [on, off]);
    // 16:30 UTC is 22:00 in Hyderabad: late.
    const endsAt = pastUtc(16, 30);
    await endAt(id, endsAt);
    const job = h.app.get(GotHomeService);

    await job.askDue(new Date(endsAt.getTime() + 20 * MIN));
    expect(await asks(on, id)).toBe(0);
    await job.askDue(new Date(endsAt.getTime() + 31 * MIN));
    await job.askDue(new Date(endsAt.getTime() + 36 * MIN));
    expect([await asks(on, id), await asks(off, id), await asks(noShow, id)]).toEqual([1, 0, 0]);
    const { rows } = await h.pool.query<{ path: string }>(
      `SELECT path FROM notifications WHERE user_id = $1 AND kind = 'got_home_ask'`,
      [on.id],
    );
    expect(rows[0]?.path).toBe(`safety/got-home/${id}`);
    // Nothing after the window.
    await h.pool.query(`DELETE FROM reminder_log WHERE ref_id = $1`, [id]);
    await job.askDue(new Date(endsAt.getTime() + 7 * H));
    expect(await asks(on, id)).toBe(1);
  });

  it('a plan ending early evening is not late in its zone, unless the member asked for it', async () => {
    const [plain, asked] = [await member(h), await member(h)];
    const id = await planWith([plain, asked], [plain, asked]);
    // 12:30 UTC is 18:00 in Hyderabad.
    const endsAt = pastUtc(12, 30);
    await endAt(id, endsAt);
    const svc = h.app.get(GotHomeService);
    const before = new Date(endsAt.getTime() - H);
    const status = await svc.request(asked.id, id, true, before);
    expect(status).toMatchObject({ late: false, requested: true, willAsk: true, due: false });
    expect((await svc.status(plain.id, id, before)).willAsk).toBe(false);
    await svc.askDue(new Date(endsAt.getTime() + 31 * MIN));
    expect([await asks(plain, id), await asks(asked, id)]).toEqual([0, 1]);
  });

  it('snooze asks again once per snooze, three at most; "I got home" stops it for good', async () => {
    const m = await member(h);
    const id = await planWith([m], []);
    // Asked for while going, so the plan's hour does not matter.
    const asked = (
      await api(m).post(`/v1/safety/got-home/${id}/request`, { ask: true }).expect(200)
    ).body as GotHomeStatus;
    expect(asked).toMatchObject({ requested: true, willAsk: true, due: false, canSnooze: false });
    await api(m).post(`/v1/safety/got-home/${id}/home`).expect(403);

    await checkIn(id, m);
    await endAt(id, new Date(Date.now() - 10 * MIN));
    let s = (await api(m).get(`/v1/safety/got-home/${id}`).expect(200)).body as GotHomeStatus;
    expect(s).toMatchObject({ due: true, canSnooze: true, homeAt: null, snoozes: 0 });

    s = (await api(m).post(`/v1/safety/got-home/${id}/snooze`).expect(200)).body as GotHomeStatus;
    expect(s).toMatchObject({ due: false, snoozes: 1 });
    expect(new Date(s.askAgainAt ?? 0).getTime()).toBeGreaterThan(Date.now() + 25 * MIN);
    const again = await api(m).post(`/v1/safety/got-home/${id}/snooze`).expect(403);
    expect(again.body.error.details.reason).toBe('NOT_DUE');

    // The push comes back once the snooze is over, once.
    const job = h.app.get(GotHomeService);
    await job.askDue(new Date(Date.now() + 35 * MIN));
    await job.askDue(new Date(Date.now() + 40 * MIN));
    expect(await asks(m, id)).toBe(1);

    // Two more snoozes, then no more.
    for (const n of [2, 3]) {
      await h.pool.query(
        `UPDATE got_home_checks SET ask_after = now() - interval '1 minute' WHERE event_id = $1`,
        [id],
      );
      s = (await api(m).post(`/v1/safety/got-home/${id}/snooze`).expect(200)).body as GotHomeStatus;
      expect(s.snoozes).toBe(n);
    }
    await h.pool.query(
      `UPDATE got_home_checks SET ask_after = now() - interval '1 minute' WHERE event_id = $1`,
      [id],
    );
    s = (await api(m).get(`/v1/safety/got-home/${id}`).expect(200)).body as GotHomeStatus;
    expect(s).toMatchObject({ due: true, canSnooze: false });
    const limit = await api(m).post(`/v1/safety/got-home/${id}/snooze`).expect(403);
    expect(limit.body.error.details.reason).toBe('SNOOZE_LIMIT');

    s = (await api(m).post(`/v1/safety/got-home/${id}/home`).expect(200)).body as GotHomeStatus;
    expect(s).toMatchObject({ due: false, willAsk: false });
    const homeAt = s.homeAt;
    expect(homeAt).not.toBeNull();
    // Pressing again keeps the first answer.
    s = (await api(m).post(`/v1/safety/got-home/${id}/home`).expect(200)).body as GotHomeStatus;
    expect(s.homeAt).toBe(homeAt);
    const before = await asks(m, id);
    await job.askDue(new Date(Date.now() + 2 * H));
    expect(await asks(m, id)).toBe(before);

    const exported = await job.exportFor(m.id);
    expect(exported).toMatchObject({
      safetySettings: { gotHomeCheck: true },
      gotHomeChecks: [{ eventId: id, snoozes: 3 }],
    });
  });

  it('only people on the plan can ask for it', async () => {
    const [m, stranger] = [await member(h), await member(h)];
    const id = await planWith([m], []);
    const res = await api(stranger)
      .post(`/v1/safety/got-home/${id}/request`, { ask: true })
      .expect(403);
    expect(res.body.error.details.reason).toBe('NOT_GOING');
  });
});
