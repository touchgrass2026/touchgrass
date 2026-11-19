/**
 * The landing waitlist asks for one "mobile number or email" (D-226) while the API keeps separate `phone` and
 * `email` fields. Anything with an @ is an email; anything else is treated as a phone number and checked as one.
 */
export function splitWaitlistContact(raw: string): { phone: string; email: string } {
  const value = raw.trim();
  if (value === '') return { phone: '', email: '' };
  return value.includes('@') ? { phone: '', email: value } : { phone: value, email: '' };
}
