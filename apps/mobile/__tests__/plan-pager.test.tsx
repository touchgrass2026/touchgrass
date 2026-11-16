import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { EventDetail } from '@touchgrass/shared';
import { AccessibilityInfo, Dimensions, Share, StyleSheet } from 'react-native';
import EventScreen from '../app/(app)/events/[id]/index';
import PlansScreen from '../app/(app)/(tabs)/plans';
import { pageAt, pagerMetrics } from '../components/plan-pager/PlanPager';
import { openPlan, siblingIds } from '../src/features/events/open-plan';
import { useAuthStore } from '../src/stores/auth-store';
import { browseContextFor, MAX_BROWSE_CONTEXTS, useBrowseStore } from '../src/stores/browse-store';
import { authResponseFixture, FakeApi, ids } from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const PLAN = (n: number): string => `0192f3a4-5b6c-7d8e-9f01-00000000e00${String(n)}`;

function plan(n: number, overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: PLAN(n),
    slug: `Deck000${String(n)}`,
    type: 'plan',
    status: 'published',
    title: `Plan number ${String(n)}`,
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
    accessibility: { stepFree: false, accessibleRestroom: false, quietSpace: false },
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
    },
    description: 'Bring water.',
    hosts: [
      {
        person: {
          id: ids.other,
          displayName: 'Rohan K.',
          photo: null,
          verified: true,
          mutualFriendCount: 0,
        },
        role: 'host',
      },
    ],
    interests: [],
    vibeTags: [],
    minGroupSize: 2,
    allowPlusOnes: false,
    chatEnabled: true,
    balancedMaxSharePct: null,
    soloPercent: 50,
    cancelledReason: null,
    shareUrl: `http://web.test/e/Deck000${String(n)}`,
    refundPolicy: null,
    perks: [],
    lore: null,
    crew: null,
    held: false,
    friendsGoing: { people: [], total: 0 },
    ...overrides,
  };
}

let api: FakeApi;
beforeEach(async () => {
  resetStores();
  jest.clearAllMocks();
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
  api = new FakeApi();
  for (const n of [1, 2, 3, 4])
    api.on('GET', `/v1/events/${PLAN(n)}`, { status: 200, body: plan(n) });
});

/** Opens the plan screen the way a row does: stores the row and routes with its key. */
function openFromRow(id: string, row: string[], feed?: { requestId: string }): void {
  openPlan(mockRouter, id, row, {
    feed: feed ? { requestId: feed.requestId, positionOf: (pid) => row.indexOf(pid) + 10 } : null,
  });
  const call = mockRouter.push.mock.calls.at(-1)?.[0] as { params: Record<string, string> };
  mockRouteParams.current = call.params;
}

describe('browse store and openPlan (D-219)', () => {
  it('keeps each row under its own key and drops the oldest past the limit', () => {
    const store = useBrowseStore.getState();
    const first = store.open({ ids: [PLAN(1), PLAN(2)], index: 0 });
    const second = store.open({ ids: [PLAN(2), PLAN(3)], index: 1 });
    expect(first).not.toBe(second);
    expect(browseContextFor(first, PLAN(2))?.ids).toEqual([PLAN(1), PLAN(2)]);
    expect(browseContextFor(second, PLAN(3))?.index).toBe(1);
    // A plan that isn't in the row, a missing key or no key: no deck.
    expect(browseContextFor(first, PLAN(3))).toBeNull();
    expect(browseContextFor('b999', PLAN(1))).toBeNull();
    expect(browseContextFor(undefined, PLAN(1))).toBeNull();
    for (let i = 0; i < MAX_BROWSE_CONTEXTS; i += 1)
      useBrowseStore.getState().open({ ids: [PLAN(1), PLAN(2)], index: 0 });
    expect(browseContextFor(first, PLAN(1))).toBeNull();
    expect(Object.keys(useBrowseStore.getState().contexts)).toHaveLength(MAX_BROWSE_CONTEXTS);
  });

  it('a lone plan has no deck', () => {
    const key = useBrowseStore.getState().open({ ids: [PLAN(1)], index: 0 });
    expect(browseContextFor(key, PLAN(1))).toBeNull();
  });

  it('opens a plan with its row, or on its own without one', () => {
    openPlan(mockRouter, PLAN(2), [{ id: PLAN(1) }, { id: PLAN(2) }, { id: PLAN(1) }, PLAN(3)]);
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/events/[id]',
      params: { id: PLAN(2), browse: 'b1' },
    });
    expect(useBrowseStore.getState().contexts.b1).toEqual({
      ids: [PLAN(1), PLAN(2), PLAN(3)],
      index: 1,
      feed: null,
    });
    openPlan(mockRouter, PLAN(1));
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/events/[id]',
      params: { id: PLAN(1) },
    });
    // Only itself in the row, or not in the row at all: on its own.
    openPlan(mockRouter, PLAN(1), [PLAN(1)]);
    openPlan(mockRouter, PLAN(4), [PLAN(1), PLAN(2)]);
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/events/[id]',
      params: { id: PLAN(4) },
    });
    expect(Object.keys(useBrowseStore.getState().contexts)).toEqual(['b1']);
  });

  it('remembers feed positions for click logging', () => {
    openPlan(mockRouter, PLAN(1), [PLAN(1), PLAN(2)], {
      feed: { requestId: 'req-1', positionOf: (id) => (id === PLAN(1) ? 4 : null) },
    });
    expect(useBrowseStore.getState().contexts.b1?.feed).toEqual({
      requestId: 'req-1',
      positions: [4, null],
    });
  });

  it('dedupes sibling ids and computes pages', () => {
    expect(siblingIds('a', ['a', { id: 'b' }, 'a'])).toEqual(['a', 'b']);
    expect(siblingIds('z', ['a', 'b'])).toEqual([]);
    expect(pagerMetrics(390)).toEqual({ cardWidth: 342, step: 350 });
    expect(pageAt(700, 350, 5)).toBe(2);
    expect(pageAt(520, 350, 5)).toBe(1);
    expect(pageAt(-20, 350, 5)).toBe(0);
    expect(pageAt(9999, 350, 5)).toBe(4);
    expect(pageAt(100, 0, 5)).toBe(0);
  });
});

describe('Plans tab opens plans with their row', () => {
  it('records the upcoming row and the tapped plan', async () => {
    api.on('GET', '/v1/events/mine', (c) => {
      const scope = new URL(c.url).searchParams.get('scope');
      const items =
        scope === 'upcoming'
          ? [plan(1), plan(2), plan(3)].map((p) => ({
              ...p,
              viewer: { ...p.viewer, rsvp: 'going' },
            }))
          : [];
      return { status: 200, body: { items, nextCursor: null } };
    });
    await renderWithProviders(<PlansScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('tile-mine-upcoming-Deck0003'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]',
      params: { id: PLAN(3), browse: 'b1' },
    });
    // "Next up" and the Upcoming rail are one row.
    expect(useBrowseStore.getState().contexts.b1).toMatchObject({
      ids: [PLAN(1), PLAN(2), PLAN(3)],
      index: 2,
    });
  });
});

describe('Plan deck (D-219)', () => {
  const step = pagerMetrics(Dimensions.get('window').width).step;

  it('starts at the tapped plan with only that card fully shown', async () => {
    openFromRow(PLAN(2), [PLAN(1), PLAN(2), PLAN(3)]);
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Plan number 2')).toBeOnTheScreen();
    expect(screen.getByTestId('plan-pager')).toBeOnTheScreen();
    expect(screen.getByTestId('plan-pager-position')).toHaveTextContent('Plan 2 of 3');
    // One set of plan controls: the neighbours only preview their top and are hidden from screen readers.
    expect(screen.getAllByTestId('event-detail')).toHaveLength(1);
    expect(screen.getAllByTestId('pull-up')).toHaveLength(1);
    expect(screen.getByTestId('plan-card-action')).toContainElement(screen.getByTestId('pull-up'));
    await waitFor(() =>
      expect(
        screen.getAllByTestId('plan-card-preview', { includeHiddenElements: true }).length,
      ).toBeGreaterThan(0),
    );
    expect(screen.queryByText('Plan number 3')).toBeNull();
    expect(screen.getByText('Plan number 3', { includeHiddenElements: true })).toBeTruthy();
    // The cover sits above the sheet; the hero inside it doesn't repeat it, and Share moved to the top bar.
    expect(screen.getByTestId('event-art')).toBeOnTheScreen();
    expect(screen.queryByTestId('share')).toBeNull();
    // The neighbours load ahead of time (±1); the rest wait.
    await waitFor(() => expect(api.callsTo('GET', `/v1/events/${PLAN(1)}`)).toHaveLength(1));
    expect(api.callsTo('GET', `/v1/events/${PLAN(3)}`)).toHaveLength(1);
    expect(api.callsTo('GET', `/v1/events/${PLAN(4)}`)).toHaveLength(0);
  });

  it('Next and Previous move the visible plan, update the route and announce it', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    openFromRow(PLAN(2), [PLAN(1), PLAN(2), PLAN(3)]);
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await screen.findByText('Plan number 2');
    expect(screen.getByRole('button', { name: 'Next plan' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('plan-pager-next'));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ id: PLAN(3) });
    expect(announce).toHaveBeenLastCalledWith('Plan 3 of 3');
    expect(await screen.findByText('Plan number 3')).toBeOnTheScreen();
    expect(screen.getByTestId('plan-pager-position')).toHaveTextContent('Plan 3 of 3');
    expect(screen.getAllByTestId('pull-up')).toHaveLength(1);
    // The last plan: Next is disabled.
    expect(screen.getByTestId('plan-pager-next')).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Previous plan' }));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ id: PLAN(2) });
    expect(announce).toHaveBeenLastCalledWith('Plan 2 of 3');
    expect(await screen.findByText('Plan number 2')).toBeOnTheScreen();
    expect(screen.getByTestId('plan-pager-prev')).toBeEnabled();
    // The screen stayed mounted: the route param moved along instead of a new push.
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('swiping settles on the next plan and logs a feed click for it', async () => {
    openFromRow(PLAN(1), [PLAN(1), PLAN(2), PLAN(3)], { requestId: 'req-9' });
    api.on('POST', '/v1/discover/clicks', { status: 204 });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await screen.findByText('Plan number 1');
    await fireEvent(screen.getByTestId('plan-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: step, y: 0 } },
    });
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ id: PLAN(2) });
    expect(await screen.findByText('Plan number 2')).toBeOnTheScreen();
    await waitFor(() =>
      expect(api.callsTo('POST', '/v1/discover/clicks')[0]?.body).toEqual({
        requestId: 'req-9',
        eventId: PLAN(2),
        position: 11,
      }),
    );
    // A swipe that lands back on the same card changes nothing.
    await fireEvent(screen.getByTestId('plan-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: step + 20, y: 0 } },
    });
    expect(mockRouter.setParams).toHaveBeenCalledTimes(1);
  });

  it('screen readers can step through plans with the adjustable position', async () => {
    openFromRow(PLAN(1), [PLAN(1), PLAN(2)]);
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await screen.findByText('Plan number 1');
    // The first plan: nothing before it.
    expect(screen.getByTestId('plan-pager-prev')).toBeDisabled();
    const position = screen.getByTestId('plan-pager-position');
    expect(position.props.accessibilityRole).toBe('adjustable');
    expect(position.props.accessibilityLabel).toBe('Plans in this row');
    expect(position.props.accessibilityValue).toEqual({ text: 'Plan 1 of 2' });
    expect(position.props.accessibilityHint).toContain('Swipe left or right');
    await act(() => {
      position.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    });
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ id: PLAN(2) });
    expect(await screen.findByText('Plan number 2')).toBeOnTheScreen();
    await act(() => {
      screen
        .getByTestId('plan-pager-position')
        .props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    });
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ id: PLAN(1) });
  });

  it('closes with the chevron and shares from the top bar', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    openFromRow(PLAN(1), [PLAN(1), PLAN(2)]);
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await screen.findByText('Plan number 1');
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(share).toHaveBeenCalledWith({
      message: expect.stringContaining('http://web.test/e/Deck0001') as string,
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Close plan' }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('Pull up works from the pinned button of the visible plan', async () => {
    api.on('PUT', `/v1/events/${PLAN(2)}/rsvp`, {
      status: 200,
      body: { status: 'going', waitlistPosition: null, plusOneClaimUrl: null },
    });
    openFromRow(PLAN(2), [PLAN(1), PLAN(2)]);
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await screen.findByText('Plan number 2');
    await fireEvent.press(screen.getByTestId('pull-up'));
    await waitFor(() => expect(api.callsTo('PUT', `/v1/events/${PLAN(2)}/rsvp`)).toHaveLength(1));
    expect(api.callsTo('PUT', `/v1/events/${PLAN(1)}/rsvp`)).toHaveLength(0);
  });

  it('neighbours shrink and dim, but stay still under Reduce Motion', async () => {
    openFromRow(PLAN(1), [PLAN(1), PLAN(2)]);
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await screen.findByText('Plan number 1');
    const frame = (i: number) =>
      StyleSheet.flatten(
        screen.getByTestId(`plan-card-frame-${String(i)}`, { includeHiddenElements: true }).props
          .style,
      ) as { transform?: { scale: number }[]; opacity?: number };
    await waitFor(() => expect(frame(1).transform?.[0]?.scale).toBeCloseTo(0.94));
    expect(frame(0).transform?.[0]?.scale).toBe(1);
  });

  it('under Reduce Motion the cards keep full size and moves jump', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    openFromRow(PLAN(1), [PLAN(1), PLAN(2)]);
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await screen.findByText('Plan number 1');
    const frame = () =>
      StyleSheet.flatten(
        screen.getByTestId('plan-card-frame-1', { includeHiddenElements: true }).props.style,
      ) as { transform?: { scale: number }[]; opacity?: number };
    await waitFor(() => expect(frame().transform?.[0]?.scale).toBe(1));
    expect(frame().opacity).toBe(1);
    await fireEvent.press(screen.getByTestId('plan-pager-next'));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ id: PLAN(2) });
    expect(await screen.findByText('Plan number 2')).toBeOnTheScreen();
  });

  it('without a row (deep link, notification, share link) shows the single plan as before', async () => {
    mockRouteParams.current = { id: PLAN(1) };
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Plan number 1')).toBeOnTheScreen();
    expect(screen.queryByTestId('plan-pager')).toBeNull();
    expect(screen.getByTestId('share')).toBeOnTheScreen();
    expect(screen.getByTestId('pull-up')).toBeOnTheScreen();
  });

  it('a stale row key falls back to the single plan', async () => {
    mockRouteParams.current = { id: PLAN(1), browse: 'b42' };
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Plan number 1')).toBeOnTheScreen();
    expect(screen.queryByTestId('plan-pager')).toBeNull();
  });
});
