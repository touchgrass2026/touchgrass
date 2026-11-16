import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { EventDetail, EventSummary } from '@touchgrass/shared';
import * as Linking from 'expo-linking';
import EventScreen from '../app/(app)/events/[id]/index';
import WeekendPicksScreen from '../app/(app)/weekend';
import {
  appleDirectionsUrl,
  directionsUrl,
  googleDirectionsUrl,
} from '../src/features/events/directions';
import { pushPath } from '../src/features/notifications/push-links';
import { useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi, ids } from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const EVENT_ID = '0192f3a4-5b6c-7d8e-9f01-00000021e001';
const PICK_2 = '0192f3a4-5b6c-7d8e-9f01-00000021e002';
const SPOT = { lat: 17.4126, lng: 78.4482 };
const GOOGLE = `https://www.google.com/maps/dir/?api=1&destination=17.4126,78.4482`;

const exact = {
  kind: 'exact' as const,
  point: SPOT,
  address: 'Road No. 1, Banjara Hills',
  placeName: 'Lamakaan',
  neighbourhoodName: 'Banjara Hills',
};
const hidden = {
  kind: 'approximate' as const,
  center: { lat: 17.42, lng: 78.44 },
  radiusMeters: 2000,
  neighbourhoodName: 'Banjara Hills',
  revealsAt: '2026-11-21T12:30:00.000Z',
  hiddenBy: 'mystery' as const,
};

function summary(over: Partial<EventSummary> = {}): EventSummary {
  return {
    host: { topHost: false },
    id: EVENT_ID,
    slug: 'Wknd2345',
    type: 'plan',
    status: 'published',
    title: 'Open mic',
    cover: null,
    startsAt: '2026-11-21T13:30:00.000Z',
    endsAt: '2026-11-21T15:30:00.000Z',
    timezone: 'Asia/Kolkata',
    location: exact,
    visibility: 'public',
    capacity: 20,
    goingCount: 6,
    spotsLeft: 14,
    waitlistCount: 0,
    pricePaise: 0,
    soloFriendly: true,
    smallGroup: false,
    mystery: false,
    indoor: true,
    accessibility: { stepFree: false, accessibleRestroom: false, quietSpace: false },
    category: null,
    viewer: {
      rsvp: 'going',
      isHost: false,
      hostRole: null,
      invitedBy: null,
      offer: null,
      plusOne: null,
      waitlistPosition: null,
      canRsvp: false,
      blockedReason: 'ALREADY_IN',
      canCheckIn: false,
      payment: null,
      cooldownUntil: null,
    },
    ...over,
  };
}

function detail(over: Partial<EventDetail> = {}): EventDetail {
  return {
    friendsGoing: { people: [], total: 0 },
    ...summary(),
    description: 'Bring a poem.',
    hosts: [],
    interests: [],
    vibeTags: [],
    minGroupSize: 2,
    allowPlusOnes: false,
    chatEnabled: false,
    balancedMaxSharePct: null,
    soloPercent: 40,
    cancelledReason: null,
    shareUrl: 'http://web.test/e/Wknd2345',
    refundPolicy: null,
    perks: [],
    lore: null,
    crew: null,
    held: false,
    ...over,
  };
}

let api: FakeApi;
let openURL: jest.SpyInstance;
let canOpenURL: jest.SpyInstance;

beforeEach(async () => {
  resetStores();
  mockRouter.push.mockClear();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  canOpenURL = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
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
  api = new FakeApi().on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: detail() });
});
afterEach(() => {
  openURL.mockRestore();
  canOpenURL.mockRestore();
});

describe('directions (D-211)', () => {
  it('builds Google Maps directions; Apple Maps only on iOS without Google Maps', async () => {
    expect(googleDirectionsUrl(SPOT)).toBe(GOOGLE);
    expect(await directionsUrl(SPOT, 'Lamakaan', 'android')).toBe(GOOGLE);
    expect(canOpenURL).not.toHaveBeenCalled();
    expect(await directionsUrl(SPOT, 'Lamakaan', 'ios')).toBe(GOOGLE);
    expect(canOpenURL).toHaveBeenCalledWith('comgooglemaps://');
    canOpenURL.mockResolvedValue(false);
    expect(await directionsUrl(SPOT, 'Lamakaan Café', 'ios')).toBe(
      'https://maps.apple.com/?daddr=17.4126,78.4482&q=Lamakaan%20Caf%C3%A9',
    );
    canOpenURL.mockRejectedValue(new Error('not allowed'));
    expect(await directionsUrl(SPOT, null, 'ios')).toBe(appleDirectionsUrl(SPOT, null));
  });

  it('the plan shows a Directions button that opens maps to the spot', async () => {
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    const button = await screen.findByTestId('event-directions');
    expect(button).toHaveProp('accessibilityLabel', 'Directions to Lamakaan');
    expect(button).toHaveProp('accessibilityRole', 'button');
    await fireEvent.press(button);
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(GOOGLE);
    });
    // Not opened from the reminder: no directions banner at the top.
    expect(screen.queryByTestId('event-directions-ready')).toBeNull();
  });

  it('hides directions for a mystery plan before its reveal, even from the reminder link', async () => {
    mockRouteParams.current = { id: EVENT_ID, directions: '1' };
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: detail({ mystery: true, location: hidden }),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await screen.findByTestId('event-location-hidden');
    expect(screen.queryByTestId('event-directions')).toBeNull();
    expect(screen.queryByTestId('event-directions-ready')).toBeNull();
  });

  it('opened from the starts-soon reminder, directions come first', async () => {
    mockRouteParams.current = { id: EVENT_ID, directions: '1' };
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await screen.findByTestId('event-directions-ready');
    await fireEvent.press(screen.getByTestId('event-directions-top'));
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(GOOGLE);
    });
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('"testID":"event-directions-top"')).toBeLessThan(
      tree.indexOf('"testID":"event-hero"'),
    );
  });

  it('reminder and digest links keep their simple query; anything else is refused', () => {
    expect(pushPath({ url: `touchgrass://events/${EVENT_ID}?directions=1` })).toBe(
      `/events/${EVENT_ID}?directions=1`,
    );
    expect(pushPath({ url: `touchgrass://weekend?ids=${EVENT_ID},${PICK_2}` })).toBe(
      `/weekend?ids=${EVENT_ID},${PICK_2}`,
    );
    expect(pushPath({ url: 'touchgrass://weekend?ids=<script>' })).toBeNull();
    expect(pushPath({ url: 'touchgrass://weekend?ids=a b' })).toBeNull();
    expect(pushPath({ url: 'touchgrass://weekend??x=1' })).toBeNull();
  });
});

describe('This weekend digest screen (D-211)', () => {
  const window = {
    from: '2026-11-20T11:30:00.000Z',
    to: '2026-11-22T18:30:00.000Z',
    timezone: 'Asia/Kolkata',
  };

  it('shows the picks the push named and opens one', async () => {
    mockRouteParams.current = { ids: `${EVENT_ID},${PICK_2}` };
    api.on('GET', '/v1/discover/weekend', {
      status: 200,
      body: {
        items: [
          summary({
            viewer: { ...summary().viewer, rsvp: null, canRsvp: true, blockedReason: null },
          }),
          summary({ id: PICK_2, slug: 'Wknd2346', title: 'Pottery jam' }),
        ],
        ...window,
      },
    });
    await renderWithProviders(<WeekendPicksScreen />, { fetchFn: api.fetch });
    await screen.findByTestId('event-Wknd2345');
    const cards = JSON.stringify(screen.toJSON());
    expect(cards).toContain('Open mic');
    expect(cards).toContain('Pottery jam');
    expect(screen.getByText('This weekend')).toBeOnTheScreen();
    const call = api.callsTo('GET', '/v1/discover/weekend')[0];
    expect(new URL(call?.url ?? '').searchParams.get('ids')).toBe(`${EVENT_ID},${PICK_2}`);
    await fireEvent.press(screen.getByTestId('event-Wknd2346'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]',
      params: { id: PICK_2 },
    });
  });

  it('with nothing left, says so and points to Explore', async () => {
    mockRouteParams.current = {};
    api.on('GET', '/v1/discover/weekend', { status: 200, body: { items: [], ...window } });
    await renderWithProviders(<WeekendPicksScreen />, { fetchFn: api.fetch });
    expect(
      await screen.findByText('No picks left for this weekend. Explore has more plans.'),
    ).toBeOnTheScreen();
    expect(api.callsTo('GET', '/v1/discover/weekend')[0]?.url).not.toContain('ids=');
    await fireEvent.press(screen.getByText('Explore more plans'));
    expect(mockRouter.push).toHaveBeenCalledWith('/discover');
  });

  it('shows an error with retry when the picks fail to load', async () => {
    mockRouteParams.current = {};
    api.on('GET', '/v1/discover/weekend', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'boom' } },
    });
    await renderWithProviders(<WeekendPicksScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('state-error')).toBeOnTheScreen();
  });
});
