import { act, screen } from '@testing-library/react-native';
import { categoryHues, colors, type EventSummary } from '@touchgrass/shared';
import { type StyleProp, StyleSheet, type ViewStyle } from 'react-native';
import { CategoryPill } from '../components/CategoryPill';
import { categoryLook } from '../components/category';
import { EventCard } from '../components/EventCard';
import { Bowl, Dice, Music } from '../components/icons';
import { GLYPHS, type GlyphName } from '../components/icons/glyphs';
import { PlanArt } from '../components/PlanArt';
import { ClusterBubble, PlanMarker, PlanPinBadge } from '../components/PlanMarker';
import { renderWithProviders } from '../test-utils';

const biryani = {
  id: '0192f3a4-5b6c-7d8e-9f01-0000000000b1',
  slug: 'biryani',
  name: { en: 'Biryani', te: 'బిర్యానీ', hi: 'बिरयानी' },
  emoji: '',
  category: 'food',
};

function event(overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    id: '0192f3a4-5b6c-7d8e-9f01-00000000e001',
    slug: 'Slug0001',
    type: 'plan',
    status: 'published',
    title: 'Biryani crawl',
    cover: null,
    startsAt: '2026-11-03T12:30:00.000Z',
    endsAt: '2026-11-03T14:30:00.000Z',
    timezone: 'Asia/Kolkata',
    location: {
      kind: 'exact',
      point: { lat: 17.44, lng: 78.35 },
      address: 'Lake Road',
      placeName: 'Lake View Park',
      neighbourhoodName: 'Gachibowli',
    },
    visibility: 'public',
    capacity: 10,
    goingCount: 5,
    spotsLeft: 5,
    waitlistCount: 0,
    pricePaise: 0,
    soloFriendly: false,
    smallGroup: false,
    mystery: false,
    indoor: true,
    accessibility: { stepFree: false, accessibleRestroom: false, quietSpace: false },
    category: biryani,
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
    ...overrides,
  };
}

/** Pins and tags are decorative inside their labelled parents, so query hidden elements too. */
const hidden = { includeHiddenElements: true } as const;

/** Whether a glyph is drawn: the icon stub keeps the SVG markup, so look for the glyph's first path. */
function drawn(name: GlyphName): boolean {
  const d = /d="([^"]+)"/.exec(GLYPHS[name])?.[1] ?? name;
  return JSON.stringify(screen.toJSON()).includes(d);
}

describe('category look (D-204)', () => {
  it('pairs every kind with its own glyph and hue', () => {
    expect(categoryLook(biryani)).toMatchObject({ kind: 'food', glyph: Bowl });
    expect(categoryLook(biryani).hue).toBe(categoryHues.coral);
    expect(categoryLook('board-games').glyph).toBe(Dice);
    expect(categoryLook({ slug: 'live-music', category: 'culture' }).glyph).toBe(Music);
    expect(categoryLook(null).kind).toBe('other');
  });

  it('category pill shows the name with the glyph on the tint, never the lime', async () => {
    await renderWithProviders(<CategoryPill category={biryani} testID="tag" />);
    expect(screen.getByText('Biryani', hidden)).toBeOnTheScreen();
    const tag = screen.getByTestId('tag', hidden);
    const style = StyleSheet.flatten(tag.props.style) as { backgroundColor: string };
    expect(style.backgroundColor).toBe(categoryHues.coral.soft);
    expect([colors.light.primary, colors.dark.primary]).not.toContain(style.backgroundColor);
    expect(drawn('bowl')).toBe(true);
  });

  it('renders nothing without a category', async () => {
    await renderWithProviders(<CategoryPill category={null} testID="tag" />);
    expect(screen.queryByTestId('tag', hidden)).toBeNull();
  });

  it('plan artwork follows the category, neutral without one', async () => {
    await renderWithProviders(
      <>
        <PlanArt category={biryani} />
        <PlanArt category={null} />
      </>,
    );
    expect(screen.getByTestId('plan-art-food', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('plan-art-other', hidden)).toBeOnTheScreen();
  });
});

describe('map pins (D-204)', () => {
  it('a plan pin is a badge in its hue holding the category glyph', async () => {
    await renderWithProviders(<PlanPinBadge category={biryani} mystery={false} />);
    const badge = screen.getByTestId('pin-badge-food', hidden);
    expect(drawn('bowl')).toBe(true);
    expect(drawn('lock')).toBe(false);
    const fill = StyleSheet.flatten(
      (badge.children[0] as unknown as { props: { style: StyleProp<ViewStyle> } }).props.style,
    ) as { backgroundColor: string; width: number };
    expect(fill.backgroundColor).toBe(categoryHues.coral.solid);
    expect(fill.width).toBe(34);
  });

  it('a selected pin grows and takes the lime ring', async () => {
    await renderWithProviders(<PlanPinBadge category={biryani} mystery={false} selected />);
    const badge = screen.getByTestId('pin-badge-food', hidden);
    const fill = StyleSheet.flatten(
      (badge.children[0] as unknown as { props: { style: StyleProp<ViewStyle> } }).props.style,
    ) as { borderColor: string; width: number };
    expect(fill.width).toBe(44);
    expect([colors.light.primary, colors.dark.primary]).toContain(fill.borderColor);
  });

  it('mystery plans keep a neutral lock pin, whatever their category', async () => {
    await renderWithProviders(<PlanPinBadge category={biryani} mystery />);
    expect(screen.getByTestId('pin-badge-mystery', hidden)).toBeOnTheScreen();
    expect(drawn('lock')).toBe(true);
    expect(drawn('bowl')).toBe(false);
  });

  it('the marker keeps its label for screen readers and stops tracking view changes once drawn', async () => {
    jest.useFakeTimers();
    try {
      await renderWithProviders(
        <PlanMarker
          coordinate={{ latitude: 17.4, longitude: 78.4 }}
          category={biryani}
          mystery={false}
          accessibilityLabel="Biryani crawl, Biryani, Tue 3 Nov"
          testID="marker"
        />,
      );
      const marker = screen.getByTestId('marker', hidden);
      expect(marker.props.accessibilityLabel).toBe('Biryani crawl, Biryani, Tue 3 Nov');
      expect(marker.props.tracksViewChanges).toBe(true);
      await act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(screen.getByTestId('marker', hidden).props.tracksViewChanges).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clusters are a neutral bubble with the count', async () => {
    await renderWithProviders(<ClusterBubble count={12} />);
    expect(screen.getByText('12', hidden)).toBeOnTheScreen();
    const style = StyleSheet.flatten(screen.getByTestId('cluster-bubble', hidden).props.style) as {
      backgroundColor: string;
    };
    expect([colors.light.surface, colors.dark.surface]).toContain(style.backgroundColor);
  });
});

describe('cards show the category label', () => {
  it('event card: category tag and the name in its label', async () => {
    await renderWithProviders(<EventCard event={event()} onOpen={jest.fn()} />);
    expect(screen.getByTestId('category-Slug0001', hidden)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Biryani crawl, Biryani, / })).toBeOnTheScreen();
  });

  it('mystery cards keep their category to themselves', async () => {
    await renderWithProviders(<EventCard event={event({ mystery: true })} onOpen={jest.fn()} />);
    expect(screen.queryByTestId('category-Slug0001', hidden)).toBeNull();
  });
});
