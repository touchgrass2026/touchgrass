import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import type { EventDetail, GotHomeStatus, TrustedContact } from '@touchgrass/shared';
import * as ImagePicker from 'expo-image-picker';
import * as SMS from 'expo-sms';
import { captureRef } from 'react-native-view-shot';
import EventStoryScreen from '../app/(app)/events/[id]/story';
import GotHomeScreen from '../app/(app)/safety/got-home/[id]';
import SafetyScreen from '../app/(app)/safety/index';
import { GotHomeSection } from '../components/GotHomeSection';
import { pushPath } from '../src/features/notifications/push-links';
import { useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi, ids, meFixture } from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const EVENT_ID = '0192f3a4-5b6c-7d8e-9f01-00000012e001';
const C1 = '0192f3a4-5b6c-7d8e-9f01-00000012c001';
const C2 = '0192f3a4-5b6c-7d8e-9f01-00000012c002';
const COVER = 'http://media.test/cover-lg.jpg';

let api: FakeApi;

function eventDetail(over: Partial<EventDetail> = {}): EventDetail {
  return {
    id: EVENT_ID,
    slug: 'AbCd2345',
    type: 'plan',
    status: 'published',
    title: 'Sunset run',
    cover: null,
    startsAt: '2026-11-08T00:30:00.000Z',
    endsAt: '2026-11-08T02:30:00.000Z',
    timezone: 'Asia/Kolkata',
    location: {
      kind: 'approximate',
      center: { lat: 17.42, lng: 78.42 },
      radiusMeters: 800,
      neighbourhoodName: 'Jubilee Hills',
      revealsAt: '2026-11-07T22:30:00.000Z',
    },
    visibility: 'public',
    capacity: 10,
    goingCount: 4,
    spotsLeft: 6,
    waitlistCount: 0,
    pricePaise: 0,
    soloFriendly: true,
    smallGroup: false,
    mystery: true,
    indoor: false,
    accessibility: { stepFree: true, accessibleRestroom: false, quietSpace: false },
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
      blockedReason: null,
      canCheckIn: false,
      payment: null,
      cooldownUntil: null,
    },
    description: 'Bring water.',
    hosts: [],
    interests: [],
    vibeTags: [],
    minGroupSize: 2,
    allowPlusOnes: false,
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
    ...over,
  };
}

function status(over: Partial<GotHomeStatus> = {}): GotHomeStatus {
  return {
    eventId: EVENT_ID,
    title: 'Sunset run',
    endsAt: '2026-11-08T16:30:00.000Z',
    timezone: 'Asia/Kolkata',
    late: true,
    requested: false,
    willAsk: true,
    due: true,
    homeAt: null,
    snoozes: 0,
    canSnooze: true,
    askAgainAt: null,
    ...over,
  };
}

const contact = (id: string, name: string, phone: string): TrustedContact => ({ id, name, phone });

beforeEach(async () => {
  resetStores();
  mockRouter.push.mockClear();
  mockRouteParams.current = {};
  jest.mocked(captureRef).mockClear();
  jest.mocked(SMS.sendSMSAsync).mockClear();
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockClear();
  await AsyncStorage.clear();
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
  api = new FakeApi()
    .on('GET', '/v1/me', { status: 200, body: meFixture() })
    .on('POST', '/v1/analytics/events', { status: 202, body: { accepted: 1 } });
});

// ---------- story card backgrounds (D-212) ----------

describe('story card backgrounds (D-212)', () => {
  it('the picker changes the card, and the shared image is the card with that background', async () => {
    mockRouteParams.current = { id: EVENT_ID };
    api.on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: eventDetail() });
    await renderWithProviders(<EventStoryScreen />, { fetchFn: api.fetch });
    const card = await screen.findByTestId('event-story-card');
    // No cover: the plan's artwork, with the scrim so the words read over it.
    expect(within(card).getByTestId('story-backdrop-art')).toBeOnTheScreen();
    expect(within(card).getByTestId('story-scrim')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-bg-cover')).toBeNull();
    expect(screen.getByTestId('story-bg-art')).toBeSelected();

    await fireEvent.press(screen.getByLabelText('Amber to coral'));
    expect(within(card).getByTestId('story-backdrop-gradient-sunset')).toBeOnTheScreen();
    expect(within(card).queryByTestId('story-scrim')).toBeNull();
    expect(screen.getByTestId('story-bg-gradient-sunset')).toBeSelected();
    expect(screen.getByTestId('story-bg-art')).not.toBeSelected();

    await fireEvent.press(screen.getByTestId('story-bg-solid-violet'));
    expect(within(card).getByTestId('story-backdrop-solid-violet')).toBeOnTheScreen();
    expect(within(card).queryByTestId('story-backdrop-gradient-sunset')).toBeNull();
    // The card keeps the plan, its time in the plan's zone, the mystery-safe place and the brand.
    expect(card).toHaveTextContent(/Sunset run/);
    expect(card).toHaveTextContent(/Jubilee Hills/);
    expect(card).toHaveTextContent(/TouchGrass/);

    await fireEvent.press(screen.getByTestId('event-story-share'));
    await waitFor(() => expect(captureRef).toHaveBeenCalledTimes(1));
    // What gets captured is the card (with the chosen background), never the picker under it.
    expect(within(card).queryByTestId('story-bg-picker')).toBeNull();
    expect(within(card).getByTestId('story-backdrop-solid-violet')).toBeOnTheScreen();
  });

  it('starts on the cover photo with a scrim; "Your photo" is picked 9:16 and never uploaded', async () => {
    mockRouteParams.current = { id: EVENT_ID };
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventDetail({ cover: { sm: COVER, md: COVER, lg: COVER } }),
    });
    await renderWithProviders(<EventStoryScreen />, { fetchFn: api.fetch });
    const card = await screen.findByTestId('event-story-card');
    expect(within(card).getByTestId('story-backdrop-photo-cover')).toBeOnTheScreen();
    expect(within(card).getByTestId('story-scrim')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('story-bg-gradient-matcha'));
    expect(within(card).queryByTestId('story-scrim')).toBeNull();

    await fireEvent.press(screen.getByTestId('story-bg-mine'));
    await waitFor(() =>
      expect(within(card).getByTestId('story-backdrop-photo-mine')).toBeOnTheScreen(),
    );
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ aspect: [9, 16], allowsEditing: true }),
    );
    expect(within(card).getByTestId('story-scrim')).toBeOnTheScreen();
    expect(api.calls.some((c) => c.path.startsWith('/v1/media'))).toBe(false);

    // Back to the cover, then share.
    await fireEvent.press(screen.getByTestId('story-bg-cover'));
    expect(within(card).getByTestId('story-backdrop-photo-cover')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('event-story-share'));
    await waitFor(() => expect(captureRef).toHaveBeenCalled());
  });

  it('links back with the sharer’s invite link when they are on the plan', async () => {
    mockRouteParams.current = { id: EVENT_ID };
    api
      .on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: eventDetail() })
      .on('POST', `/v1/events/${EVENT_ID}/invite-links`, {
        status: 201,
        body: { url: 'http://web.test/e/AbCd2345?i=tok123', expiresAt: '2026-11-08T02:30:00.000Z' },
      });
    await renderWithProviders(<EventStoryScreen />, { fetchFn: api.fetch });
    const card = await screen.findByTestId('event-story-card');
    await waitFor(() => expect(card).toHaveTextContent(/web\.test\/e\/AbCd2345\?i=tok123/));
  });

  it('falls back to the public link without an invite link', async () => {
    mockRouteParams.current = { id: EVENT_ID };
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventDetail({ viewer: { ...eventDetail().viewer, rsvp: 'interested' } }),
    });
    await renderWithProviders(<EventStoryScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('event-story-card')).toHaveTextContent(
      /web\.test\/e\/AbCd2345$/,
    );
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/invite-links`)).toHaveLength(0);
  });
});

// ---------- "Got home safe?" (D-212) ----------

describe('"Got home safe?" (D-212)', () => {
  it('the push opens the got-home screen', () => {
    expect(pushPath({ url: `touchgrass://safety/got-home/${EVENT_ID}` })).toBe(
      `/safety/got-home/${EVENT_ID}`,
    );
  });

  it('"I got home" records it and opens a text to every trusted contact', async () => {
    mockRouteParams.current = { id: EVENT_ID };
    api
      .on('GET', `/v1/safety/got-home/${EVENT_ID}`, { status: 200, body: status() })
      .on('GET', '/v1/safety/contacts', {
        status: 200,
        body: {
          items: [contact(C1, 'Amma', '+919876500002'), contact(C2, 'Ravi', '+919876500003')],
        },
      })
      .on('POST', `/v1/safety/got-home/${EVENT_ID}/home`, {
        status: 200,
        body: status({ due: false, willAsk: false, homeAt: '2026-11-08T17:10:00.000Z' }),
      });
    await renderWithProviders(<GotHomeScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Got home safe?')).toBeOnTheScreen();
    await waitFor(() => expect(api.callsTo('GET', '/v1/safety/contacts')).toHaveLength(1));
    await fireEvent.press(screen.getByTestId('got-home-home'));
    await waitFor(() => expect(SMS.sendSMSAsync).toHaveBeenCalledTimes(1));
    expect(SMS.sendSMSAsync).toHaveBeenCalledWith(
      ['+919876500002', '+919876500003'],
      'I got home safe from Sunset run. — sent from TouchGrass',
    );
    expect(api.callsTo('POST', `/v1/safety/got-home/${EVENT_ID}/home`)).toHaveLength(1);
    expect(await screen.findByTestId('got-home-done')).toHaveTextContent(
      'We will not ask again for this plan.',
    );
    // They can send it again (say the composer was closed by mistake).
    await fireEvent.press(screen.getByTestId('got-home-text-again'));
    await waitFor(() => expect(SMS.sendSMSAsync).toHaveBeenCalledTimes(2));
  });

  it('without trusted contacts it offers to add one and texts nobody', async () => {
    mockRouteParams.current = { id: EVENT_ID };
    api
      .on('GET', `/v1/safety/got-home/${EVENT_ID}`, { status: 200, body: status() })
      .on('GET', '/v1/safety/contacts', { status: 200, body: { items: [] } })
      .on('POST', `/v1/safety/got-home/${EVENT_ID}/home`, {
        status: 200,
        body: status({ due: false, homeAt: '2026-11-08T17:10:00.000Z' }),
      });
    await renderWithProviders(<GotHomeScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('got-home-no-contacts')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('got-home-add-contact'));
    expect(mockRouter.push).toHaveBeenCalledWith('/safety/contacts');
    await fireEvent.press(screen.getByTestId('got-home-home'));
    expect(await screen.findByTestId('got-home-done')).toBeOnTheScreen();
    expect(SMS.sendSMSAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId('got-home-no-contacts')).toBeOnTheScreen();
  });

  it('"Not yet" snoozes for 30 minutes; after three it is not offered', async () => {
    mockRouteParams.current = { id: EVENT_ID };
    api
      .on('GET', `/v1/safety/got-home/${EVENT_ID}`, { status: 200, body: status() })
      .on('GET', '/v1/safety/contacts', {
        status: 200,
        body: { items: [contact(C1, 'Amma', '+919876500002')] },
      })
      .on('POST', `/v1/safety/got-home/${EVENT_ID}/snooze`, {
        status: 200,
        body: status({ due: false, snoozes: 1, askAgainAt: '2026-11-08T17:30:00.000Z' }),
      });
    await renderWithProviders(<GotHomeScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('got-home-not-yet'));
    // 17:30 UTC is 11:00 pm in the plan's zone.
    expect(await screen.findByTestId('got-home-snoozed')).toHaveTextContent(
      /We will ask again at 11:00\s?pm\./i,
    );
    expect(SMS.sendSMSAsync).not.toHaveBeenCalled();

    api.on('GET', `/v1/safety/got-home/${EVENT_ID}`, {
      status: 200,
      body: status({ snoozes: 3, canSnooze: false }),
    });
    await renderWithProviders(<GotHomeScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('We will not ask again for this plan.')).toBeOnTheScreen();
    expect(screen.queryByTestId('got-home-not-yet')).toBeNull();
  });

  it('on the plan screen: ask before it ends, answer after it ends', async () => {
    const ends = new Date('2026-11-08T16:30:00.000Z').getTime();
    const going = eventDetail({ endsAt: '2026-11-08T16:30:00.000Z' });
    api
      .on('GET', `/v1/safety/got-home/${EVENT_ID}`, {
        status: 200,
        body: status({ late: false, willAsk: false, due: false, canSnooze: false }),
      })
      .on('POST', `/v1/safety/got-home/${EVENT_ID}/request`, {
        status: 200,
        body: status({ late: false, requested: true, due: false, canSnooze: false }),
      })
      .on('GET', '/v1/safety/contacts', { status: 200, body: { items: [] } });
    await renderWithProviders(<GotHomeSection event={going} now={ends - 3_600_000} />, {
      fetchFn: api.fetch,
    });
    const toggle = await screen.findByTestId('event-got-home-toggle');
    await fireEvent(toggle, 'valueChange', true);
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/safety/got-home/${EVENT_ID}/request`)[0]?.body).toEqual({
        ask: true,
      }),
    );

    api.on('GET', `/v1/safety/got-home/${EVENT_ID}`, { status: 200, body: status() });
    const checkedIn = eventDetail({
      endsAt: '2026-11-08T16:30:00.000Z',
      viewer: { ...going.viewer, rsvp: 'checked_in' },
    });
    await renderWithProviders(<GotHomeSection event={checkedIn} now={ends + 600_000} />, {
      fetchFn: api.fetch,
    });
    expect(await screen.findByTestId('event-got-home-home')).toBeOnTheScreen();
  });

  it('the Safety centre keeps the late-plan ask on the server', async () => {
    let gotHomeCheck = true;
    api
      .on('GET', '/v1/verification', {
        status: 200,
        body: {
          status: 'none',
          verified: false,
          challenge: null,
          submittedAt: null,
          rejectReason: null,
          attemptsLeftToday: 3,
        },
      })
      .on('GET', '/v1/safety/live', { status: 200, body: { share: null } })
      .on('GET', '/v1/safety/contacts', { status: 200, body: { items: [] } })
      .on('GET', '/v1/safety/settings', () => ({ status: 200, body: { gotHomeCheck } }))
      .on('PATCH', '/v1/safety/settings', (call) => {
        gotHomeCheck = (call.body as { gotHomeCheck: boolean }).gotHomeCheck;
        return { status: 200, body: { gotHomeCheck } };
      });
    await renderWithProviders(<SafetyScreen />, { fetchFn: api.fetch });
    const toggle = await screen.findByTestId('safety-got-home-setting');
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toBeChecked();
    expect(screen.getByLabelText('Ask me if I got home after late plans')).toBeOnTheScreen();
    await fireEvent(toggle, 'valueChange', false);
    await waitFor(() => expect(gotHomeCheck).toBe(false));
    await waitFor(() => expect(toggle).not.toBeChecked());
  });
});
