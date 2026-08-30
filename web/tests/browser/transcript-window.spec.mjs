import { expect, test } from '@playwright/test';

test('long transcripts mount a bounded accessible window in the real browser', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=conversation', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.__PERI_VISUAL_FIXTURE__.setTranscriptCount(2_000));

  const transcript = page.getByRole('list', { name: 'Conversation transcript' });
  const rows = transcript.getByRole('listitem');
  await expect(rows.last()).toHaveAttribute('data-transcript-id', 'visual-entry-1999');
  expect(await rows.count()).toBeLessThanOrEqual(30);
  await expect(rows.last()).toHaveAttribute('aria-posinset', '2000');
  await expect(rows.last()).toHaveAttribute('aria-setsize', '2000');

  await page.getByTestId('message-list-scroll').evaluate((element) => element.scrollTo({ top: 0 }));
  await expect(rows.first()).toHaveAttribute('data-transcript-id', 'visual-entry-0');
  expect(await rows.count()).toBeLessThanOrEqual(30);
});
