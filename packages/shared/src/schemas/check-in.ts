import { z } from 'zod';

/**
 * Check-in integrity (D-227): what venue staff see at the door, and the fake-headcount flags admins review.
 * Staff never see phone numbers or anything beyond a first name, a profile photo and whether someone is in.
 */

/** Venue staff sign in to the door view with the venue's staff PIN. */
export const DoorSessionBody = z.object({
  venueId: z.uuid(),
  pin: z.string().regex(/^\d{4,8}$/),
});
export type DoorSessionBody = z.infer<typeof DoorSessionBody>;
export const DoorSession = z.object({
  token: z.string(),
  venueName: z.string(),
  expiresAt: z.iso.datetime(),
});
export type DoorSession = z.infer<typeof DoorSession>;

export const DoorPerson = z.object({
  userId: z.uuid(),
  firstName: z.string(),
  /** Small profile photo, so staff can match a face to the code. */
  photoUrl: z.string().nullable(),
  checkedIn: z.boolean(),
  checkedInAt: z.iso.datetime().nullable(),
});
export type DoorPerson = z.infer<typeof DoorPerson>;

export const DoorPlan = z.object({
  eventId: z.uuid(),
  title: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timezone: z.string(),
  paid: z.boolean(),
  /** People holding a seat (on a paid plan, everyone here has paid). */
  confirmed: z.number().int(),
  checkedIn: z.number().int(),
  checkInOpen: z.boolean(),
  people: z.array(DoorPerson),
});
export type DoorPlan = z.infer<typeof DoorPlan>;

export const DoorList = z.object({
  venueName: z.string(),
  plans: z.array(DoorPlan),
});
export type DoorList = z.infer<typeof DoorList>;

/** A scanned QR payload or a typed six-digit code. */
export const DoorCheckInBody = z.object({ ticket: z.string().trim().min(6).max(500) });
export type DoorCheckInBody = z.infer<typeof DoorCheckInBody>;
export const DoorCheckInResult = z.object({
  eventId: z.uuid(),
  userId: z.uuid(),
  firstName: z.string(),
  checkedInAt: z.iso.datetime(),
  /** They were already checked in before this scan. */
  already: z.boolean(),
});
export type DoorCheckInResult = z.infer<typeof DoorCheckInResult>;

export const CheckInFlagKind = z.enum(['shared_device', 'far_from_spot']);
export type CheckInFlagKind = z.infer<typeof CheckInFlagKind>;
export const CheckInFlag = z.object({
  kind: CheckInFlagKind,
  /** People checked in from one phone (shared_device) or check-ins far from the spot (far_from_spot). */
  count: z.number().int(),
  flaggedAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
});
export type CheckInFlag = z.infer<typeof CheckInFlag>;
