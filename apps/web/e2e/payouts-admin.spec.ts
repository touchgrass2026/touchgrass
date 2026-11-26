import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** Seeded in apps/api/src/seed/payments.seed.ts (`HELD_TITLE`): payout held on a buyer's dispute (D-229). */
const HELD = 'Pottery masterclass';

test('admins answer a dispute with check-in evidence, then release the held payout', async ({
  page,
}) => {
  await page.goto('/admin/payments');
  await expect(page.getByRole('heading', { name: 'Payouts held for review' })).toBeVisible();
  const held = page.getByTestId(`held-${HELD}`);
  await expect(held.getByTestId('hold-reason')).toHaveText('A buyer reported a problem');
  await expect(held).toContainText('2 of 3');
  const dispute = page.getByTestId(`dispute-${HELD}`);
  await expect(dispute.getByTestId('dispute-evidence')).toHaveText('Never checked in');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  // Releasing waits for the dispute's answer.
  await held.getByLabel('Note for the audit log').first().fill('Venue confirmed the headcount');
  await held.getByRole('button', { name: 'Release' }).click();
  await expect(page.getByTestId('admin-failed')).toBeVisible();

  await dispute.getByLabel('Note for the audit log').fill('Door list shows a no-show, no refund');
  await dispute.getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByTestId('admin-saved')).toBeVisible();
  await expect(page.getByTestId(`dispute-${HELD}`)).toHaveCount(0);

  await page
    .getByTestId(`held-${HELD}`)
    .getByLabel('Note for the audit log')
    .first()
    .fill('Dispute answered, releasing');
  await page.getByTestId(`held-${HELD}`).getByRole('button', { name: 'Release' }).click();
  await expect(page.getByTestId('admin-saved')).toBeVisible();
  await expect(page.getByTestId(`held-${HELD}`)).toHaveCount(0);
  await expect(page.getByTestId(`payout-${HELD}`)).toContainText('Scheduled');
});
