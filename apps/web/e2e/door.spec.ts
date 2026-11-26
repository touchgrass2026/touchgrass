import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { API, partnerVenues, token } from './api-helpers';

/** Seeded venue staff PIN for partner venues (apps/api/src/seed/payments.seed.ts). */
const STAFF_PIN = '2468';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Distinct seeded members per project (persona n is verified when n % 3 === 0). */
function members(project: string): { host: string; guest: string } {
  return {
    host: `+919000010${String(project === 'mobile' ? 12 : 9).padStart(3, '0')}`,
    guest: `+9190000${String(10_000 + (project === 'mobile' ? 183 : 182))}`,
  };
}

test('venue staff open the door list with the PIN and check a guest in by code (D-227)', async ({
  page,
  request,
}, info) => {
  const m = members(info.project.name);
  const host = await token(request, m.host);
  const guest = await token(request, m.guest);
  // Each project uses its own venue so wrong-PIN counts (per venue) never add up across projects.
  const venues = await partnerVenues(request, guest, 'Rooftop Studio');
  const venueId = info.project.name === 'mobile' ? venues[venues.length - 1] : venues[0];
  expect(venueId).toBeDefined();
  const interests = (await (await request.get(`${API}/v1/interests`)).json()) as {
    items: { id: string }[];
  };
  // Starts in five minutes, so check-in is open and it is on today's list.
  const start = Date.now() + 5 * 60_000;
  const title = `Door night ${String(start).slice(-5)}`;
  const plotted = await request.post(`${API}/v1/events`, {
    headers: { ...auth(host), 'Idempotency-Key': `e2e-door-${String(start)}-${info.project.name}` },
    data: {
      title,
      categoryInterestId: interests.items[0]?.id,
      where: { venueId },
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 2 * 3_600_000).toISOString(),
      capacity: 6,
    },
  });
  expect(plotted.status(), await plotted.text()).toBe(201);
  const plan = (await plotted.json()) as { id: string };
  const going = await request.put(`${API}/v1/events/${plan.id}/rsvp`, {
    headers: { ...auth(guest), 'Idempotency-Key': `e2e-door-rsvp-${String(start)}` },
    data: { status: 'going' },
  });
  expect(going.status()).toBe(200);
  const me = (await (await request.get(`${API}/v1/me`, { headers: auth(guest) })).json()) as {
    displayName: string;
  };
  const firstName = me.displayName.split(' ')[0] ?? '';

  await page.goto(`/door/${venueId ?? ''}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Venue door list');
  let results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.getByLabel('Venue staff PIN').fill('0000');
  await page.getByRole('button', { name: 'Open the door list' }).click();
  await expect(page.getByTestId('door-error')).toHaveText("That PIN doesn't match this venue.");
  await page.getByLabel('Venue staff PIN').fill(STAFF_PIN);
  await page.getByRole('button', { name: 'Open the door list' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Door list');

  const section = page.getByTestId(`door-plan-${plan.id}`);
  await expect(section.getByRole('heading', { level: 2 })).toHaveText(title);
  await expect(section.getByTestId('door-counts')).toContainText('0 of 2 checked in');
  const row = section.getByTestId(/^door-person-/).filter({ hasText: firstName });
  await expect(row).toContainText('Not yet');
  // Staff see a first name and a photo, never a phone number.
  await expect(page.locator('main')).not.toContainText(m.guest.slice(-6));
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);

  // The guest's current six-digit code (it rotates every 30 seconds).
  const ticket = (await (
    await request.get(`${API}/v1/events/${plan.id}/ticket`, { headers: auth(guest) })
  ).json()) as { code: string };
  await page.getByTestId('door-ticket').fill(ticket.code);
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(page.getByTestId('door-done')).toHaveText(`${firstName} is checked in`);
  await expect(section.getByTestId('door-counts')).toContainText('1 of 2 checked in');
  await expect(row).toContainText('Checked in');

  // A made-up code is refused in plain words.
  await page.getByTestId('door-ticket').fill('not-a-real-ticket');
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(page.getByTestId('door-error')).toHaveText("That code isn't valid.");
});
