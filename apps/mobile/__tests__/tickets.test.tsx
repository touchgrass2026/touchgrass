import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { EventDetail, PlusOneTicket, TicketTransfer } from '@touchgrass/shared';
import * as Linking from 'expo-linking';
import { Share } from 'react-native';
import CheckoutScreen from '../app/(app)/events/[id]/checkout';
import GiftSeatScreen from '../app/(app)/events/[id]/gift';
import EventScreen from '../app/(app)/events/[id]/index';
import TransferScreen from '../app/(app)/events/[id]/transfer';
import PaymentStatusScreen from '../app/(app)/payments/[id]/index';
import TransferOfferScreen from '../app/(app)/transfers/[id]';
import { useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi, ids } from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

/** Paid seats after the sale (D-229): ticket transfers, paid +1s and deposits. */
const EVENT_ID = '0192f3a4-5b6c-7d8e-9f01-00000000e001';
const PAY_ID = '0192f3a4-5b6c-7d8e-9f01-0000000a0001';
const TRANSFER_ID = '0192f3a4-5b6c-7d8e-9f01-0000000c0001';
const CHECKOUT_URL = 'http://web.test/pay/tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const CLAIM_URL = 'http://web.test/claim/claim_abcdefghijklmnopqrstuvwxyz0123456789ABCD';
const host = {
  id: ids.other,
  displayName: 'Ravi K.',
  photo: null,
  verified: true,
  mutualFriendCount: 0,
};
const friend = {
  id: '0192f3a4-5b6c-7d8e-9f01-000000000003',
  displayName: 'Meera',
  photo: null,
  verified: true,
  mutualFriendCount: 2,
};
const me = { id: ids.me, displayName: 'Arjun', photo: null, verified: true, mutualFriendCount: 0 };

function paidEvent(
  viewer: Partial<EventDetail['viewer']> = {},
  overrides: Partial<EventDetail> = {},
): EventDetail {
  return {
    id: EVENT_ID,
    slug: 'AbCd2345',
    type: 'plan',
    status: 'published',
    title: 'Pottery wheel night',
    cover: null,
    startsAt: '2026-11-07T12:30:00.000Z',
    endsAt: '2026-11-07T15:30:00.000Z',
    timezone: 'Asia/Kolkata',
    location: {
      kind: 'exact',
      point: { lat: 17.43, lng: 78.4 },
      address: 'Road 36, Jubilee Hills',
      placeName: 'Clay Studio',
      neighbourhoodName: 'Jubilee Hills',
    },
    visibility: 'public',
    capacity: 12,
    goingCount: 4,
    spotsLeft: 8,
    waitlistCount: 0,
    pricePaise: 50_000,
    soloFriendly: true,
    smallGroup: false,
    mystery: false,
    indoor: true,
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
    description: 'Materials included.',
    hosts: [{ person: host, role: 'host' }],
    interests: [],
    vibeTags: [],
    minGroupSize: 2,
    allowPlusOnes: false,
    chatEnabled: true,
    balancedMaxSharePct: null,
    soloPercent: 50,
    cancelledReason: null,
    shareUrl: 'http://web.test/e/AbCd2345',
    refundPolicy: { kind: 'partial', cutoffHours: 48, partialPct: 50 },
    perks: [],
    lore: null,
    crew: null,
    held: false,
    friendsGoing: { people: [], total: 0 },
    ...overrides,
  };
}

function transfer(over: Partial<TicketTransfer> = {}): TicketTransfer {
  return {
    id: TRANSFER_ID,
    eventId: EVENT_ID,
    eventTitle: 'Pottery wheel night',
    eventStartsAt: '2026-11-07T12:30:00.000Z',
    eventTimezone: 'Asia/Kolkata',
    status: 'pending',
    pricePaise: 0,
    originalPaise: 50_000,
    direction: 'incoming',
    from: friend,
    to: me,
    closesAt: '2026-11-07T12:00:00.000Z',
    createdAt: '2026-11-01T10:00:00.000Z',
    respondedAt: null,
    ...over,
  };
}

let api: FakeApi;
let openURL: jest.SpyInstance;
let share: jest.SpyInstance;
beforeEach(async () => {
  resetStores();
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
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
  api = new FakeApi();
});
afterEach(() => {
  openURL.mockRestore();
  share.mockRestore();
});

describe('paid seat actions on the plan', () => {
  it('a paid ticket holder can transfer it or buy a seat for a friend', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: paidEvent({ rsvp: 'going', canRsvp: false, blockedReason: 'ALREADY_IN' }),
    });
    api.on('GET', `/v1/events/${EVENT_ID}/refund-quote`, {
      status: 200,
      body: {
        paidPaise: 50_000,
        refundPaise: 25_000,
        reason: 'BEFORE_CUTOFF',
        policy: { kind: 'partial', cutoffHours: 48, partialPct: 50 },
      },
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Transfer ticket' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]/transfer',
      params: { id: EVENT_ID },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Buy a seat for a friend' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]/gift',
      params: { id: EVENT_ID },
    });
  });

  it('a popular free plan asking for a deposit opens checkout in deposit mode', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: paidEvent({}, { pricePaise: 0, refundPolicy: null }),
    });
    api.on('PUT', `/v1/events/${EVENT_ID}/rsvp`, {
      status: 403,
      body: {
        error: {
          code: 'NOT_ELIGIBLE',
          message: 'deposit',
          details: { reason: 'DEPOSIT_REQUIRED', amountPaise: 10_000 },
        },
      },
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('pull-up'));
    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        pathname: '/events/[id]/checkout',
        params: { id: EVENT_ID, deposit: '10000' },
      });
    });
  });

  it('deposit checkout explains the deposit and pays it', async () => {
    mockRouteParams.current = { id: EVENT_ID, deposit: '10000' };
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: paidEvent({}, { pricePaise: 0, refundPolicy: null }),
    });
    api.on('GET', '/v1/payments/receipt-email', { status: 200, body: { email: null } });
    api.on('POST', `/v1/events/${EVENT_ID}/deposit-checkout`, {
      status: 201,
      body: {
        kind: 'checkout',
        session: {
          paymentId: PAY_ID,
          status: 'created',
          amountPaise: 10_000,
          holdExpiresAt: new Date(Date.now() + 600_000).toISOString(),
          checkoutUrl: CHECKOUT_URL,
        },
      },
    });
    await renderWithProviders(<CheckoutScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('checkout-deposit')).toHaveTextContent(/₹100 deposit/);
    expect(screen.queryByTestId('use-credit')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Pay ₹100 deposit and pull up' }));
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(CHECKOUT_URL);
    });
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/deposit-checkout`)).toHaveLength(1);
  });
});

describe('ticket transfer (D-229)', () => {
  it('offers the seat to a squad member for free, then shows the pending offer', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: paidEvent({ rsvp: 'going' }),
    });
    api.on('GET', '/v1/social/squad', {
      status: 200,
      body: { items: [friend], nextCursor: null },
    });
    let sent = false;
    api.on('GET', '/v1/ticket-transfers', () => ({
      status: 200,
      body: {
        items: sent ? [transfer({ direction: 'outgoing', from: me, to: friend })] : [],
      },
    }));
    api.on('POST', `/v1/events/${EVENT_ID}/ticket-transfers`, (call) => {
      sent = true;
      return {
        status: 201,
        body: transfer({
          direction: 'outgoing',
          from: me,
          to: friend,
          pricePaise: (call.body as { pricePaise: number }).pricePaise,
        }),
      };
    });
    await renderWithProviders(<TransferScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('transfer-closes')).toHaveTextContent(/check-in opens/);
    // A price above what the seat cost is refused before anything is sent.
    await fireEvent.changeText(screen.getByTestId('transfer-price'), '600');
    expect(screen.getByText('That is more than the seat cost.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Offer your seat to Meera' })).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('transfer-price'), '');
    await fireEvent.press(screen.getByRole('button', { name: 'Offer your seat to Meera' }));
    expect(await screen.findByTestId('transfer-sent')).toHaveTextContent(
      'Offer sent to Meera. The seat stays yours until they accept.',
    );
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/ticket-transfers`)[0]?.body).toEqual({
      toUserId: friend.id,
      pricePaise: 0,
    });
    expect(await screen.findByTestId('transfer-pending')).toHaveTextContent(
      'Waiting for Meera to accept.',
    );
  });

  it('finds a member by name and offers a resale capped at the price', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: paidEvent({ rsvp: 'going' }) });
    api.on('GET', '/v1/social/squad', { status: 200, body: { items: [], nextCursor: null } });
    api.on('GET', '/v1/ticket-transfers', { status: 200, body: { items: [] } });
    api.on('GET', '/v1/discover/search', {
      status: 200,
      body: { events: [], people: [{ ...friend, relationship: 'none' }], venues: [], crews: [] },
    });
    api.on('POST', `/v1/events/${EVENT_ID}/ticket-transfers`, {
      status: 409,
      body: {
        error: {
          code: 'TRANSFER_UNAVAILABLE',
          message: 'closed',
          details: { reason: 'CHECK_IN_OPEN' },
        },
      },
    });
    await renderWithProviders(<TransferScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(await screen.findByTestId('transfer-search'), 'Mee');
    await fireEvent.changeText(screen.getByTestId('transfer-price'), '300');
    await fireEvent.press(await screen.findByRole('button', { name: 'Offer your seat to Meera' }));
    expect(await screen.findByTestId('transfer-error')).toHaveTextContent(
      "Check-in has opened, so seats can't change hands now.",
    );
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/ticket-transfers`)[0]?.body).toEqual({
      toUserId: friend.id,
      pricePaise: 30_000,
    });
  });

  it('a free offer is accepted and opens the plan', async () => {
    mockRouteParams.current = { id: TRANSFER_ID };
    api.on('GET', `/v1/ticket-transfers/${TRANSFER_ID}`, { status: 200, body: transfer() });
    api.on('POST', `/v1/ticket-transfers/${TRANSFER_ID}/accept`, {
      status: 201,
      body: { kind: 'transferred', eventId: EVENT_ID },
    });
    await renderWithProviders(<TransferOfferScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('transfer-offer-body')).toHaveTextContent(
      'Meera is giving you their seat at Pottery wheel night.',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/events/[id]',
        params: { id: EVENT_ID },
      });
    });
  });

  it('a priced offer goes to checkout; saying no to another changes nothing', async () => {
    mockRouteParams.current = { id: TRANSFER_ID };
    api.on('GET', `/v1/ticket-transfers/${TRANSFER_ID}`, {
      status: 200,
      body: transfer({ pricePaise: 30_000 }),
    });
    api.on('POST', `/v1/ticket-transfers/${TRANSFER_ID}/accept`, {
      status: 201,
      body: {
        kind: 'checkout',
        session: {
          paymentId: PAY_ID,
          status: 'created',
          amountPaise: 30_000,
          holdExpiresAt: new Date(Date.now() + 600_000).toISOString(),
          checkoutUrl: CHECKOUT_URL,
        },
      },
    });
    api.on('POST', `/v1/ticket-transfers/${TRANSFER_ID}/decline`, { status: 204 });
    await renderWithProviders(<TransferOfferScreen />, { fetchFn: api.fetch });
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Pay ₹300 and take the seat' }),
    );
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(CHECKOUT_URL);
    });
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/payments/[id]',
      params: { id: PAY_ID, url: CHECKOUT_URL },
    });
  });

  it('saying no shows that nothing changed', async () => {
    mockRouteParams.current = { id: TRANSFER_ID };
    api.on('GET', `/v1/ticket-transfers/${TRANSFER_ID}`, { status: 200, body: transfer() });
    api.on('POST', `/v1/ticket-transfers/${TRANSFER_ID}/decline`, { status: 204 });
    await renderWithProviders(<TransferOfferScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Say no' }));
    expect(await screen.findByTestId('transfer-offer-notice')).toHaveTextContent(
      'You said no. Nothing changed.',
    );
  });
});

describe('paid +1 (D-229)', () => {
  function plusOne(over: Partial<PlusOneTicket> = {}): PlusOneTicket {
    return { paymentId: PAY_ID, status: 'captured', amountPaise: 50_000, holder: null, ...over };
  }

  it('pays for a friend’s seat and keeps the claim link to share', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: paidEvent({ rsvp: 'going' }) });
    let bought = false;
    api.on('GET', `/v1/events/${EVENT_ID}/plus-one-ticket`, () =>
      bought
        ? { status: 200, body: plusOne() }
        : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'none' } } },
    );
    api.on('POST', `/v1/events/${EVENT_ID}/plus-one-checkout`, () => {
      bought = true;
      return {
        status: 201,
        body: {
          claimUrl: CLAIM_URL,
          session: {
            paymentId: PAY_ID,
            status: 'created',
            amountPaise: 50_000,
            holdExpiresAt: new Date(Date.now() + 600_000).toISOString(),
            checkoutUrl: CHECKOUT_URL,
          },
        },
      };
    });
    await renderWithProviders(<GiftSeatScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Pay ₹500' }));
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(CHECKOUT_URL);
    });
    expect(await screen.findByTestId('gift-unclaimed')).toHaveTextContent(
      'Paid. Waiting for your friend to claim it.',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Share the claim link' }));
    expect(share).toHaveBeenCalledWith({
      message: `I got you a seat at Pottery wheel night on TouchGrass. Claim it here: ${CLAIM_URL}`,
    });
  });

  it('shows who claimed the seat (their name is on the ticket)', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: paidEvent({ rsvp: 'going' }) });
    api.on('GET', `/v1/events/${EVENT_ID}/plus-one-ticket`, {
      status: 200,
      body: plusOne({ holder: friend }),
    });
    await renderWithProviders(<GiftSeatScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('gift-claimed')).toHaveTextContent('Meera claimed the seat.');
    expect(screen.queryByRole('button', { name: 'Pay ₹500' })).toBeNull();
  });

  it('a lost link is replaced and shared again', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: paidEvent({ rsvp: 'going' }) });
    api.on('GET', `/v1/events/${EVENT_ID}/plus-one-ticket`, { status: 200, body: plusOne() });
    api.on('POST', `/v1/events/${EVENT_ID}/plus-one-ticket/link`, {
      status: 201,
      body: { claimUrl: CLAIM_URL },
    });
    await renderWithProviders(<GiftSeatScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Get a new link' }));
    await waitFor(() => {
      expect(share).toHaveBeenCalledWith({
        message: `I got you a seat at Pottery wheel night on TouchGrass. Claim it here: ${CLAIM_URL}`,
      });
    });
  });
});

describe('payment disputes (D-229)', () => {
  it('reports a problem with a paid ticket and then shows it is being looked into', async () => {
    mockRouteParams.current = { id: PAY_ID };
    api.on('GET', `/v1/payments/${PAY_ID}`, {
      status: 200,
      body: {
        id: PAY_ID,
        eventId: EVENT_ID,
        eventTitle: 'Pottery wheel night',
        eventStartsAt: '2026-11-07T12:30:00.000Z',
        eventTimezone: 'Asia/Kolkata',
        status: 'captured',
        kind: 'seat',
        amountPaise: 50_000,
        refundedPaise: 0,
        holdExpiresAt: '2026-11-01T10:10:00.000Z',
        capturedAt: '2026-11-01T10:02:00.000Z',
        receiptNumber: 'TG-2026-000123',
        refunds: [],
        createdAt: '2026-11-01T10:00:00.000Z',
      },
    });
    let opened = false;
    const dispute = {
      id: TRANSFER_ID,
      paymentId: PAY_ID,
      eventId: EVENT_ID,
      status: 'open',
      reason: 'NOT_ADMITTED',
      note: '',
      resolutionNote: null,
      createdAt: '2026-11-08T10:00:00.000Z',
      resolvedAt: null,
    };
    api.on('GET', `/v1/payments/${PAY_ID}/dispute`, () => ({
      status: 200,
      body: { dispute: opened ? dispute : null },
    }));
    api.on('POST', `/v1/payments/${PAY_ID}/disputes`, () => {
      opened = true;
      return { status: 201, body: dispute };
    });
    await renderWithProviders(<PaymentStatusScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Report a problem' }));
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled();
    await fireEvent.press(screen.getByTestId('dispute-reason-NOT_ADMITTED'));
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByTestId('dispute-status')).toHaveTextContent('We are looking into it');
    expect(api.callsTo('POST', `/v1/payments/${PAY_ID}/disputes`)[0]?.body).toEqual({
      reason: 'NOT_ADMITTED',
      note: '',
    });
  });
});
