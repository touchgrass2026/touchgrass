import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { EventDetail } from '@touchgrass/shared';
import { ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Platform, Share } from 'react-native';
import PlansScreen from '../app/(app)/(tabs)/plans';
import AttendeesScreen from '../app/(app)/events/[id]/attendees';
import CancelEventScreen from '../app/(app)/events/[id]/cancel';
import EventScreen from '../app/(app)/events/[id]/index';
import JoinRequestsScreen from '../app/(app)/events/[id]/requests';
import InviteScreen from '../app/(app)/events/[id]/invite';
import PlusOneScreen from '../app/(app)/events/[id]/plus-one';
import ScanScreen from '../app/(app)/events/[id]/scan';
import TicketScreen from '../app/(app)/events/[id]/ticket';
import PlotScreen from '../app/(app)/plot';
import ClaimRoute from '../app/claim/[token]';
import SharedEventRoute from '../app/e/[slug]';
import { istToIso, isoToIst, quickPick } from '../src/features/events/format';
import { useAuthFlowStore } from '../src/stores/auth-flow-store';
import { useAuthStore } from '../src/stores/auth-store';
import {
  authResponseFixture,
  FakeApi,
  ids,
  interestsFixture,
  vibesFixture,
} from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const EVENT_ID = '0192f3a4-5b6c-7d8e-9f01-00000000e001';
const person = (id: string, displayName: string) => ({
  id,
  displayName,
  photo: null,
  verified: true,
  mutualFriendCount: 0,
});
const host = person(ids.other, 'Rohan K.');
const me = person(ids.me, 'Priya R.');

function eventFixture(
  overrides: Partial<EventDetail> = {},
  viewer: Partial<EventDetail['viewer']> = {},
): EventDetail {
  return {
    id: EVENT_ID,
    slug: 'AbCd2345',
    type: 'plan',
    status: 'published',
    title: 'Sunset frisbee',
    cover: null,
    startsAt: '2026-11-03T12:30:00.000Z',
    endsAt: '2026-11-03T14:30:00.000Z',
    timezone: 'Asia/Kolkata',
    location: {
      kind: 'exact',
      point: { lat: 17.4436, lng: 78.3519 },
      address: '42 Lake Road, Gachibowli',
      placeName: 'Lake View Park',
      neighbourhoodName: 'Gachibowli',
    },
    visibility: 'public',
    capacity: 10,
    goingCount: 4,
    spotsLeft: 6,
    waitlistCount: 0,
    pricePaise: 0,
    soloFriendly: true,
    smallGroup: false,
    mystery: false,
    indoor: false,
    accessibility: { stepFree: true, accessibleRestroom: false, quietSpace: false },
    category: null,
    host: { topHost: false },
    viewer: {
      rsvp: null,
      isHost: false,
      hostRole: null,
      invitedBy: null,
      offer: null,
      plusOne: null,
      waitlistPosition: null,
      canRsvp: true,
      blockedReason: null,
      canCheckIn: false,
      payment: null,
      cooldownUntil: null,
      ...viewer,
    },
    description: 'Bring water.',
    hosts: [{ person: host, role: 'host' }],
    interests: [],
    vibeTags: [],
    minGroupSize: 2,
    allowPlusOnes: true,
    chatEnabled: true,
    balancedMaxSharePct: null,
    soloPercent: 50,
    cancelledReason: null,
    shareUrl: 'http://web.test/e/AbCd2345',
    refundPolicy: null,
    perks: [],
    lore: null,
    crew: null,
    held: false,
    heldReason: null,
    friendsGoing: { people: [], total: 0 },
    ...overrides,
  };
}

let api: FakeApi;
beforeEach(async () => {
  resetStores();
  await useAuthStore.getState().signIn(
    authResponseFixture({
      user: {
        id: ids.me,
        status: 'active',
        onboardingComplete: true,
        tutorialComplete: true,
        roles: [],
      },
    }) as never,
  );
  mockRouteParams.current = { id: EVENT_ID };
  api = new FakeApi().on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: eventFixture() });
});

/** Sunday 1 Nov 2026, noon IST: only the clock is fixed, timers keep running. */
const TODAY = new Date('2026-11-01T06:30:00.000Z');
function freezeToday(): void {
  jest.useFakeTimers({
    now: TODAY,
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
      'nextTick',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'performance',
      'hrtime',
    ],
  });
}

/** Opens the category list and picks the nth fixture interest. */
async function pickCategory(n: number): Promise<void> {
  await fireEvent.press(await screen.findByTestId('plot-category'));
  await fireEvent.press(
    await screen.findByTestId(`plot-category-${interestsFixture[n]?.id ?? ''}`),
  );
}

/** Name, category and a place: what a new plan needs before it can be published. */
async function fillPlot(): Promise<void> {
  await fireEvent.changeText(screen.getByTestId('plot-title'), 'Sunset frisbee');
  await pickCategory(0);
  await fireEvent.press(screen.getByTestId('plot-where'));
  await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
  await fireEvent.press(await screen.findByTestId('place-fx_lake'));
  await screen.findByTestId('plot-picked');
}

/** The presigned upload, storage POST and completion of a ready cover. */
function routeCoverUpload(): void {
  api
    .on('POST', '/v1/media/uploads', {
      status: 201,
      body: {
        assetId: ids.asset,
        upload: {
          url: 'https://s3.test/bucket',
          fields: { key: 'uploads/k' },
          expiresAt: '2026-11-01T01:00:00.000Z',
        },
      },
    })
    .on('POST', '/bucket', { status: 204 })
    .on('POST', `/v1/media/${ids.asset}/complete`, {
      status: 200,
      body: {
        id: ids.asset,
        purpose: 'event_cover',
        status: 'ready',
        width: 1600,
        height: 900,
        urls: null,
      },
    });
}

/** Picks Tuesday 3 Nov 2026, 6:00 pm from the calendar and time sheets. */
async function pickWhen(): Promise<void> {
  await fireEvent.press(screen.getByTestId('plot-date'));
  await fireEvent.press(await screen.findByTestId('plot-date-day-2026-11-03'));
  await fireEvent.press(screen.getByTestId('plot-time'));
  await fireEvent.press(await screen.findByTestId('plot-time-hour-6'));
  await fireEvent.press(screen.getByTestId('plot-time-minute-00'));
  await fireEvent.press(screen.getByTestId('plot-time-pm'));
  await fireEvent.press(screen.getByTestId('plot-time-done'));
}

describe('IST time helpers', () => {
  it('round-trips date and time entered in IST', () => {
    expect(istToIso('03/11/2026', '18:00')).toBe('2026-11-03T12:30:00.000Z');
    expect(isoToIst('2026-11-03T12:30:00.000Z')).toEqual({ date: '03/11/2026', time: '18:00' });
    expect(istToIso('31/02/2026', '18:00')).toBeNull();
    expect(istToIso('03/11/2026', '25:00')).toBeNull();
    expect(istToIso('03/11/2026', 'soon')).toBeNull();
  });
  it('quick picks tonight, tomorrow and the weekend', () => {
    const wedNoonIst = new Date('2026-11-04T06:30:00.000Z');
    expect(quickPick('tonight', wedNoonIst)).toEqual({ date: '04/11/2026', time: '19:00' });
    expect(quickPick('tonight', new Date('2026-11-04T15:00:00.000Z'))).toEqual({
      date: '04/11/2026',
      time: '21:00',
    });
    expect(quickPick('tomorrow', wedNoonIst)).toEqual({ date: '05/11/2026', time: '18:00' });
    expect(quickPick('weekend', wedNoonIst)).toEqual({ date: '07/11/2026', time: '17:00' });
  });
});

describe('Plans tab', () => {
  it('lists my plans by scope and opens Plot', async () => {
    api.on('GET', '/v1/events/mine', (c) => ({
      status: 200,
      body: {
        items: c.path ? [eventFixture({}, { rsvp: 'going', canRsvp: false })] : [],
        nextCursor: null,
      },
    }));
    await renderWithProviders(<PlansScreen />, { fetchFn: api.fetch });
    const card = await screen.findByTestId('event-AbCd2345');
    expect(card.props.accessibilityLabel).toContain("You're pulling up");
    await fireEvent.press(card);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]',
      params: { id: EVENT_ID },
    });
    await fireEvent.press(screen.getByTestId('plot-cta'));
    expect(mockRouter.push).toHaveBeenCalledWith('/plot');
    // Upcoming, hosting and past load together and show as sideways rows (D-158).
    const scopes = api.calls
      .filter((c) => c.path === '/v1/events/mine')
      .map((c) => new URL(c.url).searchParams.get('scope'));
    expect(scopes.sort()).toEqual(['hosting', 'past', 'upcoming']);
    expect(screen.getByTestId('rail-mine-hosting')).toBeOnTheScreen();
    expect(screen.getByTestId('rail-mine-past')).toBeOnTheScreen();
  });

  it('shows the empty state', async () => {
    api.on('GET', '/v1/events/mine', { status: 200, body: { items: [], nextCursor: null } });
    await renderWithProviders(<PlansScreen />, { fetchFn: api.fetch });
    expect(
      await screen.findByText('Nothing planned yet. Plot something or pull up to a plan.'),
    ).toBeOnTheScreen();
  });
});

describe('Event detail', () => {
  it('a held plan tells its host why: payments go through TouchGrass, or no phone numbers (D-228)', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventFixture(
        { held: true, heldReason: 'payment' },
        { isHost: true, hostRole: 'host', rsvp: 'going', canRsvp: false },
      ),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('event-held')).toHaveTextContent(
      /asks people to pay outside TouchGrass. Payments go through TouchGrass so buyers are protected/,
    );
  });

  it('a held plan with a phone number says so', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventFixture(
        { held: true, heldReason: 'contact' },
        { isHost: true, hostRole: 'host', rsvp: 'going', canRsvp: false },
      ),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('event-held')).toHaveTextContent(
      /plan details can't include phone numbers/,
    );
  });

  it('reporting a paid plan offers "Asked to pay outside the app" (D-228)', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventFixture({ pricePaise: 25_000 }),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Report' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/report',
      params: { targetType: 'event', targetId: EVENT_ID, name: 'Sunset frisbee', paid: '1' },
    });
  });

  it('shows the plan card, then Pull up, then the plan chat, then the details', async () => {
    const going = eventFixture({}, { rsvp: 'going', canRsvp: false });
    api
      .on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: going })
      .on('GET', `/v1/events/${EVENT_ID}/chat`, {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'none' } },
      });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await screen.findByTestId('event-hero');
    const order = ['event-hero', 'event-rsvp', 'together-tools', 'event-details'];
    const tree = JSON.stringify(screen.toJSON());
    const positions = order.map((id) => tree.indexOf(`"testID":"${id}"`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('shows friends going near who is pulling up and the top host badge by the host (D-210)', async () => {
    const meera = person('0192f3a4-5b6c-7d8e-9f01-00000000f001', 'Meera');
    const ravi = person('0192f3a4-5b6c-7d8e-9f01-00000000f002', 'Ravi');
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventFixture({
        host: { topHost: true },
        friendsGoing: { people: [meera, ravi], total: 4 },
      }),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    const row = await screen.findByTestId('friends-going');
    expect(row).toHaveTextContent(/Meera, Ravi and 2 friends are going$/);
    expect(row.props.accessibilityLabel).toBe('Meera, Ravi and 2 friends are going');
    expect(
      screen.getByTestId(`top-host-${host.id}`, { includeHiddenElements: true }),
    ).toHaveTextContent('Top host');
    expect(
      screen.getByRole('button', { name: /^Rohan K\., Verified, Top host/ }),
    ).toBeOnTheScreen();
  });

  it('shows no friends line and no badge when neither applies', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: eventFixture() });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await screen.findByTestId('event-hero');
    expect(screen.queryByTestId('friends-going')).toBeNull();
    expect(screen.queryByTestId(`top-host-${host.id}`, { includeHiddenElements: true })).toBeNull();
  });

  it('pulls up with an idempotency key and shows the new state', async () => {
    const going = eventFixture({ goingCount: 5, spotsLeft: 5 }, { rsvp: 'going', canRsvp: false });
    api.on('PUT', `/v1/events/${EVENT_ID}/rsvp`, () => {
      // The server now reports the new state on every read.
      api.on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: going });
      return { status: 200, body: { status: 'going', plusOneClaimUrl: null, event: going } };
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Lake View Park · 42 Lake Road, Gachibowli')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('pull-up'));
    await waitFor(() => expect(api.callsTo('PUT', `/v1/events/${EVENT_ID}/rsvp`)).toHaveLength(1));
    const call = api.callsTo('PUT', `/v1/events/${EVENT_ID}/rsvp`)[0];
    expect(call?.body).toEqual({ status: 'going', plusOne: null });
    expect(call?.headers['idempotency-key']).toMatch(/^rsvp-/);
    expect(await screen.findByTestId('rsvp-status')).toHaveTextContent("You're pulling up");
  });

  it('offers a +1 only while pulling up, never on a seat you already hold', async () => {
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('plus-one')).toBeOnTheScreen();
  });

  it('hides the +1 once you are going (the API refuses adding one to a held seat)', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventFixture({}, { rsvp: 'going', canRsvp: false }),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('rsvp-status')).toBeOnTheScreen();
    expect(screen.queryByTestId('plus-one')).toBeNull();
  });

  it('mystery plans show only the area until the reveal', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventFixture(
        {
          mystery: true,
          location: {
            kind: 'approximate',
            center: { lat: 17.45, lng: 78.36 },
            radiusMeters: 2000,
            neighbourhoodName: 'Gachibowli',
            revealsAt: '2026-11-03T10:30:00.000Z',
          },
        },
        { rsvp: 'going', canRsvp: false },
      ),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Mystery spot near Gachibowli')).toBeOnTheScreen();
    expect(screen.getByText(/Exact spot revealed/)).toBeOnTheScreen();
    expect(screen.queryByText(/Lake Road/)).toBeNull();
  });

  it('claims an open waitlist spot', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}`, {
        status: 200,
        body: eventFixture(
          { spotsLeft: 0 },
          {
            rsvp: 'waitlisted',
            waitlistPosition: 1,
            canRsvp: false,
            offer: { expiresAt: '2026-11-03T08:00:00.000Z', mode: 'sequential' },
          },
        ),
      })
      .on('POST', `/v1/events/${EVENT_ID}/waitlist/claim`, {
        status: 200,
        body: {
          status: 'going',
          plusOneClaimUrl: null,
          event: eventFixture({}, { rsvp: 'going', canRsvp: false }),
        },
      });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('A spot is now available.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('claim-spot'));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/waitlist/claim`)).toHaveLength(1),
    );
  });

  it('explains why you cannot pull up using the API reason', async () => {
    api.on('PUT', `/v1/events/${EVENT_ID}/rsvp`, {
      status: 403,
      body: { error: { code: 'NOT_ELIGIBLE', message: 'x', details: { reason: 'WOMEN_ONLY' } } },
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('pull-up'));
    expect(await screen.findByTestId('event-error')).toHaveTextContent(
      'This plan is for verified women.',
    );
  });

  it('private plan: asks the host to join, shows the wait, and hides the spot (D-179)', async () => {
    const hidden = {
      kind: 'approximate' as const,
      center: { lat: 17.45, lng: 78.36 },
      radiusMeters: 2000,
      neighbourhoodName: 'Gachibowli',
      revealsAt: '2026-11-03T10:30:00.000Z',
      hiddenBy: 'approval' as const,
    };
    const closed = { canRsvp: false, blockedReason: 'APPROVAL_REQUIRED' };
    // The server remembers the request, so every refetch after asking shows it as pending.
    let request: 'pending' | null = null;
    const plan = () =>
      eventFixture(
        { visibility: 'approval', location: hidden },
        { ...closed, joinRequest: request },
      );
    api
      .on('GET', `/v1/events/${EVENT_ID}`, () => ({ status: 200, body: plan() }))
      .on('POST', `/v1/events/${EVENT_ID}/join-request`, () => {
        request = 'pending';
        return { status: 200, body: { status: 'pending', event: plan() } };
      })
      .on('DELETE', `/v1/events/${EVENT_ID}/join-request`, () => {
        request = null;
        return { status: 204 };
      });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('event-location-hidden')).toHaveTextContent(
      /shared once the host lets you in/,
    );
    expect(screen.queryByTestId('pull-up')).toBeNull();
    await fireEvent.press(screen.getByTestId('join-ask'));
    expect(await screen.findByTestId('join-pending')).toHaveTextContent(
      'Request sent. The host will let you know.',
    );
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/join-request`)).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('join-withdraw'));
    await waitFor(() =>
      expect(api.callsTo('DELETE', `/v1/events/${EVENT_ID}/join-request`)).toHaveLength(1),
    );
  });

  it('private plan: a declined request says so and offers nothing else', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventFixture(
        { visibility: 'approval' },
        { canRsvp: false, blockedReason: 'APPROVAL_REQUIRED', joinRequest: 'declined' },
      ),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('join-declined')).toBeOnTheScreen();
    expect(screen.queryByTestId('join-ask')).toBeNull();
    expect(screen.queryByTestId('pull-up')).toBeNull();
  });

  it('private plan: the host sees who is waiting and lets them in or not', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}`, {
        status: 200,
        body: eventFixture(
          { visibility: 'approval', pendingJoinRequests: 2 },
          { isHost: true, hostRole: 'host', canRsvp: false, blockedReason: 'HOST' },
        ),
      })
      .on('GET', `/v1/events/${EVENT_ID}/join-requests`, {
        status: 200,
        body: {
          items: [{ person: host, status: 'pending', requestedAt: '2026-11-01T06:00:00.000Z' }],
          nextCursor: null,
        },
      })
      .on('POST', `/v1/events/${EVENT_ID}/join-requests/${ids.other}/approve`, { status: 204 });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('join-requests')).toHaveTextContent('Requests to join (2)');
    await fireEvent.press(screen.getByTestId('join-requests'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]/requests',
      params: { id: EVENT_ID },
    });

    await renderWithProviders(<JoinRequestsScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId(`join-approve-${ids.other}`));
    await waitFor(() =>
      expect(
        api.callsTo('POST', `/v1/events/${EVENT_ID}/join-requests/${ids.other}/approve`),
      ).toHaveLength(1),
    );
  });

  it('checks in by location when the window is open', async () => {
    jest
      .mocked(Location.requestForegroundPermissionsAsync)
      .mockResolvedValueOnce({ granted: true } as never);
    api
      .on('GET', `/v1/events/${EVENT_ID}`, {
        status: 200,
        body: eventFixture({}, { rsvp: 'going', canRsvp: false, canCheckIn: true }),
      })
      .on('POST', `/v1/events/${EVENT_ID}/check-in`, {
        status: 200,
        body: {
          userId: ids.me,
          displayName: 'Priya R.',
          checkedInAt: '2026-11-03T12:31:00.000Z',
          method: 'geofence',
        },
      });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('self-check-in'));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/check-in`)[0]?.body).toEqual({
        point: { lat: 17.4436, lng: 78.3519 },
      }),
    );
  });

  it('host tools: edit, cancel, scan; shares the link', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventFixture(
        { hosts: [{ person: me, role: 'host' }] },
        { isHost: true, hostRole: 'host', rsvp: 'going', canRsvp: false, blockedReason: 'HOST' },
      ),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('share'));
    expect(share).toHaveBeenCalledWith({
      message: expect.stringContaining('http://web.test/e/AbCd2345') as string,
    });
    await fireEvent.press(screen.getByTestId('edit'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/plot', params: { id: EVENT_ID } });
    await fireEvent.press(screen.getByTestId('scan'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]/scan',
      params: { id: EVENT_ID },
    });
    expect(screen.queryByTestId('leave')).toBeNull();
    // Hosts scan guests in; they never get a check-in code (or self check-in) of their own.
    expect(screen.queryByTestId('open-ticket')).toBeNull();
    expect(screen.queryByTestId('self-check-in')).toBeNull();
  });

  it('cancels a plan with a reason', async () => {
    api.on('POST', `/v1/events/${EVENT_ID}/cancel`, {
      status: 200,
      body: eventFixture({ status: 'cancelled', cancelledReason: 'Rain' }),
    });
    await renderWithProviders(<CancelEventScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('cancel-reason'), 'Rain');
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/cancel`)[0]?.body).toEqual({
        reason: 'Rain',
      }),
    );
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  });
});

describe('Plot flow (F-EVT-01/02)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });
  beforeEach(() => {
    freezeToday();
    mockRouteParams.current = {};
    api
      .on('GET', '/v1/interests', { status: 200, body: { items: interestsFixture } })
      .on('GET', '/v1/venues/saved', { status: 200, body: { items: [] } })
      .on('GET', '/v1/venues/search', {
        status: 200,
        body: {
          venues: [],
          places: [
            { placeId: 'fx_lake', primaryText: 'Lake View Park', secondaryText: 'Gachibowli' },
          ],
        },
      })
      .on('POST', '/v1/venues/from-place', {
        status: 200,
        body: {
          id: '0192f3a4-5b6c-7d8e-9f01-00000000f00d',
          name: 'Lake View Park',
          address: 'Gachibowli',
          location: { lat: 17.44, lng: 78.35 },
          neighbourhoodName: 'Gachibowli',
          indoor: false,
          accessibility: { stepFree: false, accessibleRestroom: false, quietSpace: false },
          isPartner: false,
        },
      })
      .on('POST', '/v1/events', { status: 201, body: eventFixture() });
  });

  it('lists up to 4 known venues and 8 map places under labels, then shows only the pick (D-203)', async () => {
    api.on('GET', '/v1/venues/search', {
      status: 200,
      body: {
        venues: Array.from({ length: 5 }, (_, i) => ({
          id: `0192f3a4-5b6c-7d8e-9f01-0000000aa00${String(i)}`,
          name: `Lake cafe ${String(i)}`,
          address: 'Gachibowli',
          location: { lat: 17.44, lng: 78.35 },
          neighbourhoodName: 'Gachibowli',
          indoor: false,
          accessibility: { stepFree: false, accessibleRestroom: false, quietSpace: false },
          isPartner: false,
        })),
        places: Array.from({ length: 10 }, (_, i) => ({
          placeId: `fx_${String(i)}`,
          primaryText: `Lake ${String(i)}`,
          secondaryText: 'Gachibowli',
        })),
      },
    });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    // Where is a setting row that opens the place search in a sheet (D-199).
    await fireEvent.press(screen.getByTestId('plot-where'));
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
    expect(await screen.findByTestId('place-fx_7')).toBeOnTheScreen();
    expect(screen.queryByTestId('place-fx_8')).toBeNull();
    expect(screen.getByTestId('venue-0192f3a4-5b6c-7d8e-9f01-0000000aa003')).toBeOnTheScreen();
    expect(screen.queryByTestId('venue-0192f3a4-5b6c-7d8e-9f01-0000000aa004')).toBeNull();
    // Each source sits under its own label.
    expect(screen.getByRole('header', { name: 'On TouchGrass' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'From the map' })).toBeOnTheScreen();
    // Drop a pin stays right under the search box, in reach above the keyboard.
    expect(screen.getByTestId('plot-drop-pin')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('place-fx_0'));
    expect(await screen.findByTestId('plot-picked')).toBeOnTheScreen();
    expect(screen.queryByTestId('plot-suggestions')).toBeNull();
    expect(screen.queryByTestId('plot-place-search')).toBeNull();
    await fireEvent.press(screen.getByTestId('plot-where'));
    expect(screen.getByTestId('plot-place-search')).toBeOnTheScreen();
  });

  it('waits for typing to settle before searching', async () => {
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByTestId('plot-where'));
    for (const q of ['la', 'lak', 'lake'])
      await fireEvent.changeText(screen.getByTestId('plot-place-search'), q);
    expect(await screen.findByTestId('place-fx_lake')).toBeOnTheScreen();
    // Like a maps app (D-206): the place's name, then its address under it, in one compact row.
    expect(screen.getByText('Lake View Park')).toBeOnTheScreen();
    expect(screen.getByTestId('place-fx_lake')).toHaveAccessibleName('Lake View Park, Gachibowli');
    const searches = api.calls.filter((c) => c.path === '/v1/venues/search');
    expect(searches).toHaveLength(1);
    expect(searches[0]?.url).toContain('q=lake');
  });

  it('place search says when nothing matches and when search fails', async () => {
    let fail = false;
    api.on('GET', '/v1/venues/search', () =>
      fail
        ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }
        : { status: 200, body: { venues: [], places: [] } },
    );
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByTestId('plot-where'));
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'zzz');
    expect(await screen.findByTestId('plot-place-empty')).toHaveTextContent(
      'No places match "zzz". Try another name, or drop a pin on the map.',
    );
    fail = true;
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'zzzz');
    expect(await screen.findByTestId('plot-place-error')).toBeOnTheScreen();
  });

  it('needs a place, then publishes with IST times and the chosen venue', async () => {
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Sunset frisbee');
    await pickCategory(0);
    await pickWhen();
    // Without a place the plan cannot be published yet, and the page says what is missing.
    expect(screen.getByTestId('plot-submit')).toBeDisabled();
    expect(screen.getByTestId('plot-needs')).toHaveTextContent(
      'Add a name, a category and a place to publish.',
    );
    expect(screen.getByTestId('plot-where')).toHaveAccessibleName('Where, Add a place');

    await fireEvent.press(screen.getByTestId('plot-where'));
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
    await fireEvent.press(await screen.findByTestId('place-fx_lake'));
    expect(await screen.findByTestId('plot-picked')).toHaveTextContent('Lake View Park');
    expect(screen.getByTestId('plot-submit')).toBeEnabled();
    expect(screen.queryByTestId('plot-needs')).toBeNull();
    // Hosts can do without a group chat (D-156); it sits under More options.
    await fireEvent.press(screen.getByRole('button', { name: 'More options' }));
    await fireEvent(screen.getByTestId('plot-chat'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('plot-submit'));
    await waitFor(() => expect(api.callsTo('POST', '/v1/events')).toHaveLength(1));
    const call = api.callsTo('POST', '/v1/events')[0];
    expect(call?.body).toMatchObject({
      title: 'Sunset frisbee',
      chatEnabled: false,
      categoryInterestId: interestsFixture[0]?.id,
      where: { venueId: '0192f3a4-5b6c-7d8e-9f01-00000000f00d' },
      startsAt: '2026-11-03T12:30:00.000Z',
      endsAt: '2026-11-03T14:30:00.000Z',
      capacity: 8,
      visibility: 'public',
    });
    expect(call?.headers['idempotency-key']).toMatch(/^plot-/);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/events/[id]',
      params: { id: EVENT_ID },
    });
  });

  it('a failed squad invite still opens the new plan, once, with a notice', async () => {
    mockRouteParams.current = { inviteUserId: ids.other };
    api.on('POST', `/v1/events/${EVENT_ID}/invites`, {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Sunset frisbee');
    await pickCategory(0);
    await pickWhen();
    await fireEvent.press(screen.getByTestId('plot-where'));
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
    await fireEvent.press(await screen.findByTestId('place-fx_lake'));
    await screen.findByTestId('plot-picked');
    await fireEvent.press(screen.getByTestId('plot-submit'));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/events/[id]',
        params: { id: EVENT_ID, notice: 'inviteFailed' },
      }),
    );
    expect(api.callsTo('POST', '/v1/events')).toHaveLength(1);
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/invites`)).toHaveLength(1);
  });

  it('asks a first-time host to agree to "No payments outside TouchGrass" once, then publishes (D-228)', async () => {
    let acknowledged = false;
    api
      .on('GET', '/v1/host/conduct', () => ({
        status: 200,
        body: {
          rulesAcknowledged: acknowledged,
          acknowledgedAt: acknowledged ? '2026-11-03T10:00:00.000Z' : null,
          hostingRevoked: false,
          strikes: 0,
          strikeLimit: 2,
        },
      }))
      .on('POST', '/v1/host/rules/ack', () => {
        acknowledged = true;
        return {
          status: 201,
          body: {
            rulesAcknowledged: true,
            acknowledgedAt: '2026-11-03T10:00:00.000Z',
            hostingRevoked: false,
            strikes: 0,
            strikeLimit: 2,
          },
        };
      });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Sunset frisbee');
    await pickCategory(0);
    await pickWhen();
    await fireEvent.press(screen.getByTestId('plot-where'));
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
    await fireEvent.press(await screen.findByTestId('place-fx_lake'));
    await screen.findByTestId('plot-picked');
    await waitFor(() => expect(api.callsTo('GET', '/v1/host/conduct')).toHaveLength(1));

    // "Not now" keeps the draft and publishes nothing.
    await fireEvent.press(screen.getByTestId('plot-submit'));
    expect(await screen.findByTestId('host-rules-sheet')).toBeOnTheScreen();
    expect(screen.getByText('No payments outside TouchGrass.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('host-rules-later'));
    expect(screen.queryByTestId('host-rules-sheet')).toBeNull();
    expect(api.callsTo('POST', '/v1/events')).toHaveLength(0);

    await fireEvent.press(screen.getByTestId('plot-submit'));
    const agree = await screen.findByRole('button', { name: 'I agree' });
    expect(agree).toHaveProp('accessibilityHint', 'Agree to the rule and publish your plan');
    await fireEvent.press(agree);
    await waitFor(() => expect(api.callsTo('POST', '/v1/events')).toHaveLength(1));
    expect(api.callsTo('POST', '/v1/host/rules/ack')[0]?.body).toEqual({
      rule: 'no_off_platform_payments',
    });
    expect(screen.queryByTestId('host-rules-sheet')).toBeNull();
  });

  it('a host who already agreed publishes straight away (D-228)', async () => {
    api.on('GET', '/v1/host/conduct', {
      status: 200,
      body: {
        rulesAcknowledged: true,
        acknowledgedAt: '2026-11-01T10:00:00.000Z',
        hostingRevoked: false,
        strikes: 0,
        strikeLimit: 2,
      },
    });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Sunset frisbee');
    await pickCategory(0);
    await pickWhen();
    await fireEvent.press(screen.getByTestId('plot-where'));
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
    await fireEvent.press(await screen.findByTestId('place-fx_lake'));
    await screen.findByTestId('plot-picked');
    await waitFor(() => expect(api.callsTo('GET', '/v1/host/conduct')).toHaveLength(1));
    await fireEvent.press(screen.getByTestId('plot-submit'));
    await waitFor(() => expect(api.callsTo('POST', '/v1/events')).toHaveLength(1));
    expect(screen.queryByTestId('host-rules-sheet')).toBeNull();
    expect(api.callsTo('POST', '/v1/host/rules/ack')).toHaveLength(0);
  });

  it('a retried submit reuses the same idempotency key, so it cannot create a second plan', async () => {
    api.on('POST', '/v1/events', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Sunset frisbee');
    await pickCategory(0);
    await pickWhen();
    await fireEvent.press(screen.getByTestId('plot-where'));
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
    await fireEvent.press(await screen.findByTestId('place-fx_lake'));
    await screen.findByTestId('plot-picked');
    await fireEvent.press(screen.getByTestId('plot-submit'));
    await waitFor(() => expect(api.callsTo('POST', '/v1/events')).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('plot-submit')).toBeEnabled());
    await fireEvent.press(screen.getByTestId('plot-submit'));
    await waitFor(() => expect(api.callsTo('POST', '/v1/events')).toHaveLength(2));
    const [first, second] = api.callsTo('POST', '/v1/events');
    expect(second?.headers['idempotency-key']).toBe(first?.headers['idempotency-key']);
  });

  it('adds a cover photo from the cover area and sends it with the plan (D-196)', async () => {
    const realFetch = global.fetch;
    // Compressing reads the local file back; everything else goes to the fake API.
    global.fetch = (input: string | URL | Request, init?: RequestInit) =>
      (typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      ).startsWith('file:')
        ? Promise.resolve(new Response('x'.repeat(4096)))
        : api.fetch(input, init);
    try {
      api
        .on('POST', '/v1/media/uploads', {
          status: 201,
          body: {
            assetId: ids.asset,
            upload: {
              url: 'https://s3.test/bucket',
              fields: { key: 'uploads/k' },
              expiresAt: '2026-11-01T01:00:00.000Z',
            },
          },
        })
        .on('POST', '/bucket', { status: 204 })
        .on('POST', `/v1/media/${ids.asset}/complete`, {
          status: 200,
          body: {
            id: ids.asset,
            purpose: 'event_cover',
            status: 'ready',
            width: 1600,
            height: 900,
            urls: null,
          },
        });
      await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
      expect(screen.queryByTestId('plot-cover-preview')).toBeNull();
      await fireEvent.press(screen.getByRole('button', { name: 'Add a cover photo' }));
      expect(await screen.findByTestId('plot-cover-preview')).toBeOnTheScreen();
      // Covers are cropped wide, to match the frame they are shown in.
      expect(jest.mocked(ImagePicker.launchImageLibraryAsync)).toHaveBeenLastCalledWith(
        expect.objectContaining({ aspect: [16, 9] }),
      );
      expect(screen.getByRole('button', { name: 'Change photo' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Remove photo' })).toBeOnTheScreen();
      expect(api.callsTo('POST', '/v1/media/uploads')[0]?.body).toMatchObject({
        purpose: 'event_cover',
      });

      await fireEvent.changeText(screen.getByTestId('plot-title'), 'Sunset frisbee');
      await pickCategory(0);
      await fireEvent.press(screen.getByTestId('plot-where'));
      await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
      await fireEvent.press(await screen.findByTestId('place-fx_lake'));
      await screen.findByTestId('plot-picked');
      await fireEvent.press(screen.getByTestId('plot-submit'));
      await waitFor(() => expect(api.callsTo('POST', '/v1/events')).toHaveLength(1));
      expect(api.callsTo('POST', '/v1/events')[0]?.body).toMatchObject({ coverMediaId: ids.asset });
    } finally {
      global.fetch = realFetch;
    }
  });

  it('adds squad members as co-hosts after the plan is created (D-203)', async () => {
    const asha = person('0192f3a4-5b6c-7d8e-9f01-0000000bb001', 'Asha M.');
    const vikram = person('0192f3a4-5b6c-7d8e-9f01-0000000bb002', 'Vikram S.');
    const neha = person('0192f3a4-5b6c-7d8e-9f01-0000000bb003', 'Neha P.');
    const zoya = person('0192f3a4-5b6c-7d8e-9f01-0000000bb004', 'Zoya K.');
    api
      .on('GET', '/v1/social/squad', {
        status: 200,
        body: { items: [asha, vikram, neha, zoya], nextCursor: null },
      })
      .on('POST', `/v1/events/${EVENT_ID}/hosts`, { status: 200, body: eventFixture() });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fillPlot();
    expect(screen.getByTestId('plot-cohosts')).toHaveAccessibleName('Co-hosts, None');
    await fireEvent.press(screen.getByTestId('plot-cohosts'));
    expect(
      await screen.findByText(
        'Pick up to 3 people from your squad to help run the plan. Each gets a seat.',
      ),
    ).toBeOnTheScreen();
    for (const p of [asha, vikram, neha])
      await fireEvent.press(await screen.findByTestId(`plot-cohost-${p.id}`));
    // Three is the most: the fourth cannot be picked.
    expect(screen.getByTestId(`plot-cohost-${zoya.id}`)).toBeDisabled();
    await fireEvent.press(screen.getByTestId(`plot-cohost-${neha.id}`));
    await fireEvent.press(screen.getByTestId('plot-cohosts-done'));
    expect(screen.getByTestId('plot-cohosts')).toHaveAccessibleName('Co-hosts, Asha M., Vikram S.');
    await fireEvent.press(screen.getByTestId('plot-submit'));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/events/[id]',
        params: { id: EVENT_ID },
      }),
    );
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/hosts`).map((c) => c.body)).toEqual([
      { userId: asha.id, role: 'co_host' },
      { userId: vikram.id, role: 'co_host' },
    ]);
  });

  it('keeps the new plan and says which co-hosts could not be added, and why (D-203)', async () => {
    const asha = person('0192f3a4-5b6c-7d8e-9f01-0000000bb001', 'Asha M.');
    const vikram = person('0192f3a4-5b6c-7d8e-9f01-0000000bb002', 'Vikram S.');
    api
      .on('GET', '/v1/social/squad', {
        status: 200,
        body: { items: [asha, vikram], nextCursor: null },
      })
      .on('POST', `/v1/events/${EVENT_ID}/hosts`, (call) =>
        (call.body as { userId: string }).userId === vikram.id
          ? { status: 409, body: { error: { code: 'EVENT_FULL', message: 'x' } } }
          : { status: 200, body: eventFixture() },
      );
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fillPlot();
    await fireEvent.press(screen.getByTestId('plot-cohosts'));
    await fireEvent.press(await screen.findByTestId(`plot-cohost-${asha.id}`));
    await fireEvent.press(screen.getByTestId(`plot-cohost-${vikram.id}`));
    await fireEvent.press(screen.getByTestId('plot-cohosts-done'));
    await fireEvent.press(screen.getByTestId('plot-submit'));
    const failures = await screen.findByTestId('plot-host-failures');
    expect(failures).toHaveTextContent(/Your plan is up, but these co-hosts couldn't be added:/);
    expect(failures).toHaveTextContent(/Vikram S\.: No seat left for them\./);
    expect(failures).not.toHaveTextContent(/Asha/);
    // The plan exists: publishing again is not offered, opening it is.
    expect(screen.queryByTestId('plot-submit')).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('plot-open-plan'));
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/events/[id]',
      params: { id: EVENT_ID },
    });
    expect(api.callsTo('POST', '/v1/events')).toHaveLength(1);
  });

  it('says when the squad is empty in the co-host sheet', async () => {
    api.on('GET', '/v1/social/squad', { status: 200, body: { items: [], nextCursor: null } });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByTestId('plot-cohosts'));
    expect(await screen.findByTestId('plot-cohosts-empty')).toBeOnTheScreen();
  });

  it('keeps an animated GIF cover whole and uploads it as a GIF (D-203)', async () => {
    const realFetch = global.fetch;
    global.fetch = (input: string | URL | Request, init?: RequestInit) =>
      (typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      ).startsWith('file:')
        ? Promise.resolve(new Response('x'.repeat(4096)))
        : api.fetch(input, init);
    try {
      routeCoverUpload();
      jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
        canceled: false,
        assets: [
          {
            uri: 'file:///party.gif',
            mimeType: 'image/gif',
            fileSize: 3_000_000,
            width: 480,
            height: 480,
          },
        ],
      });
      const manipulate = jest.mocked(ImageManipulator.manipulate);
      manipulate.mockClear();
      await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
      await fireEvent.press(screen.getByRole('button', { name: 'Add a cover photo' }));
      expect(await screen.findByTestId('plot-cover-preview')).toBeOnTheScreen();
      // Never re-encoded on the phone: that would keep only the first frame.
      expect(manipulate).not.toHaveBeenCalled();
      expect(api.callsTo('POST', '/v1/media/uploads')[0]?.body).toEqual({
        purpose: 'event_cover',
        contentType: 'image/gif',
        sizeBytes: 3_000_000,
      });
      expect(screen.getByTestId('plot-cover-preview').props.source).toEqual([
        { uri: 'file:///party.gif' },
      ]);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('refuses a GIF cover over 8 MB before uploading it (D-203)', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///huge.gif',
          mimeType: 'image/gif',
          fileSize: 8 * 1024 * 1024 + 1,
          width: 480,
          height: 480,
        },
      ],
    });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Add a cover photo' }));
    expect(await screen.findByTestId('plot-cover-error')).toHaveTextContent(
      'That GIF is over 8 MB. Pick a smaller one.',
    );
    expect(api.callsTo('POST', '/v1/media/uploads')).toHaveLength(0);
  });

  it('on Android skips the editor (it flattens GIFs) and centre-crops photos to 16:9 (D-203)', async () => {
    const os = Platform.OS;
    Platform.OS = 'android';
    const realFetch = global.fetch;
    global.fetch = (input: string | URL | Request, init?: RequestInit) =>
      (typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      ).startsWith('file:')
        ? Promise.resolve(new Response('x'.repeat(4096)))
        : api.fetch(input, init);
    try {
      routeCoverUpload();
      jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file:///tall.jpg', mimeType: 'image/jpeg', width: 3000, height: 4000 }],
      });
      const crop = jest.fn().mockReturnThis();
      jest.mocked(ImageManipulator.manipulate).mockImplementationOnce(
        () =>
          ({
            crop,
            resize: jest.fn().mockReturnThis(),
            renderAsync: jest.fn(() =>
              Promise.resolve({
                saveAsync: jest.fn(() =>
                  Promise.resolve({ uri: 'file:///cropped.jpg', width: 2048, height: 1152 }),
                ),
              }),
            ),
          }) as never,
      );
      await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
      await fireEvent.press(screen.getByRole('button', { name: 'Add a cover photo' }));
      expect(await screen.findByTestId('plot-cover-preview')).toBeOnTheScreen();
      expect(jest.mocked(ImagePicker.launchImageLibraryAsync)).toHaveBeenLastCalledWith(
        expect.objectContaining({ allowsEditing: false }),
      );
      expect(crop).toHaveBeenCalledWith({ originX: 0, originY: 1156, width: 3000, height: 1688 });
    } finally {
      Platform.OS = os;
      global.fetch = realFetch;
    }
  });

  it('shows server errors in plain words', async () => {
    api.on('POST', '/v1/events', {
      status: 403,
      body: { error: { code: 'VERIFICATION_REQUIRED', message: 'x' } },
    });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Chai');
    await pickCategory(0);
    await fireEvent.press(screen.getByTestId('plot-where'));
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
    await fireEvent.press(await screen.findByTestId('place-fx_lake'));
    await fireEvent.press(screen.getByTestId('plot-submit'));
    expect(await screen.findByTestId('plot-error')).toBeOnTheScreen();
  });
});

describe('Plot flow: pin, advanced options and edits', () => {
  afterEach(() => {
    jest.useRealTimers();
  });
  beforeEach(() => {
    freezeToday();
    api
      .on('GET', '/v1/interests', { status: 200, body: { items: interestsFixture } })
      .on('GET', '/v1/venues/saved', { status: 200, body: { items: [] } })
      .on('GET', '/v1/vibe-tags', { status: 200, body: { items: vibesFixture } })
      .on('POST', '/v1/events', { status: 201, body: eventFixture() })
      .on('PATCH', `/v1/events/${EVENT_ID}`, { status: 200, body: eventFixture() });
  });

  it('drops a pin on the map, picks a quick time and sets advanced options', async () => {
    mockRouteParams.current = {};
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Mystery chai');
    await pickCategory(1);
    await fireEvent.press(screen.getByTestId('plot-where'));
    await fireEvent.press(screen.getByRole('button', { name: 'Drop a pin' }));
    await fireEvent(screen.getByTestId('plot-map'), 'press', {
      nativeEvent: { coordinate: { latitude: 17.44, longitude: 78.35 } },
    });
    await fireEvent.changeText(screen.getByTestId('plot-pin-address'), 'Near the big banyan tree');
    await fireEvent.press(screen.getByRole('button', { name: 'Use this spot' }));
    expect(screen.getByTestId('plot-picked')).toHaveTextContent('Near the big banyan tree');
    await fireEvent.press(screen.getByRole('radio', { name: 'Tomorrow' }));
    await fireEvent.press(screen.getByTestId('plot-who'));
    await fireEvent.press(screen.getByTestId(`plot-visibility-balanced`));
    await fireEvent.press(screen.getByRole('radio', { name: 'Max share of any one gender: 70%' }));
    await fireEvent.press(screen.getByTestId('plot-who-done'));
    expect(screen.getByTestId('plot-who')).toHaveAccessibleName('Who can come, Balanced · 70%');
    await fireEvent.press(screen.getByRole('button', { name: 'More options' }));
    await fireEvent.press(screen.getByTestId('plot-vibes'));
    await fireEvent.press(await screen.findByTestId(`plot-vibe-${vibesFixture[0]?.id ?? ''}`));
    await fireEvent.press(screen.getByTestId('plot-vibes-done'));
    await fireEvent(screen.getByTestId('plot-mystery'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('plot-reveal'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Reveal the spot 4 h before' }));
    await fireEvent(screen.getByRole('switch', { name: 'Allow +1s' }), 'valueChange', true);
    await fireEvent(screen.getByRole('switch', { name: 'Step-free access' }), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('plot-submit'));
    await waitFor(() => expect(api.callsTo('POST', '/v1/events')).toHaveLength(1));
    expect(api.callsTo('POST', '/v1/events')[0]?.body).toMatchObject({
      where: {
        point: { lat: 17.44, lng: 78.35 },
        address: 'Near the big banyan tree',
        placeName: null,
      },
      visibility: 'balanced',
      balancedMaxSharePct: 70,
      mystery: true,
      mysteryRevealMinutesBefore: 240,
      allowPlusOnes: true,
      vibeTagIds: [vibesFixture[0]?.id],
      accessibility: { stepFree: true, accessibleRestroom: false, quietSpace: false },
    });
  });

  it('flags invalid input before calling the API', async () => {
    mockRouteParams.current = {};
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Sunset frisbee');
    await pickCategory(0);
    await fireEvent.press(screen.getByTestId('plot-where'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Drop a pin' }));
    await fireEvent(screen.getByTestId('plot-map'), 'press', {
      nativeEvent: { coordinate: { latitude: 17.44, longitude: 78.35 } },
    });
    await fireEvent.changeText(screen.getByTestId('plot-pin-address'), 'Somewhere');
    await fireEvent.press(screen.getByRole('button', { name: 'Use this spot' }));
    await fireEvent.press(screen.getByTestId('plot-how-many'));
    await fireEvent.changeText(screen.getByTestId('plot-capacity'), '1');
    await fireEvent.press(screen.getByTestId('plot-how-many-done'));
    await fireEvent.press(screen.getByTestId('plot-submit'));
    // The capacity problem shows on its own row.
    expect(await screen.findByTestId('plot-how-many-error')).toBeOnTheScreen();
    expect(api.callsTo('POST', '/v1/events')).toHaveLength(0);
  });

  it('shows current co-hosts when editing and adds or removes them on save (D-203)', async () => {
    const asha = person('0192f3a4-5b6c-7d8e-9f01-0000000bb001', 'Asha M.');
    const vikram = person('0192f3a4-5b6c-7d8e-9f01-0000000bb002', 'Vikram S.');
    const hosted = eventFixture(
      {
        hosts: [
          { person: me, role: 'host' },
          { person: asha, role: 'co_host' },
        ],
      },
      { isHost: true, hostRole: 'host' },
    );
    mockRouteParams.current = { id: EVENT_ID };
    api
      .on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: hosted })
      .on('PATCH', `/v1/events/${EVENT_ID}`, { status: 200, body: hosted })
      .on('GET', '/v1/social/squad', {
        status: 200,
        body: { items: [vikram], nextCursor: null },
      })
      .on('POST', `/v1/events/${EVENT_ID}/hosts`, { status: 200, body: hosted })
      .on('DELETE', `/v1/events/${EVENT_ID}/hosts/${asha.id}`, { status: 204 });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('plot-cohosts')).toHaveAccessibleName('Co-hosts, Asha M.');
    await fireEvent.press(screen.getByTestId('plot-cohosts'));
    // Asha was promoted from the guest list (not in the squad) and still shows, so she can be removed.
    await fireEvent.press(await screen.findByTestId(`plot-cohost-${asha.id}`));
    await fireEvent.press(screen.getByTestId(`plot-cohost-${vikram.id}`));
    await fireEvent.press(screen.getByTestId('plot-cohosts-done'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/hosts`).map((c) => c.body)).toEqual([
      { userId: vikram.id, role: 'co_host' },
    ]);
    expect(api.callsTo('DELETE', `/v1/events/${EVENT_ID}/hosts/${asha.id}`)).toHaveLength(1);
  });

  it('stays on the edit page and says which co-host change failed (D-203)', async () => {
    const vikram = person('0192f3a4-5b6c-7d8e-9f01-0000000bb002', 'Vikram S.');
    const hosted = eventFixture(
      { hosts: [{ person: me, role: 'host' }], visibility: 'women_only' },
      { isHost: true, hostRole: 'host' },
    );
    mockRouteParams.current = { id: EVENT_ID };
    api
      .on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: hosted })
      .on('PATCH', `/v1/events/${EVENT_ID}`, { status: 200, body: hosted })
      .on('GET', '/v1/social/squad', { status: 200, body: { items: [vikram], nextCursor: null } })
      .on('POST', `/v1/events/${EVENT_ID}/hosts`, {
        status: 403,
        body: { error: { code: 'NOT_ELIGIBLE', message: 'x', details: { reason: 'WOMEN_ONLY' } } },
      });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('plot-cohosts'));
    await fireEvent.press(await screen.findByTestId(`plot-cohost-${vikram.id}`));
    await fireEvent.press(screen.getByTestId('plot-cohosts-done'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    const failures = await screen.findByTestId('plot-host-failures');
    expect(failures).toHaveTextContent(/Your changes are saved, but these co-host changes/);
    expect(failures).toHaveTextContent(/Vikram S\.: This plan is for verified women\./);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('co-hosts editing a plan do not get the co-host row', async () => {
    const hosted = eventFixture(
      {
        hosts: [
          { person: host, role: 'host' },
          { person: me, role: 'co_host' },
        ],
      },
      { isHost: true, hostRole: 'co_host' },
    );
    mockRouteParams.current = { id: EVENT_ID };
    api.on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: hosted });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    expect(await screen.findByDisplayValue('Sunset frisbee')).toBeOnTheScreen();
    expect(screen.queryByTestId('plot-cohosts')).toBeNull();
  });

  it('drops a pin: the map suggests the address and says when the spot is not served (D-203)', async () => {
    mockRouteParams.current = {};
    api.on('GET', '/v1/venues/reverse-geocode', (call) =>
      call.url.includes('lat=19.07')
        ? { status: 200, body: { address: null, served: false } }
        : { status: 200, body: { address: 'Near KBR Park, Banjara Hills', served: true } },
    );
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByTestId('plot-where'));
    await fireEvent.press(screen.getByTestId('plot-drop-pin'));
    expect(screen.queryByTestId('plot-place-search')).toBeNull();
    await fireEvent(screen.getByTestId('plot-map'), 'press', {
      nativeEvent: { coordinate: { latitude: 19.07, longitude: 72.87 } },
    });
    expect(await screen.findByTestId('plot-pin-outside')).toHaveTextContent(
      'That spot is outside the cities TouchGrass serves. Pick a spot in your city.',
    );
    expect(screen.getByTestId('plot-use-pin')).toBeDisabled();
    await fireEvent(screen.getByTestId('plot-map'), 'press', {
      nativeEvent: { coordinate: { latitude: 17.42, longitude: 78.42 } },
    });
    await waitFor(() =>
      expect(screen.getByTestId('plot-pin-address')).toHaveDisplayValue(
        'Near KBR Park, Banjara Hills',
      ),
    );
    expect(screen.queryByTestId('plot-pin-outside')).toBeNull();
    await fireEvent.press(screen.getByTestId('plot-use-pin'));
    expect(screen.getByTestId('plot-picked')).toHaveTextContent('Near KBR Park, Banjara Hills');
    // Back to search from the map.
    await fireEvent.press(screen.getByTestId('plot-where'));
    await fireEvent.press(screen.getByTestId('plot-drop-pin'));
    await fireEvent.press(screen.getByTestId('plot-back-to-search'));
    expect(screen.getByTestId('plot-place-search')).toBeOnTheScreen();
  });

  it('edits an existing plan and only sends the place when it changed', async () => {
    mockRouteParams.current = { id: EVENT_ID };
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    expect(await screen.findByDisplayValue('Sunset frisbee')).toBeOnTheScreen();
    expect(screen.getByTestId('plot-date')).toHaveAccessibleName('Date: Tue, 3 Nov, 2026');
    expect(screen.getByTestId('plot-time')).toHaveAccessibleName('Time: 6:00 pm');
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Sunset frisbee v2');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.callsTo('PATCH', `/v1/events/${EVENT_ID}`)).toHaveLength(1));
    const body = api.callsTo('PATCH', `/v1/events/${EVENT_ID}`)[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      title: 'Sunset frisbee v2',
      startsAt: '2026-11-03T12:30:00.000Z',
    });
    expect(body).not.toHaveProperty('where');
    expect(body).not.toHaveProperty('mysteryRevealMinutesBefore');
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('Tickets, scanning, invites, +1s', () => {
  it('renders the ticket QR', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}/ticket`, {
      status: 200,
      body: {
        qr: `tg1.${EVENT_ID}.${ids.me}.${'a'.repeat(32)}`,
        eventId: EVENT_ID,
        validFrom: '2026-11-03T12:00:00.000Z',
        validUntil: '2026-11-03T14:30:00.000Z',
      },
    });
    await renderWithProviders(<TicketScreen />, { fetchFn: api.fetch });
    expect(await screen.findByLabelText('Your check-in code')).toBeOnTheScreen();
    expect(screen.getByText(/^Valid /)).toBeOnTheScreen();
  });

  it('swaps the code for "You\'re checked in" once a host scans it (D-205)', async () => {
    jest.useFakeTimers();
    try {
      api
        .on('GET', `/v1/events/${EVENT_ID}`, {
          status: 200,
          body: eventFixture({}, { rsvp: 'going', canRsvp: false }),
        })
        .on('GET', `/v1/events/${EVENT_ID}/ticket`, {
          status: 200,
          body: {
            qr: `tg1.${EVENT_ID}.${ids.me}.${'a'.repeat(32)}`,
            eventId: EVENT_ID,
            validFrom: '2026-11-03T12:00:00.000Z',
            validUntil: '2026-11-03T14:30:00.000Z',
          },
        });
      await renderWithProviders(<TicketScreen />, { fetchFn: api.fetch });
      expect(await screen.findByLabelText('Your check-in code')).toBeOnTheScreen();
      expect(screen.queryByTestId('ticket-checked-in')).toBeNull();
      // The host scans it; the open ticket notices on its next check.
      api.on('GET', `/v1/events/${EVENT_ID}`, {
        status: 200,
        body: eventFixture({}, { rsvp: 'checked_in', canRsvp: false }),
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(4500);
      });
      expect(await screen.findByTestId('ticket-checked-in')).toBeOnTheScreen();
      expect(screen.getByText("You're checked in")).toBeOnTheScreen();
      expect(screen.queryByLabelText('Your check-in code')).toBeNull();
      // Once in, it stops asking.
      const asked = api.callsTo('GET', `/v1/events/${EVENT_ID}`).length;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(12_000);
      });
      expect(api.callsTo('GET', `/v1/events/${EVENT_ID}`)).toHaveLength(asked);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a checked-in guest sees their status on the plan instead of the code', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventFixture({}, { rsvp: 'checked_in', canRsvp: false }),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('checked-in-status')).toBeOnTheScreen();
    expect(screen.queryByTestId('open-ticket')).toBeNull();
    expect(screen.queryByTestId('self-check-in')).toBeNull();
  });

  it('hosts check people in with a typed code when the camera is unavailable', async () => {
    api.on('POST', `/v1/events/${EVENT_ID}/check-in`, {
      status: 200,
      body: {
        userId: ids.other,
        displayName: 'Rohan K.',
        checkedInAt: '2026-11-03T12:31:00.000Z',
        method: 'qr',
      },
    });
    await renderWithProviders(<ScanScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByTestId('allow-camera'));
    await fireEvent.changeText(
      screen.getByTestId('manual-code'),
      `tg1.${EVENT_ID}.${ids.other}.${'b'.repeat(32)}`,
    );
    await fireEvent.press(screen.getByTestId('manual-check-in'));
    expect(await screen.findByTestId('scan-result')).toHaveTextContent('Rohan K. checked in');
  });

  it('invites squad members', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}/invitees`, {
        status: 200,
        body: { items: [{ person: host, invited: false, rsvp: null }] },
      })
      .on('POST', `/v1/events/${EVENT_ID}/invites`, { status: 200, body: { invited: 1 } });
    await renderWithProviders(<InviteScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId(`invitee-${ids.other}`));
    await fireEvent.press(screen.getByTestId('send-invites'));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/invites`)[0]?.body).toEqual({
        userIds: [ids.other],
      }),
    );
    expect(await screen.findByText('1 invited')).toBeOnTheScreen();
  });

  it('brings a guest +1 and shares the claim link', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    api
      .on('GET', /^\/v1\/social\/squad$/, {
        status: 200,
        body: { items: [host], nextCursor: null },
      })
      .on('PUT', `/v1/events/${EVENT_ID}/rsvp`, {
        status: 200,
        body: {
          status: 'going',
          plusOneClaimUrl: 'http://web.test/claim/abcdefghijklmnopqrstuv',
          event: eventFixture(),
        },
      });
    await renderWithProviders(<PlusOneScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('plus-one-guest'));
    await waitFor(() =>
      expect(api.callsTo('PUT', `/v1/events/${EVENT_ID}/rsvp`)[0]?.body).toEqual({
        status: 'going',
        plusOne: { guest: true },
      }),
    );
    expect(share).toHaveBeenCalled();
    expect(await screen.findByTestId('plus-one-done')).toHaveTextContent(
      /claim\/abcdefghijklmnopqrstuv/,
    );
  });

  it("who's going: hosts see first-timers and can add a co-host", async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}`, {
        status: 200,
        body: eventFixture(
          { hosts: [{ person: me, role: 'host' }] },
          { isHost: true, hostRole: 'host', canRsvp: false },
        ),
      })
      .on('GET', `/v1/events/${EVENT_ID}/attendees`, {
        status: 200,
        body: {
          items: [
            {
              person: host,
              status: 'going',
              firstTime: true,
              plusOneOf: null,
              isHost: false,
              reliabilityTier: 'reliable',
            },
          ],
          hiddenCount: 2,
        },
      })
      .on('POST', `/v1/events/${EVENT_ID}/hosts`, { status: 200, body: eventFixture() });
    await renderWithProviders(<AttendeesScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('+2 keeping it low-key')).toBeOnTheScreen();
    // Hosts see each attendee's reliability tier (F-SAF-02).
    expect(screen.getByText(/Reliable/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: /First-timers to welcome/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add co-host' }));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/hosts`)[0]?.body).toEqual({
        userId: ids.other,
        role: 'co_host',
      }),
    );
  });
});

describe('Deep links (F-EVT-17, F-EVT-07)', () => {
  it('opens a shared plan with its invite token', async () => {
    mockRouteParams.current = { slug: 'AbCd2345', i: 'tok123456789012345' };
    api.on('GET', '/v1/events/by-slug/AbCd2345', { status: 200, body: eventFixture() });
    await renderWithProviders(<SharedEventRoute />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('event-detail')).toBeOnTheScreen();
    expect(api.calls.find((c) => c.path === '/v1/events/by-slug/AbCd2345')).toBeDefined();
  });

  it('a signed-in member claims a +1 link', async () => {
    mockRouteParams.current = { token: 'abcdefghijklmnopqrstuv' };
    api.on('POST', '/v1/plus-ones/claim', {
      status: 200,
      body: { eventId: EVENT_ID, slug: 'AbCd2345' },
    });
    await renderWithProviders(<ClaimRoute />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByTestId('claim-plus-one'));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/events/[id]',
        params: { id: EVENT_ID },
      }),
    );
  });

  it('a signed-out visitor keeps the shared plan (and its invite) through sign-up', async () => {
    await useAuthStore.getState().signOut();
    mockRouteParams.current = { slug: 'AbCd2345', i: 'tok123456789012345' };
    await renderWithProviders(<SharedEventRoute />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Get started' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
    expect(useAuthFlowStore.getState().pendingLink).toBe('/e/AbCd2345?i=tok123456789012345');
  });

  it('a signed-out friend carries the claim token into sign-up', async () => {
    await useAuthStore.getState().signOut();
    mockRouteParams.current = { token: 'abcdefghijklmnopqrstuv' };
    await renderWithProviders(<ClaimRoute />, { fetchFn: api.fetch });
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/phone'));
    expect(useAuthFlowStore.getState().claimToken).toBe('abcdefghijklmnopqrstuv');
  });
});
