import { expect, test } from '@playwright/test';
import { DESKTOP, PHONE, callFixture, expandToolRow, gotoScenario, toolRow } from './helpers.mjs';

test('long transcripts mount a bounded accessible window', async ({ page }) => {
  await gotoScenario(page, 'conversation');
  await callFixture(page, 'setTranscriptCount', 2_000);

  const transcript = page.getByRole('list', { name: 'Conversation transcript' });
  const rows = transcript.getByRole('listitem');
  const scroll = page.getByTestId('message-list-scroll');
  await expect(rows.first()).toHaveAttribute('aria-setsize', '2000');
  await expect.poll(async () => {
    await scroll.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    return await rows.last().getAttribute('data-transcript-id');
  }).toBe('visual-entry-1999');
  expect(await rows.count()).toBeLessThanOrEqual(30);
  await expect(rows.last()).toHaveAttribute('aria-posinset', '2000');
  await expect(rows.last()).toHaveAttribute('aria-setsize', '2000');

  await scroll.evaluate((element) => element.scrollTo({ top: 0 }));
  await expect(rows.first()).toHaveAttribute('data-transcript-id', 'visual-entry-0');
  expect(await rows.count()).toBeLessThanOrEqual(30);
});

test('expanded tool output at the tail stays above the composer and status area', async ({ page }) => {
  test.setTimeout(40_000);
  await gotoScenario(page, 'long-conversation', { viewport: { width: 1280, height: 900 } });
  const scroll = page.getByTestId('message-list-scroll');
  const diagnostics = toolRow(page, 'long-tool-18-5');
  await expect.poll(async () => {
    await scroll.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    return diagnostics.count();
  }).toBeGreaterThan(0);
  await diagnostics.scrollIntoViewIfNeeded();
  await expect(diagnostics.getByTestId('tool-activity-row-body')).toHaveCount(0);
  await expandToolRow(diagnostics);
  await expect(diagnostics.getByText(/final diagnostic tail sentinel/)).toBeVisible();

  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const layout = await page.evaluate(() => {
    const tail = [...document.querySelectorAll('[data-testid="tool-activity-row-body"] pre')]
      .find((node) => node.textContent?.includes('final diagnostic tail sentinel'));
    const composer = document.querySelector('[data-testid="composer-surface"]');
    const status = document.querySelector('[data-testid="status-area"]');
    if (!tail || !composer) return null;
    const tailBox = tail.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    const statusBox = status?.getBoundingClientRect();
    return {
      tailBottom: tailBox.bottom,
      composerTop: composerBox.top,
      statusTop: statusBox?.top ?? composerBox.top,
    };
  });
  expect(layout).not.toBeNull();
  expect(layout.tailBottom).toBeLessThanOrEqual(layout.composerTop);
  expect(layout.tailBottom).toBeLessThanOrEqual(layout.statusTop);
});

for (const viewport of [DESKTOP, PHONE]) {
  test(`conversation scrollbar ends above the composer at ${viewport.width}px`, async ({ page }) => {
    await gotoScenario(page, 'long-conversation', { viewport: { ...viewport, height: viewport.width <= 390 ? 844 : 900 } });

    const geometry = await page.evaluate(() => {
      const area = document.querySelector('[data-testid="message-list-scroll"]');
      const composer = document.querySelector('[data-testid="composer-stack"]');
      if (!area || !composer) throw new Error('Scroll geometry missing');
      area.scrollTo({ top: area.scrollHeight });
      return {
        scrollBottom: area.getBoundingClientRect().bottom,
        composerTop: composer.getBoundingClientRect().top,
        bottomGap: area.scrollHeight - area.clientHeight - area.scrollTop,
        horizontalOverflow: area.scrollWidth - area.clientWidth,
      };
    });

    expect(geometry.scrollBottom).toBeLessThanOrEqual(geometry.composerTop + 1);
    expect(geometry.bottomGap).toBeLessThanOrEqual(2);
    const overflowLimit = viewport.width <= 390 ? 48 : 1;
    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(overflowLimit);
  });
}
