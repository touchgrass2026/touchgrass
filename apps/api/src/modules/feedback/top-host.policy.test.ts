import { LIMITS } from '@touchgrass/shared';
import { describe, expect, it } from 'vitest';
import { isTopHost, topHostWindowStart } from './top-host.policy.js';

describe('isTopHost (D-210)', () => {
  it('needs at least five ratings', () => {
    expect(isTopHost({ count: 4, sum: 20 })).toBe(false);
    expect(isTopHost({ count: 5, sum: 25 })).toBe(true);
    expect(isTopHost({ count: 0, sum: 0 })).toBe(false);
  });

  it('needs an exact average of 4.5 or more', () => {
    expect(isTopHost({ count: 6, sum: 27 })).toBe(true); // 4.5
    expect(isTopHost({ count: 5, sum: 22 })).toBe(false); // 4.4
    expect(isTopHost({ count: 50, sum: 224 })).toBe(false); // 4.48 would display as 4.5
  });

  it('looks back 90 days', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    expect(LIMITS.after.topHostWindowDays).toBe(90);
    expect(topHostWindowStart(now).toISOString()).toBe('2026-08-17T12:00:00.000Z');
  });
});
