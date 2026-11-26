import 'server-only';
import { DoorList } from '@touchgrass/shared';
import { cookies } from 'next/headers';

const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** The venue door session (D-227) lives in an httpOnly cookie scoped to that venue's door page. */
export const DOOR_COOKIE = 'tg_door';

export function doorCookieOptions(venueId: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: `/door/${venueId}`,
  };
}

/** Today's door list, or null when staff need to sign in (no session, or it expired). */
export async function doorList(): Promise<DoorList | null> {
  const token = (await cookies()).get(DOOR_COOKIE)?.value;
  if (!token) return null;
  const res = await fetch(`${API_URL}/v1/door/list`, {
    headers: { accept: 'application/json', 'x-door-token': token },
    cache: 'no-store',
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`API /v1/door/list failed with ${res.status}`);
  return DoorList.parse(await res.json());
}
