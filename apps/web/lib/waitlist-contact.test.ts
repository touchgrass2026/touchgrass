import { LaunchWaitlistBody } from '@touchgrass/shared';
import { describe, expect, it } from 'vitest';
import { splitWaitlistContact } from './waitlist-contact';

const body = (contact: string) => ({
  name: 'Asha',
  city: 'Hyderabad',
  consent: true,
  ...splitWaitlistContact(contact),
});

describe('splitWaitlistContact', () => {
  it('sends an address with an @ as the email', () => {
    expect(splitWaitlistContact('  Asha@Example.com ')).toEqual({
      phone: '',
      email: 'Asha@Example.com',
    });
  });
  it('sends anything else as the phone number', () => {
    expect(splitWaitlistContact('098480 22338')).toEqual({ phone: '098480 22338', email: '' });
  });
  it('leaves both empty when nothing was typed', () => {
    expect(splitWaitlistContact('   ')).toEqual({ phone: '', email: '' });
  });
  it('keeps the API contract: either field passes the shared schema, nothing or junk does not', () => {
    expect(LaunchWaitlistBody.safeParse(body('98480 22338')).success).toBe(true);
    expect(LaunchWaitlistBody.safeParse(body('asha@example.com')).success).toBe(true);
    const empty = LaunchWaitlistBody.safeParse(body(''));
    expect(empty.success).toBe(false);
    expect(empty.error?.issues.map((i) => i.path[0])).toContain('contact');
    const junk = LaunchWaitlistBody.safeParse(body('12345'));
    expect(junk.error?.issues.map((i) => i.path[0])).toContain('phone');
  });
});
