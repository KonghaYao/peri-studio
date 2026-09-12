import { expect, test } from '@playwright/test';

test('conversation copy keeps compact authored line heights', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=conversation', { waitUntil: 'networkidle' });
  const geometry = await page.getByRole('article', { name: 'Your message' }).first().evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    lineHeight: getComputedStyle(element.querySelector('[data-testid="conversation-message-text"], .text-13, p') ?? element).lineHeight,
    composerLineHeight: getComputedStyle(document.querySelector('[data-testid="composer-input"]')).lineHeight,
    assistantHeight: document.querySelector('[data-testid="conversation-message"].conversation-message--assistant')?.getBoundingClientRect().height ?? 0,
  }));
  expect(geometry).toMatchObject({ lineHeight: '20.3px', composerLineHeight: '20.3px' });
  expect(geometry.height).toBeLessThan(100);
  expect(geometry.assistantHeight).toBeLessThan(800);
});

test('intervention actions stay compact in narrow layouts', async ({ page }) => {
  const measureOptions = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="permission-request"] button')]
    .filter((button) => /Allow once|Deny/.test(button.textContent ?? ''))
    .map((button) => button.getBoundingClientRect().height));
  const measurePrimary = () => page.evaluate(() => {
    const button = document.querySelector('[data-testid="permission-request"] [data-slot=button]');
    const box = button?.getBoundingClientRect();
    return { width: box?.width ?? 0, height: box?.height ?? 0 };
  });
  await page.setViewportSize({ width: 631, height: 800 });
  await page.goto('/visual-fixture.html?scenario=permission-streaming', { waitUntil: 'networkidle' });
  const optionHeights = await measureOptions();
  expect(optionHeights.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...optionHeights)).toBeLessThanOrEqual(40);
  const desktopPrimary = await measurePrimary();
  expect(desktopPrimary.width).toBeLessThan(120);
  expect(desktopPrimary.height).toBeLessThanOrEqual(36);
  await expect(page.getByTestId('elicitation-card')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobilePrimary = await measurePrimary();
  expect(mobilePrimary.height).toBeLessThanOrEqual(44);
});

test('conversation typography and permission surfaces stay dense and neutral', async ({ page }) => {
  await page.setViewportSize({ width: 631, height: 800 });
  await page.goto('/visual-fixture.html?scenario=permission-streaming', { waitUntil: 'networkidle' });
  const facts = await page.evaluate(() => {
    const style = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing density fixture element: ${selector}`);
      return getComputedStyle(element);
    };
    return {
      body: style('body').fontSize,
      message: [style('[data-testid="conversation-message-text"], [data-testid="markdown-body"]').fontSize, style('[data-testid="conversation-message-text"], [data-testid="markdown-body"]').lineHeight],
      button: style('[data-testid="permission-request"] footer [data-slot=button]').fontSize,
      permission: style('[data-testid="permission-request"]').backgroundColor,
      text: document.body.innerText,
    };
  });
  expect(facts).toMatchObject({ body: '14px', message: ['14px', '20.3px'], button: '14px' });
  expect(facts.permission).not.toBe('rgba(0, 0, 0, 0)');
  for (const copy of ['Locks immediately once selected', 'Waiting for your permission', 'Hub observed', 'shows only redacted run summaries']) {
    expect(facts.text).not.toContain(copy);
  }
});

test('desktop chrome and focused composer retain the neutral canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=conversation', { waitUntil: 'networkidle' });
  const input = page.getByTestId('composer-input');
  const surface = page.getByTestId('composer-surface');
  const resting = await surface.evaluate((element) => ({ border: getComputedStyle(element).borderColor, shadow: getComputedStyle(element).boxShadow }));
  await expect(input).toBeEnabled();
  await input.focus();
  await page.waitForTimeout(180);
  const focused = await surface.evaluate((element) => ({ border: getComputedStyle(element).borderColor, shadow: getComputedStyle(element).boxShadow }));
  expect(focused).toEqual(resting);
  // Legacy onboarding card removed from conversation chrome.
  const canvas = await page.evaluate(() => ({
    page: getComputedStyle(document.body).backgroundColor,
    sidebar: getComputedStyle(document.querySelector('[data-testid="project-sidebar"]')).backgroundColor,
    input: getComputedStyle(document.querySelector('[data-testid="composer-input"]')).backgroundColor,
  }));
  expect(canvas.sidebar).toBe(canvas.page);
  expect(canvas.input).toBe('rgba(0, 0, 0, 0)');
});
