import { type APIRequestContext, expect } from '@playwright/test';

export const API = `http://localhost:${process.env.API_E2E_PORT ?? '4100'}`;

/** A distinct client IP per sign-in (the e2e API trusts one proxy hop). */
export const freshIp = (): Record<string, string> => ({
  'X-Forwarded-For': `10.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250) + 1)}`,
});

export async function token(api: APIRequestContext, phone: string): Promise<string> {
  const ip = freshIp();
  const sent = await api.post(`${API}/v1/auth/otp/request`, { data: { phone }, headers: ip });
  expect(sent.status(), await sent.text()).toBe(200);
  const res = await api.post(`${API}/v1/auth/otp/verify`, {
    headers: ip,
    data: { phone, code: '000000', device: { deviceId: `e2e-${phone}`, platform: 'android' } },
  });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

/** Neighbourhood centres of the seeded Hyderabad venues (apps/api/src/seed/hyderabad.ts). */
const SEEDED_HOODS = [
  { lat: 17.4401, lng: 78.3489 },
  { lat: 17.4483, lng: 78.3915 },
  { lat: 17.4326, lng: 78.4071 },
  { lat: 17.4156, lng: 78.4347 },
];

/**
 * Seeded partner venues whose name starts with `name` (every seeded partner has the staff PIN 2468), found
 * through the place search any member can use, sorted by id so each project can pick its own. Paid plans no
 * longer name their venue to people who haven't paid (D-227), so tests find partners this way.
 */
export async function partnerVenues(
  api: APIRequestContext,
  accessToken: string,
  name: string,
): Promise<string[]> {
  const ids = new Set<string>();
  for (const at of SEEDED_HOODS) {
    const res = await api.get(`${API}/v1/venues/search`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { q: name, lat: at.lat, lng: at.lng, session: 'e2e-partner-venues' },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      venues: { id: string; name: string; isPartner: boolean }[];
    };
    for (const v of body.venues) if (v.isPartner && v.name.startsWith(name)) ids.add(v.id);
  }
  return [...ids].sort();
}
