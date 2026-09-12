import { expect, test } from '@playwright/test';
import { gotoScenario } from './helpers.mjs';

test('markdown lab renders rich content without eager network media', async ({ page }) => {
  const requested = [];
  page.on('request', (request) => requested.push(request.url()));
  await gotoScenario(page, 'markdown', { viewport: { width: 1024, height: 900 } });

  await expect(page.locator('[data-testid="markdown-body"] table')).toHaveCount(1);
  await expect(page.locator('[data-testid="markdown-body"] .katex')).toHaveCount(2);
  await expect(page.locator('[data-testid="md-code-block"][data-highlighted=true]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Load image: Architecture' })).toBeVisible();
  expect(requested.some((url) => url.includes('architecture.png'))).toBe(false);

  await expect(page.locator('[data-testid="md-mermaid-result"] svg[aria-roledescription]')).toBeVisible();
  await expect(page.locator('[data-testid="md-mermaid-result"] script, [data-testid="md-mermaid-result"] foreignObject')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy SVG' })).toBeVisible();
  await expect(page.locator('[data-testid="md-mermaid"] pre')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show source' }).click();
  await expect(page.locator('[data-testid="md-mermaid"] pre')).toContainText('flowchart LR');
  await expect(page.locator('[data-testid="md-mermaid"]').getByRole('button', { name: 'Copy code' })).toBeVisible();
  await page.getByRole('button', { name: 'Show diagram' }).click();
  await expect(page.locator('[data-testid="md-mermaid-result"] svg[aria-roledescription]')).toBeVisible();
  await page.getByRole('button', { name: 'Open diagram' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Diagram' })).toBeVisible();
  await page.keyboard.press('Escape');

  const geometry = await page.locator('[data-testid="markdown-body"]').evaluate((body) => ({
    width: body.getBoundingClientRect().width,
    tableWidth: body.querySelector('[data-testid="md-table"]').getBoundingClientRect().width,
    tableViewportWidth: body.querySelector('[data-testid="md-table"] > div:last-child').clientWidth,
    tableContentWidth: body.querySelector('[data-testid="md-table"] table').getBoundingClientRect().width,
    codeWidth: body.querySelector('[data-testid="md-code-block"]').getBoundingClientRect().width,
    scrollWidth: body.scrollWidth,
  }));
  expect(geometry.tableWidth).toBeLessThanOrEqual(geometry.width);
  expect(geometry.tableContentWidth).toBeLessThanOrEqual(geometry.tableViewportWidth + 1);
  expect(geometry.codeWidth).toBeLessThanOrEqual(geometry.width);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
});

test('markdown conversation stays inside the centered content track', async ({ page }) => {
  await gotoScenario(page, 'markdown', { viewport: { width: 1440, height: 900 } });

  const geometry = await page.evaluate(() => {
    const markdown = document.querySelector('[data-testid="markdown-body"]');
    const track = markdown.closest('[data-testid="message-list-content"]');
    const viewport = track.parentElement;
    const trackRect = track.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const trackStyle = getComputedStyle(track);
    return {
      markdownWidth: markdown.getBoundingClientRect().width,
      trackInnerWidth: track.clientWidth
        - Number.parseFloat(trackStyle.paddingLeft)
        - Number.parseFloat(trackStyle.paddingRight),
      leftGap: trackRect.left - viewportRect.left,
      rightGap: viewportRect.left + viewport.clientWidth - trackRect.right,
    };
  });
  expect(geometry.markdownWidth).toBeGreaterThanOrEqual(geometry.trackInnerWidth - 1);
  expect(geometry.markdownWidth).toBeLessThanOrEqual(geometry.trackInnerWidth + 1);
  expect(Math.abs(geometry.leftGap - geometry.rightGap)).toBeLessThanOrEqual(1);
});
