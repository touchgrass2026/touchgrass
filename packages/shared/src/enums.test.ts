import { describe, expect, it } from 'vitest';
import {
  AdminRole,
  EventVisibility,
  isPaymentReportCategory,
  NotificationCategory,
  ReportCategory,
  reportCategoriesFor,
  RsvpStatus,
} from './enums';
import { SOCKET_NAMESPACES } from './socket';

describe('enums', () => {
  it('exposes the spec-defined value sets', () => {
    expect(EventVisibility.options).toEqual([
      'public',
      'friends_of_friends',
      'invite_only',
      'approval',
      'women_only',
      'men_only',
      'balanced',
    ]);
    expect(RsvpStatus.options).toContain('checked_in');
    expect(AdminRole.options).toContain('city_curator');
    expect(NotificationCategory.safeParse('spam').success).toBe(false);
    expect(SOCKET_NAMESPACES.chat).toBe('/chat');
  });

  it('offers the money report reasons where they make sense (D-228)', () => {
    expect(reportCategoriesFor('event', { paid: false })).toContain('asked_to_pay');
    expect(reportCategoriesFor('event', { paid: false })).not.toContain('asked_to_pay_outside');
    expect(reportCategoriesFor('event', { paid: true })).toContain('asked_to_pay_outside');
    expect(reportCategoriesFor('event', { paid: true })).not.toContain('asked_to_pay');
    expect(reportCategoriesFor('user')).toEqual(expect.arrayContaining(['asked_to_pay']));
    expect(reportCategoriesFor('message')).toContain('asked_to_pay_outside');
    expect(reportCategoriesFor('story')).not.toContain('asked_to_pay');
    expect(reportCategoriesFor('lore_media')).toEqual(
      ReportCategory.options.filter((c) => !isPaymentReportCategory(c)),
    );
    // "Something else" stays last.
    expect(reportCategoriesFor('event').at(-1)).toBe('other');
  });
});
