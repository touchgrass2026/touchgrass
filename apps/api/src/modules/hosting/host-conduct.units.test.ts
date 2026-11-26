import { HOST_PAYMENT_STRIKES } from '@touchgrass/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../common/errors/app-error.js';
import { confirmsPaymentStrike } from '../moderation-tools/moderation-tools.service.js';
import { CATEGORY_SEVERITY, categoryFitsTarget } from '../social/reports/report-severity.js';
import { assertMayHost, strikeOutcome } from './host-conduct.policy.js';
import { hostingRights } from './hosting.service.js';

describe('free means free (D-228)', () => {
  it('a confirmed strike warns, and the limit removes hosting', () => {
    expect(HOST_PAYMENT_STRIKES.revokeAt).toBe(2);
    expect(strikeOutcome(1)).toBe('warn');
    expect(strikeOutcome(2)).toBe('revoke');
    expect(strikeOutcome(5)).toBe('revoke');
    expect(strikeOutcome(2, 3)).toBe('warn');
  });

  it('removed hosting blocks plotting; no standing or a reinstated one does not', () => {
    expect(() => {
      assertMayHost({ hostingRevokedAt: new Date() });
    }).toThrow(AppError);
    try {
      assertMayHost({ hostingRevokedAt: new Date() });
    } catch (err) {
      expect(err).toMatchObject({
        code: 'HOSTING_REVOKED',
        details: { reason: 'PAYMENT_STRIKES' },
      });
    }
    expect(() => {
      assertMayHost(null);
    }).not.toThrow();
    expect(() => {
      assertMayHost({ hostingRevokedAt: null });
    }).not.toThrow();
  });

  it('removed hosting takes away free and paid hosting, even for approved hosts', () => {
    expect(hostingRights(true, true, { status: 'approved' }, true, true)).toEqual({
      canHostFree: false,
      canHostPaid: false,
    });
    expect(hostingRights(true, false, null, true, false).canHostFree).toBe(true);
  });

  it('only a take-down after an "asked to pay" report is a strike', () => {
    const report = (lastCategory: unknown) => ({
      source: 'report' as const,
      details: { lastCategory },
    });
    expect(confirmsPaymentStrike(report('asked_to_pay'), 'remove')).toBe(true);
    expect(confirmsPaymentStrike(report('asked_to_pay_outside'), 'remove')).toBe(true);
    expect(confirmsPaymentStrike(report('asked_to_pay'), 'dismiss')).toBe(false);
    expect(confirmsPaymentStrike(report('scam'), 'remove')).toBe(false);
    expect(confirmsPaymentStrike(report(undefined), 'remove')).toBe(false);
    // Automatic payment flags are held, never strikes on their own.
    expect(
      confirmsPaymentStrike(
        { source: 'auto_text', details: { lastCategory: 'asked_to_pay' } },
        'remove',
      ),
    ).toBe(false);
  });

  it('money reports are fraud-level and fit plans, people and words, not photos', () => {
    expect(CATEGORY_SEVERITY.asked_to_pay).toBe('medium');
    expect(CATEGORY_SEVERITY.asked_to_pay_outside).toBe('medium');
    expect(categoryFitsTarget('event', 'asked_to_pay')).toBe(true);
    expect(categoryFitsTarget('user', 'asked_to_pay_outside')).toBe(true);
    expect(categoryFitsTarget('message', 'asked_to_pay')).toBe(true);
    expect(categoryFitsTarget('event_comment', 'asked_to_pay')).toBe(true);
    expect(categoryFitsTarget('story', 'asked_to_pay')).toBe(false);
    expect(categoryFitsTarget('lore_media', 'asked_to_pay_outside')).toBe(false);
    expect(categoryFitsTarget('story', 'harassment')).toBe(true);
  });
});
