import { expect, test } from '@playwright/test';

async function installPhase(page, phase) {
  await page.evaluate((value) => window.__PERI_VISUAL_FIXTURE__.setToolAcceptancePhase(value), phase);
}

function cardById(page, toolCallId) {
  return page.locator('.tool-card').filter({ hasText: toolCallId });
}

async function expand(card) {
  await card.locator('summary').click();
  await expect(card).toHaveAttribute('open', '');
}

test.describe('tool-call evidence acceptance', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/visual-fixture.html?scenario=tools', { waitUntil: 'networkidle' });
    await installPhase(page, 'semantic');
  });

  test('collapsed cards do not eagerly mount evidence and reveal it on demand', async ({ page }) => {
    const bash = cardById(page, 'acceptance-bash');
    await expect(bash).toBeVisible();
    await expect(bash.locator('.tool-card__body, .tool-data')).toHaveCount(0);

    await expand(bash);
    await expect(bash.locator('.tool-card__body')).toBeVisible();
    await expect(bash.getByText('printf bash-input-sentinel', { exact: true })).toBeVisible();
    await expect(bash.getByText(/bash stdout sentinel/)).toBeVisible();
    await expect(bash.getByText(/bash stderr sentinel/)).toBeVisible();
    await expect(bash).toContainText(/"exitCode": 7/);
  });

  test('Browser, MCP and Open remain generic evidence rather than fake file reads', async ({ page }) => {
    for (const id of ['acceptance-browser', 'acceptance-mcp', 'acceptance-open']) {
      const card = cardById(page, id);
      await expand(card);
      await expect(card.locator('.tool-data > header strong').nth(0)).toHaveText('Input');
      await expect(card.locator('.tool-data > header strong').nth(1)).toHaveText('Output');
      await expect(card.locator('.tool-data > header strong', { hasText: /^(File|Content)$/ })).toHaveCount(0);
    }
    await expect(cardById(page, 'acceptance-browser')).toContainText('browser result sentinel');
    await expect(cardById(page, 'acceptance-browser')).toContainText('official content sentinel');
    await expect(cardById(page, 'acceptance-browser')).toContainText('docs/protocol.md');
    await expect(cardById(page, 'acceptance-mcp')).toContainText('mcp result sentinel');
    await expect(cardById(page, 'acceptance-open')).toContainText('open result sentinel');
  });

  test('Bash, Read, Edit and Write preserve distinguishing input and output evidence', async ({ page }) => {
    const expectations = [
      ['acceptance-bash', 'Command', 'Output', 'printf bash-input-sentinel', 'bash stderr sentinel'],
      ['acceptance-read', 'File', 'Content', '/workspace/read-sentinel.ts', 'read content sentinel'],
      ['acceptance-edit', 'Change', 'Result', 'before sentinel', 'edit result sentinel'],
      ['acceptance-write', 'Change', 'Result', 'write input sentinel', 'write result sentinel'],
    ];
    for (const [id, inputLabel, outputLabel, input, output] of expectations) {
      const card = cardById(page, id);
      await expand(card);
      await expect(card.locator('.tool-data > header strong').nth(0)).toHaveText(inputLabel);
      await expect(card.locator('.tool-data > header strong').nth(1)).toHaveText(outputLabel);
      await expect(card).toContainText(input);
      await expect(card).toContainText(output);
    }
  });
});

test.describe('loading transition acceptance', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/visual-fixture.html?scenario=tools', { waitUntil: 'networkidle' });
  });

  test('tool-only evidence suppresses loading while a completed-tool thinking gap has one loader until the next delta', async ({ page }) => {
    await installPhase(page, 'tool-only');
    await expect(cardById(page, 'acceptance-tool')).toBeVisible();
    await expect(page.locator('.chat-loading')).toHaveCount(0);

    await installPhase(page, 'completed-gap');
    await expect(cardById(page, 'acceptance-tool')).toContainText('Done');
    await expect(page.locator('.chat-loading')).toHaveCount(1);
    await expect(page.getByRole('status', { name: 'Agent activity' })).toHaveText('Peri is working');

    await installPhase(page, 'next-delta');
    await expect(page.getByText('next delta sentinel')).toBeVisible();
    await expect(page.locator('.chat-loading')).toHaveCount(0);
  });

  test('permission-first owns the decision surface without a second working indicator', async ({ page }) => {
    await installPhase(page, 'permission-first');
    await expect(page.locator('.permission-queue')).toBeVisible();
    await expect(page.locator('.chat-loading')).toHaveCount(0);
  });

  test('disconnect clears indefinite loading and recovery resumes from projected tool evidence', async ({ page }) => {
    await installPhase(page, 'disconnected');
    await expect(page.locator('.chat-loading')).toHaveCount(0);
    await expect(cardById(page, 'acceptance-tool')).toBeVisible();

    await installPhase(page, 'recovered');
    await expect(page.locator('.chat-loading')).toHaveCount(0);
    await expect(cardById(page, 'acceptance-tool')).toContainText('Done');
    await expect(page.locator('.composer-input')).toBeEnabled();
  });
});

test('expanded output at the tail remains fully visible above the composer and status area', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/visual-fixture.html?scenario=long-conversation', { waitUntil: 'networkidle' });
  const scroll = page.locator('.message-list-scroll');
  await scroll.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));

  const diagnostics = page.locator('.tool-card').filter({ hasText: 'Final diagnostics' });
  await expect(diagnostics).toBeVisible();
  await expect(diagnostics.locator('.tool-card__body')).toHaveCount(0);
  await expand(diagnostics);
  await expect(diagnostics.getByText(/final diagnostic tail sentinel/)).toBeVisible();

  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = await page.evaluate(() => {
    const tail = [...document.querySelectorAll('.tool-card')].find((card) => card.textContent.includes('Final diagnostics'))?.querySelector('.tool-card__body');
    const overlay = document.querySelector('.composer-stack');
    const area = document.querySelector('.message-list-scroll');
    if (!tail || !overlay || !area) throw new Error('Acceptance geometry missing');
    return {
      tailBottom: tail.getBoundingClientRect().bottom,
      overlayTop: overlay.getBoundingClientRect().top,
      scrollBottomGap: area.scrollHeight - area.clientHeight - area.scrollTop,
    };
  });
  expect(geometry.tailBottom).toBeLessThanOrEqual(geometry.overlayTop - 8);
  expect(geometry.scrollBottomGap).toBeLessThanOrEqual(2);
});

for (const viewport of [{ width: 1600, height: 900 }, { width: 1280, height: 900 }, { width: 768, height: 768 }, { width: 390, height: 844 }]) {
  test(`the conversation scrollbar ends above the composer at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/visual-fixture.html?scenario=long-conversation', { waitUntil: 'networkidle' });

    const geometry = await page.evaluate(() => {
      const area = document.querySelector('.message-list-scroll');
      const composer = document.querySelector('.composer-stack');
      if (!area || !composer) throw new Error('Scroll geometry missing');
      area.scrollTo({ top: area.scrollHeight });
      return {
        scrollBottom: area.getBoundingClientRect().bottom,
        composerTop: composer.getBoundingClientRect().top,
        gutter: getComputedStyle(area).scrollbarGutter,
        bottomGap: area.scrollHeight - area.clientHeight - area.scrollTop,
        horizontalOverflow: area.scrollWidth - area.clientWidth,
        pageOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      };
    });

    expect(geometry.scrollBottom).toBeLessThanOrEqual(geometry.composerTop + 1);
    expect(geometry.gutter).toBe('stable');
    expect(geometry.bottomGap).toBeLessThanOrEqual(2);
    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
  });
}
