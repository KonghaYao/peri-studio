import { expect, test } from '@playwright/test';

test('permission deadline is visible while the decision remains actionable', async ({ page }) => {
  await page.setViewportSize({ width: 631, height: 800 });
  await page.goto('/visual-fixture.html?scenario=permission-streaming', { waitUntil: 'networkidle' });

  await expect(page.locator('.permission-request time')).toHaveText('Expires in 5m 0s');
  await expect(page.getByRole('button', { name: 'Allow once' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Deny' })).toBeEnabled();
  await expect(page.locator('.permission-request').getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
});
