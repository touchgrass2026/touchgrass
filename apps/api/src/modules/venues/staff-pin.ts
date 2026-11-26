/**
 * Wrong venue staff PINs count against the venue, wherever they are typed (perk redemption, the door list), so
 * a PIN cannot be brute-forced even across many IPs or screens (F-PAY-04, D-227).
 */
export const STAFF_PIN_FAILURES_PER_HOUR = 10;

export function staffPinFailKey(venueId: string): string {
  return `perk-pin-fail:${venueId}`;
}
