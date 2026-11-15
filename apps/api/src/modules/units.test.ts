import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { defaultPreference } from './account/settings.service.js';
import { normalizePhoneOrThrow } from './auth/auth.service.js';
import { isInviteUsable } from './invites/invites.service.js';
import {
  AnimationRejected,
  assertAnimationWithinLimits,
  moderationFrames,
  renderAnimatedVariant,
  renderVariant,
} from './media/media.processor.js';

/** An animated GIF: `frames` solid colour frames of width x height, 100 ms each, looping forever. */
async function animatedGif(width: number, height: number, frames: number): Promise<Buffer> {
  const raw = await Promise.all(
    Array.from({ length: frames }, (_, i) =>
      sharp({
        create: { width, height, channels: 3, background: { r: (i * 40) % 256, g: 166, b: 55 } },
      })
        .raw()
        .toBuffer(),
    ),
  );
  return sharp(Buffer.concat(raw), {
    raw: { width, height: height * frames, channels: 3, pageHeight: height },
  })
    .gif({ delay: Array<number>(frames).fill(100), loop: 0 })
    .toBuffer();
}

describe('invite usability', () => {
  const now = new Date('2026-10-31T00:00:00Z');
  const base = { uses: 0, maxUses: 1, revokedAt: null, expiresAt: null };
  it('requires unrevoked, unexpired codes with remaining uses', () => {
    expect(isInviteUsable(base, now)).toBe(true);
    expect(isInviteUsable({ ...base, uses: 1 }, now)).toBe(false);
    expect(isInviteUsable({ ...base, revokedAt: now }, now)).toBe(false);
    expect(isInviteUsable({ ...base, expiresAt: new Date('2026-10-30T00:00:00Z') }, now)).toBe(
      false,
    );
    expect(isInviteUsable({ ...base, expiresAt: new Date('2026-11-30T00:00:00Z') }, now)).toBe(
      true,
    );
  });
});

describe('notification defaults', () => {
  it('marketing pushes are opt-in, everything else on', () => {
    expect(defaultPreference('marketing')).toEqual({
      category: 'marketing',
      push: false,
      inApp: true,
    });
    expect(defaultPreference('squad')).toEqual({ category: 'squad', push: true, inApp: true });
  });
});

describe('phone normalisation at the edge', () => {
  it('returns E.164 or a validation error', () => {
    expect(normalizePhoneOrThrow('98480 22338')).toBe('+919848022338');
    expect(() => normalizePhoneOrThrow('123')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
    );
  });
});

describe('image variants', () => {
  it('auto-rotates by EXIF orientation, never enlarges, and drops metadata', async () => {
    const portraitByExif = await sharp({
      create: { width: 400, height: 200, channels: 3, background: '#1FA637' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await renderVariant(portraitByExif, 1080);
    expect({ w: out.width, h: out.height }).toEqual({ w: 200, h: 400 });
    const meta = await sharp(out.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    await expect(renderVariant(Buffer.from('nope'), 160)).rejects.toThrow();
  });
});

describe('animated cover variants (D-203)', () => {
  it('keeps every frame, the delays and the loop, resized like a still', async () => {
    const gif = await animatedGif(640, 360, 4);
    const out = await renderAnimatedVariant(gif, 480);
    expect({ w: out.width, h: out.height }).toEqual({ w: 480, h: 270 });
    const meta = await sharp(out.buffer, { animated: true }).metadata();
    expect(meta).toMatchObject({ format: 'webp', pages: 4, pageHeight: 270, loop: 0 });
    expect(meta.delay).toEqual([100, 100, 100, 100]);
    expect(meta.exif).toBeUndefined();
    // Never enlarged.
    const small = await renderAnimatedVariant(gif, 1080);
    expect({ w: small.width, h: small.height }).toEqual({ w: 640, h: 360 });
  });

  it('refuses too many frames or too many pixels before decoding them', async () => {
    const gif = await animatedGif(40, 30, 4);
    const limits = { frames: 4, framePixels: 1200, totalPixels: 4800 };
    await expect(assertAnimationWithinLimits(gif, limits)).resolves.toBeUndefined();
    await expect(assertAnimationWithinLimits(gif)).resolves.toBeUndefined();
    for (const tight of [
      { ...limits, frames: 3 },
      { ...limits, framePixels: 1199 },
      { ...limits, totalPixels: 4799 },
    ])
      await expect(assertAnimationWithinLimits(gif, tight)).rejects.toBeInstanceOf(
        AnimationRejected,
      );
    await expect(assertAnimationWithinLimits(Buffer.from('nope'))).rejects.toThrow();
  });

  it('moderates the first, middle and last frames of an animation, and a still once', async () => {
    const animated = await renderAnimatedVariant(await animatedGif(64, 36, 5), 480);
    const frames = await moderationFrames(animated.buffer);
    expect(frames).toHaveLength(3);
    for (const f of frames) expect((await sharp(f).metadata()).format).toBe('jpeg');
    const still = await renderVariant(
      await sharp({ create: { width: 40, height: 30, channels: 3, background: '#000' } })
        .png()
        .toBuffer(),
      160,
    );
    expect(await moderationFrames(still.buffer)).toHaveLength(1);
  });
});
