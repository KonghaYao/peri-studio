import { expect, test } from '@playwright/test';

test('unknown question delivery can be hidden without exposing a second answer path', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=elicitation', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.__PERI_VISUAL_FIXTURE__.setElicitationUnknown('elicitation-safe-plan'));

  const card = page.locator('.elicitation-card');
  await expect(card.getByRole('alert')).toContainText('Answer delivery not confirmed');
  await expect(card.getByRole('button', { name: 'Refresh status' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await card.getByRole('button', { name: 'Hide question' }).click();
  await expect(card.getByText('Which release scope should this change use?')).toBeVisible();
  await expect(card.getByText('1 / 1')).toBeHidden();
});
