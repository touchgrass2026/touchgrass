import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { freshIp } from './api-helpers';

test('landing page shows the brand and passes axe (WCAG 2.1 AA)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log off. Pull up.');
  // Metadata streams in after the body; audit the finished document.
  await expect(page).toHaveTitle(/TouchGrass/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('switches language to Telugu and Hindi with native scripts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'తెలుగు' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/[ఀ-౿]/);
  await expect(page.locator('main')).toHaveAttribute('lang', 'te');
  await page.goto('/?lang=hi');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/[ऀ-ॿ]/);
});

test('honours Accept-Language', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'hi-IN' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('lang', 'hi');
  await context.close();
});

test('serves Open Graph tags and image for WhatsApp previews', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'TouchGrass');
  const image = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(image).toBeTruthy();
  const res = await request.get(new URL(image ?? '').pathname);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
});

test('sends security headers', async ({ request }) => {
  const res = await request.get('/');
  expect(res.headers()['x-frame-options']).toBe('DENY');
  expect(res.headers()['x-powered-by']).toBeUndefined();
  // Phase 12 security review: a CSP that forbids framing, plugins and foreign scripts.
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toMatch(/script-src 'self'/);
  expect(csp).not.toContain('unsafe-eval');
  expect(csp).not.toContain('https://www.google.com');
});

test('only the admin sign-in page allows Firebase sign-in scripts', async ({ request }) => {
  const res = await request.get('/admin/login');
  const csp = res.headers()['content-security-policy'] ?? '';
  // D-167: reCAPTCHA and Google's identity endpoints, still no framing of our pages and no plugins.
  expect(csp).toContain('https://www.google.com');
  expect(csp).toContain('https://identitytoolkit.googleapis.com');
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  for (const path of ['/privacy', '/delete-account']) {
    const other = (await request.get(path)).headers()['content-security-policy'] ?? '';
    expect(other).not.toContain('https://www.google.com');
  }
});

test('dark mode uses dark tokens', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/');
  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--tg-background').trim(),
  );
  expect(bg).toBe('#0B130E');
  await context.close();
});

test('unknown routes render the branded 404', async ({ page }) => {
  const res = await page.goto('/definitely-not-here');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("We couldn't find that.");
});

test('a referral link shows the friend’s code, kept across language switches; junk codes are ignored', async ({
  page,
}) => {
  await page.goto('/?ref=tg7k2p9q');
  await expect(page.getByTestId('referral-code')).toContainText('TG7K2P9Q');
  await page.getByRole('link', { name: 'हिन्दी' }).click();
  await expect(page.getByTestId('referral-code')).toContainText('TG7K2P9Q');
  await page.goto('/?ref=<script>');
  await expect(page.getByTestId('referral-code')).toHaveCount(0);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test.describe('landing page sections and forms (D-169)', () => {
  // A visitor address of its own, so per-address limits never couple runs or projects.
  test.use({ extraHTTPHeaders: freshIp() });

  test('explains the app in ordered sections and passes axe', async ({ page }) => {
    await page.goto('/?lang=en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log off. Pull up.');
    // D-226: the city in photos, three steps, safety, plain answers, the founders, then the waitlist and the invite check.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Small plans, all over Hyderabad',
      'How a plan comes together',
      'After the first plan',
      'Verified adults. SOS on every plan.',
      'Free, 18+, Hyderabad first',
      'Who is behind it',
      'No invite yet?',
      'Got an invite code?',
    ]);
    await expect(page.getByRole('heading', { level: 3, name: 'Pull up' })).toBeVisible();
    await expect(page.getByText('SOS and live location sharing')).toBeVisible();
    // Real places and people: captioned photos, with alt text.
    await expect(page.getByText('Charminar', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /Charminar in the morning/ })).toBeVisible();
    await expect(
      page.getByRole('img', { name: /Friends around a wooden café table/ }),
    ).toBeVisible();
    await expect(page.getByRole('img', { name: /Chai after work in Madhapur/ })).toBeAttached();
    // Answers are on the page, not behind a disclosure.
    await expect(page.getByText('Does it cost anything?')).toBeVisible();
    await expect(page.getByText('plans are free at launch')).toBeVisible();
    // The founders, by name, with the way to the About page.
    const founders = page.getByTestId('landing-founders');
    await expect(founders).toContainText('Raghuram Srivatsa');
    await expect(founders).toContainText('Narain Malladi');
    await expect(founders.getByRole('link', { name: 'More about us' })).toHaveAttribute(
      'href',
      '/about?lang=en',
    );
    // The nav's one primary goes to the form; so does the hero's.
    await page.locator('header').getByRole('link', { name: 'Join the waitlist' }).click();
    await expect(page).toHaveURL(/#waitlist$/);
    await page
      .locator('#hero-title ~ div')
      .getByRole('link', { name: 'Join the waitlist' })
      .click();
    await expect(page).toHaveURL(/#waitlist$/);
    await expect(page).toHaveTitle(/TouchGrass/);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('shows every app screen whole, in the same phone frame', async ({ page }) => {
    await page.goto('/?lang=en');
    const screens = page.locator('.lp-phone-screen');
    await expect(screens).toHaveCount(5);
    for (const screen of await screens.all()) {
      await screen.scrollIntoViewIfNeeded();
      // Whole captures (390 × 844), never cropped: the decoded image and the box keep that shape.
      await expect
        .poll(() =>
          screen.evaluate((img: HTMLImageElement) => img.naturalHeight / img.naturalWidth),
        )
        .toBeCloseTo(844 / 390, 2);
      const box = await screen.boundingBox();
      expect((box?.height ?? 0) / (box?.width ?? 1)).toBeCloseTo(844 / 390, 1);
    }
    // The three steps are the same size.
    const widths = await page
      .locator('.lp-step .lp-phone')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    expect(widths).toHaveLength(3);
    expect(new Set(widths).size).toBe(1);
  });

  test('checks invite codes: the seeded code works, a made-up one does not', async ({ page }) => {
    await page.goto('/?lang=en');
    const result = page.getByTestId('invite-result');
    await page.getByRole('textbox', { name: 'Invite code' }).fill('grass-2026');
    await page.getByRole('button', { name: 'Check code' }).click();
    await expect(result).toContainText('This code works.');
    await expect(result).toContainText('Enter GRASS-2026 when the app asks for an invite code.');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);

    await page.getByRole('textbox', { name: 'Invite code' }).fill('NOPE-0000');
    await page.getByRole('button', { name: 'Check code' }).click();
    await expect(result).toContainText("This code doesn't work.");
    await expect(result).not.toContainText('This code works.');
  });

  test('joins the waitlist after fixing a missing contact', async ({ page }) => {
    await page.goto('/?lang=en');
    const form = page.locator('#waitlist');
    // D-226: name, one mobile-or-email field, city (Hyderabad by default) and one consent line.
    await expect(form.getByLabel('City')).toHaveValue('Hyderabad');
    await expect(form.getByRole('link', { name: 'privacy policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    await form.getByLabel('Your name').fill('E2E Waitlister');
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Join the waitlist' }).click();
    await expect(form.getByRole('alert')).toHaveText('Add a mobile number or an email.');
    // What was typed survives the failed attempt.
    await expect(form.getByLabel('Your name')).toHaveValue('E2E Waitlister');
    await expect(form.getByRole('checkbox')).toBeChecked();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);

    // Not an email, so it is checked as an Indian mobile number.
    const contact = form.getByLabel('Mobile number or email');
    await contact.fill('12345');
    await form.getByRole('button', { name: 'Join the waitlist' }).click();
    await expect(form.getByRole('alert')).toHaveText(
      'Enter a valid Indian mobile number, or an email.',
    );
    await expect(contact).toHaveAttribute('aria-invalid', 'true');
    await expect(contact).toHaveValue('12345');

    await contact.fill(
      `e2e-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`,
    );
    await form.getByRole('button', { name: 'Join the waitlist' }).click();
    await expect(page.getByTestId('waitlist-done')).toHaveText(
      "You're on the list. We'll be in touch when there's a spot for you.",
    );
  });

  test('the whole page is translated', async ({ page }) => {
    await page.goto('/?lang=te');
    for (const heading of await page.getByRole('heading', { level: 2 }).allTextContents())
      expect(heading).toMatch(/[ఀ-౿]/);
    await page.goto('/?lang=hi');
    await expect(page.getByRole('button', { name: 'वेटलिस्ट में जुड़ो' })).toBeVisible();
  });
});

test('about us: vision, mission, goals and both founders, in every language (D-188)', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'About us' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About TouchGrass');
  await expect(page.getByRole('heading', { name: 'Our vision' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Our mission' })).toBeVisible();
  await expect(page.getByTestId('founders')).toContainText('Raghuram Srivatsa');
  await expect(page.getByTestId('founders')).toContainText('Narain Malladi');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole('link', { name: 'తెలుగు' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/[ఀ-౿]/);
});
