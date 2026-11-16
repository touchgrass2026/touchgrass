import { describe, expect, it } from 'vitest';
import {
  CATEGORY_HUE_NAMES,
  categoryHues,
  colors,
  contrastRatio,
  media,
  STORY_GRADIENT_NAMES,
  STORY_SOLID_NAMES,
  storyGradients,
  storySolids,
  palette,
  relativeLuminance,
} from './tokens';

describe('design tokens', () => {
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(() => relativeLuminance('green')).toThrow(RangeError);
  });
  for (const scheme of ['light', 'dark'] as const) {
    const c = colors[scheme];
    const pairs: [string, string, string][] = [
      ['text/background', c.text, c.background],
      ['text/surface', c.text, c.surface],
      ['textMuted/surface', c.textMuted, c.surface],
      ['textMuted/background', c.textMuted, c.background],
      ['onPrimary/primary', c.onPrimary, c.primary],
      ['onAccent/accent', c.onAccent, c.accent],
      ['onDanger/danger', c.onDanger, c.danger],
      ['text/surfaceAlt', c.text, c.surfaceAlt],
      // tone="primary" / tone="danger" text (links, statuses, errors) on every surface (Phase 12 audit).
      ['primary/surface', c.primary, c.surface],
      ['primary/background', c.primary, c.background],
      ['danger/surface', c.danger, c.surface],
      ['danger/background', c.danger, c.background],
      ['textMuted/surfaceAlt', c.textMuted, c.surfaceAlt],
    ];
    // Non-text contrast (WCAG 1.4.11): focus rings and the borders that outline inputs.
    for (const [name, fg, bg] of [
      ['focus/background', c.focus, c.background],
      ['focus/surface', c.focus, c.surface],
      ['inputBorder/surface', c.inputBorder, c.surface],
      ['inputBorder/background', c.inputBorder, c.background],
    ] as const) {
      it(`${scheme}: ${name} meets 3:1 for UI components`, () => {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
      });
    }
    for (const [name, fg, bg] of pairs) {
      it(`${scheme}: ${name} meets WCAG AA (4.5:1)`, () => {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  // Category hues (D-204) live on the app's dark surfaces only.
  describe('category hues', () => {
    const d = colors.dark;
    const surfaces = [
      ['background', d.background],
      ['surface', d.surface],
      ['surfaceAlt', d.surfaceAlt],
    ] as const;
    for (const name of CATEGORY_HUE_NAMES) {
      const h = categoryHues[name];
      it(`${name}: tag text reads on its tint and on every surface (4.5:1)`, () => {
        expect(contrastRatio(h.text, h.soft)).toBeGreaterThanOrEqual(4.5);
        for (const [, bg] of surfaces)
          expect(contrastRatio(h.text, bg)).toBeGreaterThanOrEqual(4.5);
      });
      it(`${name}: glyphs and text on the solid fill (4.5:1)`, () => {
        expect(contrastRatio(h.onSolid, h.solid)).toBeGreaterThanOrEqual(4.5);
      });
      it(`${name}: the solid stands out as an icon or pin on its tint and every surface (3:1)`, () => {
        expect(contrastRatio(h.solid, h.soft)).toBeGreaterThanOrEqual(3);
        for (const [, bg] of surfaces) expect(contrastRatio(h.solid, bg)).toBeGreaterThanOrEqual(3);
      });
      it(`${name}: white text reads on the artwork below its top stop (4.5:1)`, () => {
        expect(contrastRatio(media.text, h.art[1])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(media.text, h.art[2])).toBeGreaterThanOrEqual(4.5);
      });
    }
    it('never reuses the lime primary, so actions keep the only lime', () => {
      for (const name of CATEGORY_HUE_NAMES) {
        const h = categoryHues[name];
        expect([h.solid, h.soft, h.text].map((x) => x.toUpperCase())).not.toContain(
          palette.lime400,
        );
      }
    });
  });
  describe('story card backgrounds (D-212)', () => {
    for (const name of STORY_GRADIENT_NAMES) {
      it(`${name}: the card's text reads on both stops (4.5:1)`, () => {
        const g = storyGradients[name];
        for (const stop of g.colors) expect(contrastRatio(g.ink, stop)).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const name of STORY_SOLID_NAMES) {
      it(`${name}: the card's text reads on the solid (4.5:1)`, () => {
        const s = storySolids[name];
        expect(contrastRatio(s.ink, s.color)).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
});
