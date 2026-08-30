import { expect, test } from '@playwright/test';

test('conversation copy keeps compact authored line heights', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=conversation', { waitUntil: 'networkidle' });
  const geometry = await page.getByRole('article', { name: 'Your message' }).first().evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    lineHeight: getComputedStyle(element.querySelector('.conversation-message__text, .text-13, p') ?? element).lineHeight,
    composerLineHeight: getComputedStyle(document.querySelector('.composer-input')).lineHeight,
    assistantHeight: document.querySelector('.conversation-message--assistant')?.getBoundingClientRect().height ?? 0,
  }));
  expect(geometry).toMatchObject({ lineHeight: '20px', composerLineHeight: '18px' });
  expect(geometry.height).toBeLessThan(100);
  expect(geometry.assistantHeight).toBeLessThan(800);
});

test('intervention actions stay compact in narrow layouts', async ({ page }) => {
  const measureOptions = () => page.evaluate(() => [...document.querySelectorAll('.permission-request button')]
    .filter((button) => /Allow once|Deny/.test(button.textContent ?? ''))
    .map((button) => button.getBoundingClientRect().height));
  const measurePrimary = () => page.evaluate(() => {
    const button = document.querySelector('.permission-request [data-slot=button]');
    const box = button?.getBoundingClientRect();
    return { width: box?.width ?? 0, height: box?.height ?? 0 };
  });
  await page.setViewportSize({ width: 631, height: 800 });
  await page.goto('/visual-fixture.html?scenario=permission-streaming', { waitUntil: 'networkidle' });
  const optionHeights = await measureOptions();
  expect(optionHeights.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...optionHeights)).toBeLessThanOrEqual(36);
  const desktopPrimary = await measurePrimary();
  expect(desktopPrimary.width).toBeLessThan(120);
  expect(desktopPrimary.height).toBeLessThanOrEqual(32);
  await expect(page.locator('.elicitation-card')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobilePrimary = await measurePrimary();
  expect(mobilePrimary.height).toBeLessThanOrEqual(44);
});

test('conversation typography and permission surfaces stay dense and neutral', async ({ page }) => {
  await page.setViewportSize({ width: 631, height: 800 });
  await page.goto('/visual-fixture.html?scenario=permission-streaming', { waitUntil: 'networkidle' });
  const facts = await page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    return {
      body: style('body').fontSize,
      message: [style('.conversation-message__text').fontSize, style('.conversation-message__text').lineHeight],
      button: style('.permission-request [data-slot=button]').fontSize,
      heading: style('.markdown-body h2').fontSize,
      permission: style('.permission-request').backgroundColor,
      text: document.body.innerText,
    };
  });
  expect(facts).toMatchObject({ body: '13px', message: ['13px', '20px'], button: '12px', heading: '17px' });
  expect(facts.permission).not.toBe('rgba(0, 0, 0, 0)');
  for (const copy of ['Locks immediately once selected', 'Waiting for your permission', 'Hub observed', 'shows only redacted run summaries']) {
    expect(facts.text).not.toContain(copy);
  }
});

test('desktop chrome and focused composer retain the neutral canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/visual-fixture.html?scenario=conversation', { waitUntil: 'networkidle' });
  const input = page.locator('.composer-input');
  const surface = page.locator('.composer-surface');
  const resting = await surface.evaluate((element) => ({ border: getComputedStyle(element).borderColor, shadow: getComputedStyle(element).boxShadow }));
  await expect(input).toBeEnabled();
  await input.focus();
  await page.waitForTimeout(180);
  const focused = await surface.evaluate((element) => ({ border: getComputedStyle(element).borderColor, shadow: getComputedStyle(element).boxShadow }));
  expect(focused).toEqual(resting);
  await expect(page.locator('.onboarding-card')).toHaveCount(0);
  const canvas = await page.evaluate(() => ({
    page: getComputedStyle(document.body).backgroundColor,
    sidebar: getComputedStyle(document.querySelector('.project-sidebar')).backgroundColor,
    input: getComputedStyle(document.querySelector('.composer-input')).backgroundColor,
  }));
  expect(canvas.sidebar).toBe(canvas.page);
  expect(canvas.input).toBe('rgba(0, 0, 0, 0)');
});
