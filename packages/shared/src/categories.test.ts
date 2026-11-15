import { describe, expect, it } from 'vitest';
import { CATEGORY_KIND_HUE, CATEGORY_KINDS, categoryHue, categoryKind } from './categories';
import { categoryHues } from './tokens';

describe('category kinds and hues (D-204)', () => {
  it.each([
    // The seeded taxonomy: slug and group as the API sends them.
    [{ slug: 'biryani', category: 'food' }, 'food'],
    [{ slug: 'street-food', category: 'food' }, 'food'],
    [{ slug: 'cafes', category: 'food' }, 'food'],
    [{ slug: 'board-games', category: 'games' }, 'games'],
    [{ slug: 'quiz', category: 'games' }, 'games'],
    [{ slug: 'books', category: 'culture' }, 'learning'],
    [{ slug: 'startups', category: 'learning' }, 'learning'],
    [{ slug: 'languages', category: 'learning' }, 'learning'],
    [{ slug: 'trekking', category: 'active' }, 'outdoors'],
    [{ slug: 'plants', category: 'community' }, 'outdoors'],
    [{ slug: 'heritage-walks', category: 'culture' }, 'outdoors'],
    [{ slug: 'yoga', category: 'active' }, 'wellness'],
    [{ slug: 'running', category: 'active' }, 'sport'],
    [{ slug: 'badminton', category: 'active' }, 'sport'],
    [{ slug: 'theatre', category: 'culture' }, 'creative'],
    [{ slug: 'dance', category: 'creative' }, 'creative'],
    [{ slug: 'live-music', category: 'culture' }, 'creative'],
    [{ slug: 'pets', category: 'community' }, 'other'],
    ['kayaking', 'water'],
    ['Lake swim', 'water'],
    // Admin-added interests are matched by their English name too.
    [{ slug: 'x1', category: 'misc', name: { en: 'Chess club' } }, 'games'],
  ] as const)('%j is %s', (input, kind) => {
    expect(categoryKind(input)).toBe(kind);
  });

  it('falls back to other for nothing or unknown words', () => {
    expect(categoryKind(null)).toBe('other');
    expect(categoryKind(undefined)).toBe('other');
    expect(categoryKind('')).toBe('other');
    expect(categoryKind({})).toBe('other');
    expect(categoryKind('volunteering')).toBe('other');
  });

  it('does not match short words inside longer ones', () => {
    // "art" inside "startups" / "party" is not creative.
    expect(categoryKind('party')).toBe('other');
    expect(categoryKind('art-jam')).toBe('creative');
  });

  it('is deterministic and maps every kind to a defined hue', () => {
    for (const kind of CATEGORY_KINDS) {
      expect(categoryHues[CATEGORY_KIND_HUE[kind]]).toBeDefined();
    }
    expect(categoryHue({ slug: 'chai', category: 'food' })).toBe(categoryHues.coral);
    expect(categoryHue({ slug: 'chai', category: 'food' })).toBe(categoryHue('chai'));
    expect(categoryHue(null)).toBe(categoryHues.slate);
  });

  it('keeps the kinds apart: food, games, learning, outdoors, sport and creative each get their own hue', () => {
    const distinct = new Set(
      (['food', 'games', 'learning', 'outdoors', 'sport', 'creative', 'other'] as const).map(
        (k) => CATEGORY_KIND_HUE[k],
      ),
    );
    expect(distinct.size).toBe(7);
  });
});
