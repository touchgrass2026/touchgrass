'use server';

import { DoorCheckInResult, DoorSession } from '@touchgrass/shared';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { publicPost } from '../../../lib/public-api';
import { DOOR_COOKIE, doorCookieOptions } from './door-session';

const Uuid = z.uuid();
const Pin = z.string().regex(/^\d{4,8}$/);
const Ticket = z.string().trim().min(6).max(500);

export interface DoorSignInState {
  /** Translation key under events.reasons / errors. */
  error: string | null;
}

/** Venue staff sign in to the door list with the venue staff PIN (D-227). */
export async function doorSignInAction(
  _prev: DoorSignInState,
  form: FormData,
): Promise<DoorSignInState> {
  const venueId = Uuid.safeParse(form.get('venueId'));
  const pin = Pin.safeParse(form.get('pin'));
  if (!venueId.success || !pin.success) return { error: 'WRONG_PIN' };
  const res = await publicPost(
    '/v1/door/sessions',
    { venueId: venueId.data, pin: pin.data },
    DoorSession,
  );
  if (!res.ok || !res.data) return { error: res.ok ? 'INTERNAL' : (res.reason ?? res.code) };
  const jar = await cookies();
  jar.set(DOOR_COOKIE, res.data.token, {
    ...doorCookieOptions(venueId.data),
    expires: new Date(res.data.expiresAt),
  });
  revalidatePath(`/door/${venueId.data}`);
  return { error: null };
}

export async function doorSignOutAction(form: FormData): Promise<void> {
  const venueId = Uuid.safeParse(form.get('venueId'));
  if (!venueId.success) return;
  const jar = await cookies();
  jar.delete({ name: DOOR_COOKIE, path: `/door/${venueId.data}` });
  revalidatePath(`/door/${venueId.data}`);
}

export interface DoorCheckInState {
  done: DoorCheckInResult | null;
  /** Translation key under events.reasons / errors. */
  error: string | null;
  /** Bumped on every attempt so the form can clear its field. */
  attempt: number;
}

/** Staff check someone in by their rotating QR payload or six-digit code (D-227). */
export async function doorCheckInAction(
  prev: DoorCheckInState,
  form: FormData,
): Promise<DoorCheckInState> {
  const attempt = prev.attempt + 1;
  const venueId = Uuid.safeParse(form.get('venueId'));
  const ticket = Ticket.safeParse(form.get('ticket'));
  if (!venueId.success) return { done: null, error: 'NOT_FOUND', attempt };
  if (!ticket.success) return { done: null, error: 'INVALID_TICKET', attempt };
  const token = (await cookies()).get(DOOR_COOKIE)?.value ?? '';
  const res = await publicPost('/v1/door/check-in', { ticket: ticket.data }, DoorCheckInResult, {
    'x-door-token': token,
  });
  revalidatePath(`/door/${venueId.data}`);
  if (res.ok && res.data) return { done: res.data, error: null, attempt };
  return {
    done: null,
    error: res.ok
      ? 'INTERNAL'
      : res.code === 'UNAUTHENTICATED'
        ? 'signedOut'
        : (res.reason ?? res.code),
    attempt,
  };
}
