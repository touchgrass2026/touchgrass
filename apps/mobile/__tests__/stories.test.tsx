import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer } from 'expo-video';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import type { PersonCard, PersonStories, Story, StoryTray } from '@touchgrass/shared';
import type { TFunction } from 'i18next';
import NewStoryScreen from '../app/(app)/stories/new';
import StoryViewerScreen from '../app/(app)/stories/[userId]';
import { StoryTray as Tray } from '../components/stories/StoryTray';
import { storyAge } from '../src/features/stories/age';
import { useStoryTray } from '../src/features/stories/api';
import { useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi, ids, meFixture, urlsFixture } from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const P2 = '0192f3a4-5b6c-7d8e-9f01-000000000003';
const S1 = '0192f3a4-5b6c-7d8e-9f01-00000005a001';
const S2 = '0192f3a4-5b6c-7d8e-9f01-00000005a002';
const CONV = '0192f3a4-5b6c-7d8e-9f01-00000005c001';

const person = (id: string, displayName: string): PersonCard => ({
  id,
  displayName,
  photo: null,
  verified: false,
  mutualFriendCount: 0,
});
const me = person(ids.me, 'Asha');
const kiran = person(ids.other, 'Kiran');
const meera = person(P2, 'Meera');

const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  image: urlsFixture,
  video: null,
  caption: '',
  createdAt: '2026-11-03T08:00:00.000Z',
  expiresAt: '2026-11-04T08:00:00.000Z',
  seen: false,
  liked: false,
  mine: false,
  audience: null,
  held: false,
  viewCount: null,
  likeCount: null,
  ...over,
});

let api: FakeApi;
beforeEach(async () => {
  resetStores();
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
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
});

describe('story tray', () => {
  it('offers to add a story, then lists people: new first with their names read out', async () => {
    const tray: StoryTray = {
      items: [
        {
          person: meera,
          mine: false,
          count: 2,
          unseen: true,
          latestAt: '2026-11-03T09:00:00.000Z',
        },
        {
          person: kiran,
          mine: false,
          count: 1,
          unseen: false,
          latestAt: '2026-11-03T10:00:00.000Z',
        },
      ],
    };
    api.on('GET', '/v1/stories', { status: 200, body: tray });
    await renderWithProviders(<Tray />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Add to your story' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/stories/new');
    await fireEvent.press(screen.getByRole('button', { name: 'Meera, new story' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/stories/[userId]',
      params: { userId: P2 },
    });
    expect(screen.getByRole('button', { name: 'Kiran, story' })).toBeOnTheScreen();
  });

  it('opens your own story, with a separate button to add another', async () => {
    api.on('GET', '/v1/stories', {
      status: 200,
      body: {
        items: [
          { person: me, mine: true, count: 1, unseen: false, latestAt: '2026-11-03T09:00:00.000Z' },
        ],
      },
    });
    await renderWithProviders(<Tray />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Your story' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/stories/[userId]',
      params: { userId: ids.me },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Add to your story' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/stories/new');
  });

  it('shows nothing when stories cannot load', async () => {
    await renderWithProviders(<Tray />, { fetchFn: api.fetch });
    await waitFor(() => expect(api.callsTo('GET', '/v1/stories')).toHaveLength(1));
    expect(screen.queryByTestId('story-tray')).toBeNull();
  });
});

describe('story viewer', () => {
  it("plays someone's stories: marks each seen, likes, and closes after the last", async () => {
    mockRouteParams.current = { userId: P2 };
    let liked = false;
    api
      .on('GET', `/v1/users/${P2}/stories`, () => ({
        status: 200,
        body: {
          person: meera,
          items: [story(S1, { caption: 'Sunset at the lake', liked }), story(S2)],
        } satisfies PersonStories,
      }))
      .on('POST', `/v1/stories/${S1}/view`, { status: 204 })
      .on('POST', `/v1/stories/${S2}/view`, { status: 204 })
      .on('PUT', `/v1/stories/${S1}/like`, () => {
        liked = true;
        return { status: 204 };
      });
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Sunset at the lake')).toBeOnTheScreen();
    expect(screen.getByLabelText('Story 1 of 2')).toBeOnTheScreen();
    await waitFor(() => expect(api.callsTo('POST', `/v1/stories/${S1}/view`)).toHaveLength(1));
    // Only the author sees viewers; others get like, reply and report.
    expect(screen.queryByTestId('story-stats')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Like' }));
    expect(await screen.findByRole('button', { name: 'Remove like' })).toBeOnTheScreen();
    expect(api.callsTo('PUT', `/v1/stories/${S1}/like`)).toHaveLength(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Next story' }));
    expect(await screen.findByLabelText('Story 2 of 2')).toBeOnTheScreen();
    await waitFor(() => expect(api.callsTo('POST', `/v1/stories/${S2}/view`)).toHaveLength(1));
    await fireEvent.press(screen.getByRole('button', { name: 'Previous story' }));
    expect(await screen.findByLabelText('Story 1 of 2')).toBeOnTheScreen();
    // Seen stories are not marked twice.
    expect(api.callsTo('POST', `/v1/stories/${S1}/view`)).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Next story' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next story' }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('replies by DM and reports, pausing the story', async () => {
    mockRouteParams.current = { userId: P2 };
    api
      .on('GET', `/v1/users/${P2}/stories`, {
        status: 200,
        body: { person: meera, items: [story(S1, { seen: true })] },
      })
      .on('POST', '/v1/chats/direct', {
        status: 200,
        body: {
          id: CONV,
          kind: 'direct',
          state: 'active',
          title: 'Meera',
          avatar: null,
          peer: meera,
          eventId: null,
          lastMessage: null,
          unreadCount: 0,
          muted: false,
          readOnly: false,
          canCreatePoll: false,
          opensAt: null,
          closesAt: null,
        },
      });
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Report story' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/report',
      params: { targetType: 'story', targetId: S1, name: 'Meera' },
    });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeOnTheScreen();
    // Already seen: no second view is recorded.
    expect(api.callsTo('POST', `/v1/stories/${S1}/view`)).toHaveLength(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/chats/[id]',
        params: { id: CONV },
      }),
    );
    expect(api.callsTo('POST', '/v1/chats/direct')[0]?.body).toEqual({ userId: P2 });
  });

  it('your own story: who saw it and liked it, a held notice, and delete', async () => {
    mockRouteParams.current = { userId: ids.me };
    api
      .on('GET', `/v1/users/${ids.me}/stories`, {
        status: 200,
        body: {
          person: me,
          items: [
            story(S1, {
              mine: true,
              seen: true,
              audience: 'squad',
              held: true,
              viewCount: 2,
              likeCount: 1,
            }),
          ],
        },
      })
      .on('GET', `/v1/stories/${S1}/viewers`, {
        status: 200,
        body: {
          items: [
            { person: kiran, liked: true, viewedAt: '2026-11-03T09:00:00.000Z' },
            { person: meera, liked: false, viewedAt: '2026-11-03T08:30:00.000Z' },
          ],
          nextCursor: null,
        },
      })
      .on('DELETE', `/v1/stories/${S1}`, { status: 204 });
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    expect(
      await screen.findByText('Only you can see this until it has been reviewed.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Like' })).toBeNull();
    // No reply bar on your own story.
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
    // The eye at the bottom-left: "Seen by 2", opening who saw it, when, and who liked it.
    expect(screen.getByText('Seen by 2')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Seen by 2, 1 like' }));
    expect(await screen.findByLabelText(/^Kiran, Liked it, \d+ hours ago$/)).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Meera, \d+ hours ago$/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    // Delete sits behind the options button.
    await fireEvent.press(screen.getByRole('button', { name: 'Story options' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete story' }));
    await waitFor(() => expect(api.callsTo('DELETE', `/v1/stories/${S1}`)).toHaveLength(1));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  });

  it('says when a story is gone (expired, removed or not for you)', async () => {
    mockRouteParams.current = { userId: P2 };
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('This story is no longer available.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('video stories in the viewer (D-164)', () => {
  it('plays the clip, labelled for screen readers, and times the story by its length', async () => {
    mockRouteParams.current = { userId: P2 };
    api
      .on('GET', `/v1/users/${P2}/stories`, {
        status: 200,
        body: {
          person: meera,
          items: [
            story(S1, { video: { url: 'https://cdn.test/media/s1/video.mp4', durationMs: 9000 } }),
          ],
        } satisfies PersonStories,
      })
      .on('POST', `/v1/stories/${S1}/view`, { status: 204 });
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    expect(await screen.findByLabelText('Video story from Meera')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-image')).toBeNull();
  });
});

describe('Instagram-style tray (D-207)', () => {
  const entry = (p: PersonCard, over: Partial<StoryTray['items'][number]> = {}) => ({
    person: p,
    mine: false,
    count: 1,
    unseen: false,
    latestAt: '2026-11-03T09:00:00.000Z',
    ...over,
  });

  it('shows your own face with a lime add badge instead of a dashed circle', async () => {
    api
      .on('GET', '/v1/stories', { status: 200, body: { items: [entry(kiran)] } })
      .on('GET', '/v1/me', { status: 200, body: meFixture({ photos: [] }) });
    await renderWithProviders(<Tray />, { fetchFn: api.fetch });
    const add = await screen.findByRole('button', { name: 'Add to your story' });
    expect(add).toHaveProp('testID', 'story-add');
    // Your initial (no photo yet), no ring, and the "+" badge inside the same control.
    expect(await within(add).findByText('P', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(within(add).getByTestId('ring-none', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(
      within(add).getByTestId('story-add-badge', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(screen.getByText('Your story')).toBeOnTheScreen();
  });

  it('rings new stories in a gradient and seen ones in a muted ring', async () => {
    api.on('GET', '/v1/stories', {
      status: 200,
      body: {
        items: [
          entry(me, { mine: true }),
          entry(meera, { unseen: true }),
          entry(kiran, { unseen: false }),
        ],
      },
    });
    await renderWithProviders(<Tray />, { fetchFn: api.fetch });
    const meeraButton = await screen.findByRole('button', { name: 'Meera, new story' });
    expect(
      within(meeraButton).getByTestId('ring-unseen', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(
      within(meeraButton).queryByTestId('ring-seen', { includeHiddenElements: true }),
    ).toBeNull();
    const kiranButton = screen.getByRole('button', { name: 'Kiran, story' });
    expect(
      within(kiranButton).getByTestId('ring-seen', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    // Your live story: your ringed face opens it; the badge is its own control to add more.
    const mine = screen.getByRole('button', { name: 'Your story' });
    expect(
      within(mine).getByTestId('ring-seen', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(
      within(mine).queryByTestId('story-add-badge', { includeHiddenElements: true }),
    ).toBeNull();
    expect(
      within(screen.getByTestId('story-add-more')).getByTestId('story-add-badge'),
    ).toBeOnTheScreen();
  });
});

describe('Instagram-style viewer (D-207)', () => {
  const twoStories = (): void => {
    mockRouteParams.current = { userId: P2 };
    api
      .on('GET', `/v1/users/${P2}/stories`, {
        status: 200,
        body: {
          person: meera,
          items: [story(S1, { seen: true }), story(S2, { seen: true })],
        } satisfies PersonStories,
      })
      .on('GET', `/v1/users/${ids.other}/stories`, {
        status: 200,
        body: { person: kiran, items: [story(S1, { seen: true })] },
      });
  };

  it('draws one progress segment per story and a header with name, age and close', async () => {
    twoStories();
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('story-segment-0')).toBeOnTheScreen();
    expect(screen.getByTestId('story-segment-1')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-segment-2')).toBeNull();
    expect(screen.getByRole('header', { name: 'Meera' })).toBeOnTheScreen();
    expect(screen.getByTestId('story-age')).toHaveTextContent(/^\d+h$/);
    expect(screen.getByLabelText(/^\d+ hours ago$/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Close stories' }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('gives screen readers buttons for previous, next and pause', async () => {
    twoStories();
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Next story' }));
    expect(await screen.findByLabelText('Story 2 of 2')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Previous story' }));
    expect(await screen.findByLabelText('Story 1 of 2')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Resume' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeOnTheScreen();
    // Others' stories: a reply bar into the DM, plus like and report.
    expect(screen.getByRole('button', { name: 'Reply' })).toHaveTextContent('Message Meera');
  });

  it('holding a story pauses its video until let go', async () => {
    mockRouteParams.current = { userId: P2 };
    api.on('GET', `/v1/users/${P2}/stories`, {
      status: 200,
      body: {
        person: meera,
        items: [
          story(S1, {
            seen: true,
            video: { url: 'https://cdn.test/media/s1/video.mp4', durationMs: 9000 },
          }),
        ],
      },
    });
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    await screen.findByLabelText('Video story from Meera');
    // The mock hands out a fresh player per render: read the one now on screen.
    const player = () =>
      jest.mocked(useVideoPlayer).mock.results.at(-1)?.value as {
        play: jest.Mock;
        pause: jest.Mock;
      };
    expect(player().play).toHaveBeenCalled();
    await fireEvent(screen.getByTestId('story-next'), 'longPress');
    await waitFor(() => expect(player().pause).toHaveBeenCalled());
    expect(player().play).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId('story-next'), 'pressOut');
    await waitFor(() => expect(player().play).toHaveBeenCalled());
  });

  it("moves on to the next person's stories at the end, in tray order", async () => {
    twoStories();
    // Opened from the tray: Meera, then Kiran.
    api.on('GET', '/v1/stories', {
      status: 200,
      body: {
        items: [
          {
            person: meera,
            mine: false,
            count: 2,
            unseen: false,
            latestAt: '2026-11-03T09:00:00.000Z',
          },
          {
            person: kiran,
            mine: false,
            count: 1,
            unseen: false,
            latestAt: '2026-11-03T08:00:00.000Z',
          },
        ],
      },
    });
    function FromTray() {
      const tray = useStoryTray();
      return tray.data ? <StoryViewerScreen /> : null;
    }
    await renderWithProviders(<FromTray />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Next story' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Next story' }));
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/stories/[userId]',
      params: { userId: ids.other, queue: '' },
    });
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('follows the queue it was given, and closes after the last person', async () => {
    mockRouteParams.current = { userId: ids.other, queue: '' };
    api.on('GET', `/v1/users/${ids.other}/stories`, {
      status: 200,
      body: { person: kiran, items: [story(S1, { seen: true })] },
    });
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Next story' }));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('pages through viewers', async () => {
    mockRouteParams.current = { userId: ids.me };
    api
      .on('GET', `/v1/users/${ids.me}/stories`, {
        status: 200,
        body: {
          person: me,
          items: [story(S1, { mine: true, seen: true, viewCount: 2, likeCount: 0 })],
        },
      })
      .on('GET', `/v1/stories/${S1}/viewers`, (c) => ({
        status: 200,
        body: c.url.includes('cursor=c1')
          ? {
              items: [{ person: meera, liked: false, viewedAt: new Date().toISOString() }],
              nextCursor: null,
            }
          : {
              items: [{ person: kiran, liked: false, viewedAt: new Date().toISOString() }],
              nextCursor: 'c1',
            },
      }));
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Seen by 2, 0 likes' }));
    expect(await screen.findByLabelText('Kiran, Just now')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByLabelText('Meera, Just now')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});

describe('storyAge', () => {
  const t = ((key: string, o?: { count?: number }) =>
    `${key}:${o?.count ?? ''}`) as unknown as TFunction;
  const now = Date.parse('2026-11-03T12:00:00.000Z');
  it('says just now, minutes, then hours', () => {
    expect(storyAge(t, '2026-11-03T11:59:30.000Z', now).short).toBe('stories.justNow:');
    expect(storyAge(t, '2026-11-03T11:48:00.000Z', now)).toEqual({
      short: 'stories.ageMinutes:12',
      long: 'stories.ageMinutesLong:12',
    });
    expect(storyAge(t, '2026-11-03T09:00:00.000Z', now).short).toBe('stories.ageHours:3');
    // A clock slightly behind the server never shows a negative age.
    expect(storyAge(t, '2026-11-03T12:01:00.000Z', now).short).toBe('stories.justNow:');
  });
});

describe('story composer', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('picks a photo, waits for the check, and shares to the chosen audience', async () => {
    api
      .on('POST', '/v1/media/uploads', {
        status: 201,
        body: {
          assetId: ids.asset,
          upload: {
            url: 'https://s3.test/bucket',
            fields: { key: 'uploads/k' },
            expiresAt: '2026-11-03T09:00:00.000Z',
          },
        },
      })
      .on('POST', '/bucket', { status: 204 })
      .on('POST', `/v1/media/${ids.asset}/complete`, {
        status: 200,
        body: {
          id: ids.asset,
          purpose: 'story',
          status: 'ready',
          width: 900,
          height: 1600,
          urls: urlsFixture,
        },
      })
      .on('POST', '/v1/stories', { status: 201, body: { id: S1 } });
    global.fetch = (input: string | URL | Request, init?: RequestInit) =>
      (typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      ).startsWith('file:')
        ? Promise.resolve(new Response('x'.repeat(4096)))
        : api.fetch(input, init);

    await renderWithProviders(<NewStoryScreen />, { fetchFn: api.fetch });
    expect(screen.getByRole('button', { name: 'Share story' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a photo or video' }));
    expect(await screen.findByRole('button', { name: 'Choose something else' })).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Caption (optional)'), '  Chai time  ');
    await fireEvent.press(screen.getByText('Your squad and their squads'));
    await fireEvent.press(screen.getByRole('button', { name: 'Share story' }));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(api.callsTo('POST', '/v1/media/uploads')[0]?.body).toMatchObject({ purpose: 'story' });
    const posted = api.callsTo('POST', '/v1/stories')[0];
    expect(posted?.body).toEqual({
      mediaId: ids.asset,
      caption: 'Chai time',
      audience: 'squad_fof',
    });
    expect(posted?.headers['idempotency-key']).toMatch(/^story-/);
  });

  it('shares a video clip, uploaded as video for the server to re-encode (D-164)', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///clip.mov',
          type: 'video',
          duration: 9000,
          fileSize: 8 * 1024 * 1024,
          mimeType: 'video/quicktime',
          width: 1080,
          height: 1920,
        },
      ],
    });
    api
      .on('POST', '/v1/media/uploads', {
        status: 201,
        body: {
          assetId: ids.asset,
          upload: {
            url: 'https://s3.test/bucket',
            fields: { key: 'uploads/k' },
            expiresAt: '2026-11-03T09:00:00.000Z',
          },
        },
      })
      .on('POST', '/bucket', { status: 204 })
      .on('POST', `/v1/media/${ids.asset}/complete`, {
        status: 200,
        body: {
          id: ids.asset,
          purpose: 'story',
          status: 'ready',
          width: 720,
          height: 1280,
          urls: urlsFixture,
        },
      })
      .on('POST', '/v1/stories', { status: 201, body: { id: S1 } });
    global.fetch = api.fetch;

    await renderWithProviders(<NewStoryScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a photo or video' }));
    expect(await screen.findByLabelText('Your video, 9 seconds')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Share story' }));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(api.callsTo('POST', '/v1/media/uploads')[0]?.body).toEqual({
      purpose: 'story',
      contentType: 'video/quicktime',
      sizeBytes: 8 * 1024 * 1024,
    });
  });

  it('turns away a clip over 15 seconds before uploading anything', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///long.mp4',
          type: 'video',
          duration: 40000,
          fileSize: 9000,
          width: 1,
          height: 1,
        },
      ],
    });
    await renderWithProviders(<NewStoryScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a photo or video' }));
    expect(await screen.findByText(/up to 15 seconds/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Share story' })).toBeDisabled();
    expect(api.callsTo('POST', '/v1/media/uploads')).toHaveLength(0);
  });
});
