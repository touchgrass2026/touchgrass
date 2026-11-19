// Landing-page screenshots (D-226), step 2 of 3: signs in to the app's web build as seeded member #2 and captures
// five whole phone screens at device scale 3 (390 × 844 CSS px → 1170 × 2532 PNG).
//
// Needs: the capture API on :4000 with fixture.mjs applied, and the app's web build on :8081 started with
// metro.capture.cjs (see that file). The browser clock is fixed to Friday 20 Nov 2026, 6:45 pm IST, so every plan
// fixture.mjs placed is still ahead. Run from the repo root:
//
//   node --env-file=.env apps/mobile/scripts/landing-shots/capture.mjs <out-dir>
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const out = process.argv[2];
if (!out) throw new Error('usage: capture.mjs <out-dir>');
mkdirSync(out, { recursive: true });
const APP = process.env.CAPTURE_APP_URL ?? 'http://localhost:8081';
const NOW = new Date(Date.UTC(2026, 10, 20, 18, 45) - 330 * 60_000);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const id = async (slug) =>
  (await db.query('select id from events where slug = $1', [slug])).rows[0].id;
const board = await id('seedev084');
const conv = (await db.query(`select id from conversations where event_id = $1`, [board])).rows[0]
  ?.id;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  geolocation: { latitude: 17.4401, longitude: 78.3489 },
  permissions: ['geolocation'],
  timezoneId: 'Asia/Kolkata',
  locale: 'en-IN',
  colorScheme: 'light',
});
const page = await context.newPage();
await page.clock.install({ time: NOW });
await page.clock.resume();
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 200)));

/** Waits until every image on screen has decoded, then a beat for transitions. */
async function settle(ms = 1500) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(ms);
}
async function shot(name) {
  await settle();
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('captured', name);
}
/** Opens a route with a fresh load; the session survives in storage, the "How was it?" prompt is closed again. */
async function open(path) {
  await page.goto(`${APP}${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const later = page.getByTestId('after-later');
  if (await later.count()) await later.click();
}

await page.goto(APP, { waitUntil: 'load', timeout: 300_000 });
await page.getByText('Get started').click();
await page.getByTestId('phone-input').fill('9000010002');
await page.getByText('Send code').click();
await page.getByTestId('otp-input').fill('000000');
await page.getByText('Verify', { exact: true }).click();
await page.waitForTimeout(5000);
if (await page.getByTestId('after-later').count()) await page.getByTestId('after-later').click();
await page.waitForTimeout(1500);
const skip = page.getByText('Skip', { exact: true });
if (await skip.count()) await skip.first().click();

await shot('explore');

await open('/');
await page.getByText('Chai after work', { exact: true }).first().click();
await shot('plan');

await open('/');
await page.getByTestId('dock-plans').click();
await shot('plans');

if (conv) {
  await open('/');
  await page.getByTestId('dock-chats').click();
  await settle();
  await page.getByTestId(`conv-${conv}`).click();
  await shot('chat');
}

async function openShare() {
  await open('/');
  await page.getByTestId('open-profile').click();
  await settle();
  await page.getByTestId('open-safety').click();
  await settle();
  await page.getByTestId('safety-open-share').click();
  await settle();
}
await openShare();
// A share left running by an earlier capture is reused.
if (!(await page.getByTestId('share-active').count())) {
  await page.getByTestId('duration-60').click();
  // The API only links a share to a plan near its start (real time); the link is added below instead.
  await page.getByTestId('share-start').click();
  await page
    .getByTestId('share-active')
    .waitFor()
    .catch(async (error) => {
      await page.screenshot({ path: `${out}/share-failed.png` });
      throw error;
    });
}
// The share runs for the board games plan, an hour from the fixed clock rather than the real one.
await db.query(
  `update live_location_shares set started_at = $1, last_point_at = $1, expires_at = $2, event_id = $3
    where ended_at is null`,
  [NOW, new Date(NOW.getTime() + 3_600_000), board],
);
// Location points would stamp the real time as the last update; the shot keeps the fixed one.
await page.route('**/v1/safety/live/points', (route) => route.abort());
await openShare();
await page.getByTestId('share-active').waitFor();
await shot('live-location');

await browser.close();
await db.end();
